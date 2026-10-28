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
CASH_KEYWORD = "현금"


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
    response = session.get(CU_PAGE_URL, params={"cmp_cd": etf_code}, timeout=30)
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


def diff_holdings(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the holdings of one ETF whose share count changed between two snapshots."""
    before_rows = {
        name: (shares, weight)
        for name, shares, weight in before["holdings"]
        if CASH_KEYWORD not in name
    }
    after_rows = {
        name: (shares, weight)
        for name, shares, weight in after["holdings"]
        if CASH_KEYWORD not in name
    }
    market_cap = before["market_cap_100m"]

    rows: list[dict[str, Any]] = []
    for name in sorted(before_rows.keys() | after_rows.keys()):
        shares_before, weight_before = before_rows.get(name, (0, 0.0))
        shares_after, weight_after = after_rows.get(name, (0, 0.0))
        change_shares = shares_after - shares_before
        if change_shares == 0:
            continue

        if shares_before == 0:
            change_type = "NEW"
        elif shares_after == 0:
            change_type = "OUT"
        else:
            change_type = "UP" if change_shares > 0 else "DOWN"

        # Value the traded shares at the previous day's weight per share
        # (the new day's for NEW rows), scaled by the ETF market cap.
        unit_weight = (
            weight_before / shares_before if shares_before else weight_after / shares_after
        )
        rows.append(
            {
                "company": name,
                "type": change_type,
                "weight_before": weight_before,
                "weight_after": weight_after,
                "change_weight": round(weight_after - weight_before, 4),
                "shares_before": shares_before,
                "shares_after": shares_after,
                "change_shares": normalize_number(change_shares),
                "estimated_amount_100m": round(change_shares * unit_weight * market_cap / 100, 4),
            }
        )
    return rows


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
    """Daily PDF snapshots and derived change tables under one data directory."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.pdf_dir = data_dir / "pdf"
        self.changes_dir = data_dir / "changes"
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

    def build_changes(self, trade_date: str) -> dict[str, Any] | None:
        """Diff every ETF on trade_date against its most recent earlier snapshot."""
        earlier_dates = [value for value in self.pdf_dates() if value < trade_date]
        etfs: dict[str, dict[str, Any]] = {}
        rows: list[dict[str, Any]] = []

        for code, after in self.load_snapshot(trade_date)["etfs"].items():
            before_date = next(
                (
                    value
                    for value in reversed(earlier_dates)
                    if code in self.load_snapshot(value)["etfs"]
                ),
                None,
            )
            if before_date is None:
                continue

            before = self.load_snapshot(before_date)["etfs"][code]
            etfs[code] = {
                "name": after["name"],
                "brand": after["brand"],
                "category": after["category"],
                "market_cap_100m": before["market_cap_100m"],
                "before_date": before_date,
            }
            rows.extend({"etf": code, **row} for row in diff_holdings(before, after))

        if not etfs:
            return None
        rows.sort(key=lambda row: row["estimated_amount_100m"], reverse=True)
        return {"date": trade_date, "etfs": etfs, "rows": rows}

    def write_changes(self, trade_date: str) -> bool:
        changes = self.build_changes(trade_date)
        if changes is None:
            return False
        write_json(self.changes_dir / f"{trade_date}.json", changes)
        return True

    def change_dates(self) -> list[str]:
        return sorted(path.stem for path in self.changes_dir.glob("*.json"))
