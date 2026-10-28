from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

ETF_LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn"
CU_PAGE_URL = "https://navercomp.wisereport.co.kr/v2/ETF/index.aspx"
CU_DATA_MARKER = "var CU_data = "
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)
# Naver etfTabCode values that hold domestic stocks.
DOMESTIC_EQUITY_TABS = {1: "국내 시장지수", 2: "국내 업종/테마"}
ACTIVE_KEYWORD = "액티브"


def build_session() -> requests.Session:
    """Create a session that retries transient HTTP failures with backoff."""
    retry = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    session = requests.Session()
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def fetch_active_etfs(session: requests.Session) -> list[dict[str, Any]]:
    """List domestic-equity active ETFs with their market cap (억원) from Naver."""
    response = session.get(
        ETF_LIST_URL,
        params={"etfType": 0, "targetColumn": "market_sum", "sortOrder": "desc"},
        timeout=30,
    )
    response.raise_for_status()
    items = json.loads(response.content.decode("cp949"))["result"]["etfItemList"]
    return [
        {
            "code": item["itemcode"],
            "name": item["itemname"],
            "brand": item["itemname"].split()[0],
            "category": DOMESTIC_EQUITY_TABS[item["etfTabCode"]],
            "market_cap_100m": int(item["marketSum"]),
        }
        for item in items
        if ACTIVE_KEYWORD in item["itemname"] and item["etfTabCode"] in DOMESTIC_EQUITY_TABS
    ]


def normalize_number(value: Any) -> int | float:
    number = float(value or 0)
    return int(number) if number.is_integer() else number


def fetch_cu_holdings(
    session: requests.Session,
    etf_code: str,
) -> tuple[str, list[list[Any]]] | None:
    """Fetch one ETF's per-CU holdings (PDF) from WiseReport as (trade_date, rows)."""
    response = session.get(CU_PAGE_URL, params={"cmp_cd": etf_code}, timeout=(10, 30))
    response.raise_for_status()
    response.encoding = "utf-8"
    page = response.text
    start = page.find(CU_DATA_MARKER)
    if start < 0:
        return None

    cu_data, _ = json.JSONDecoder().raw_decode(page, start + len(CU_DATA_MARKER))
    grid = cu_data.get("grid_data") or []
    if not grid:
        return None

    holdings = [
        [
            row["STK_NM_KOR"],
            normalize_number(row.get("AGMT_STK_CNT")),
            round(float(row.get("ETF_WEIGHT") or 0), 4),
        ]
        for row in grid
    ]
    return grid[0]["TRD_DT"], holdings


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


class SnapshotStore:
    """Daily PDF snapshots under one data directory."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.pdf_dir = data_dir / "pdf"
        self._cache: dict[str, dict[str, Any]] = {}

    def pdf_dates(self) -> list[str]:
        return sorted(path.stem for path in self.pdf_dir.glob("*.json"))

    def load_snapshot(self, trade_date: str) -> dict[str, Any]:
        if trade_date not in self._cache:
            self._cache[trade_date] = read_json(
                self.pdf_dir / f"{trade_date}.json",
                {"date": trade_date, "etfs": {}},
            )
        return self._cache[trade_date]

    def upsert_snapshot(self, trade_date: str, etfs: dict[str, dict[str, Any]]) -> None:
        snapshot = self.load_snapshot(trade_date)
        snapshot["etfs"].update(etfs)
        snapshot["etfs"] = dict(sorted(snapshot["etfs"].items()))
        write_json(self.pdf_dir / f"{trade_date}.json", snapshot)
