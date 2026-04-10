from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://timeetf.co.kr"
CATALOG_PATH = "/m31.php"
CONSTITUENT_PATH = "/constituent_popup.php"
DEFAULT_HEADERS = {
    "Accept": "text/html, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": f"{BASE_URL}{CATALOG_PATH}",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    ),
    "X-Requested-With": "XMLHttpRequest",
}


@dataclass(slots=True)
class FetchResult:
    summary: dict[str, Any]
    holdings: list[dict[str, Any]]
    raw_html: str


def parse_int(value: str) -> int:
    cleaned = re.sub(r"[^\d\-]", "", value or "")
    return int(cleaned) if cleaned else 0


def parse_float(value: str) -> float:
    cleaned = re.sub(r"[^\d\.\-]", "", value or "")
    return float(cleaned) if cleaned else 0.0


def daterange(start_date: date, end_date: date):
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


class TimeETFClient:
    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)

    def fetch_catalog(self) -> list[dict[str, Any]]:
        response = self.session.get(f"{BASE_URL}{CATALOG_PATH}", timeout=self.timeout)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "lxml")

        catalog: dict[int, dict[str, Any]] = {}
        for link in soup.select("a[href*='m11_view.php?idx=']"):
            href = link.get("href", "")
            match = re.search(r"idx=(\d+)", href)
            if not match:
                continue

            idx = int(match.group(1))
            row = link.find_parent("tr")
            if row is None:
                continue

            name_node = row.select_one(".name")
            if name_node is None:
                continue

            tag_nodes = row.select(".tag span")
            catalog[idx] = {
                "idx": idx,
                "name": name_node.get_text(" ", strip=True),
                "tags": [tag.get_text(" ", strip=True) for tag in tag_nodes if tag],
                "detail_url": f"{BASE_URL}/{href.lstrip('./')}",
            }

        return sorted(catalog.values(), key=lambda item: item["idx"])

    def fetch_holdings(self, idx: int, pdf_date: date) -> FetchResult:
        response = self.session.get(
            f"{BASE_URL}{CONSTITUENT_PATH}",
            params={
                "idx": idx,
                "pdfDate": pdf_date.isoformat(),
                "_": str(int(datetime.now().timestamp() * 1000)),
            },
            timeout=self.timeout,
        )
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "lxml")
        date_input = soup.select_one("input#pdfDate")
        rows = soup.select("table.moreList3 tbody tr")

        holdings: list[dict[str, Any]] = []
        for order, row in enumerate(rows, start=1):
            cells = [cell.get_text(" ", strip=True) for cell in row.select("td")]
            if len(cells) != 5:
                continue

            code, name, quantity, market_value, weight = cells
            holdings.append(
                {
                    "etf_idx": idx,
                    "requested_date": pdf_date.isoformat(),
                    "response_date": (
                        date_input.get("value") if date_input else pdf_date.isoformat()
                    ),
                    "row_order": order,
                    "code": code or f"SPECIAL::{name}",
                    "name": name,
                    "quantity": parse_int(quantity),
                    "market_value_krw": parse_int(market_value),
                    "weight_pct": parse_float(weight),
                }
            )

        summary = {
            "etf_idx": idx,
            "requested_date": pdf_date.isoformat(),
            "response_date": date_input.get("value") if date_input else pdf_date.isoformat(),
            "min_date": date_input.get("min") if date_input else None,
            "has_data": bool(holdings),
            "constituent_count": len(holdings),
            "total_market_value_krw": sum(item["market_value_krw"] for item in holdings),
            "total_weight_pct": round(sum(item["weight_pct"] for item in holdings), 4),
        }
        return FetchResult(summary=summary, holdings=holdings, raw_html=response.text)


def compute_changes(
    summary_df: pd.DataFrame,
    holdings_df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if summary_df.empty:
        return summary_df.copy(), pd.DataFrame()

    summary_df = summary_df.sort_values(["response_date", "requested_date"]).copy()
    summary_df["response_date"] = pd.to_datetime(summary_df["response_date"])

    if holdings_df.empty:
        summary_df["previous_valid_date"] = pd.NaT
        summary_df["added_count"] = 0
        summary_df["removed_count"] = 0
        summary_df["weight_changed_count"] = 0
        summary_df["turnover_count"] = 0
        return summary_df, pd.DataFrame()

    holdings_df = holdings_df.sort_values(["response_date", "row_order"]).copy()
    holdings_df["response_date"] = pd.to_datetime(holdings_df["response_date"])

    valid_dates = sorted(
        summary_df.loc[summary_df["has_data"], "response_date"].dropna().unique()
    )
    previous_valid_map: dict[pd.Timestamp, pd.Timestamp | None] = {}
    previous_valid = None
    for current_date in valid_dates:
        previous_valid_map[current_date] = previous_valid
        previous_valid = current_date

    summary_df["previous_valid_date"] = summary_df["response_date"].map(previous_valid_map)

    changes: list[dict[str, Any]] = []
    grouped = {key: group.copy() for key, group in holdings_df.groupby("response_date")}

    for current_date in valid_dates:
        previous_date = previous_valid_map[current_date]
        current_rows = grouped[current_date].set_index("code")
        if previous_date is None:
            summary_mask = summary_df["response_date"] == current_date
            summary_df.loc[
                summary_mask,
                ["added_count", "removed_count", "weight_changed_count", "turnover_count"],
            ] = 0
            continue

        previous_rows = grouped[previous_date].set_index("code")
        union_codes = sorted(set(current_rows.index) | set(previous_rows.index))
        added_count = 0
        removed_count = 0
        weight_changed_count = 0

        for code in union_codes:
            current_item = current_rows.loc[code] if code in current_rows.index else None
            previous_item = previous_rows.loc[code] if code in previous_rows.index else None

            if current_item is not None and previous_item is None:
                change_type = "added"
                added_count += 1
            elif current_item is None and previous_item is not None:
                change_type = "removed"
                removed_count += 1
            else:
                current_weight = float(current_item["weight_pct"])
                previous_weight = float(previous_item["weight_pct"])
                current_qty = int(current_item["quantity"])
                previous_qty = int(previous_item["quantity"])
                if current_weight != previous_weight or current_qty != previous_qty:
                    change_type = "reweighted"
                    weight_changed_count += 1
                else:
                    continue

            changes.append(
                {
                    "current_date": current_date,
                    "previous_date": previous_date,
                    "code": code,
                    "name": (
                        str(current_item["name"])
                        if current_item is not None
                        else str(previous_item["name"])
                    ),
                    "change_type": change_type,
                    "previous_weight_pct": (
                        float(previous_item["weight_pct"]) if previous_item is not None else 0.0
                    ),
                    "current_weight_pct": (
                        float(current_item["weight_pct"]) if current_item is not None else 0.0
                    ),
                    "weight_delta_pct": (
                        (float(current_item["weight_pct"]) if current_item is not None else 0.0)
                        - (
                            float(previous_item["weight_pct"])
                            if previous_item is not None
                            else 0.0
                        )
                    ),
                    "previous_quantity": (
                        int(previous_item["quantity"]) if previous_item is not None else 0
                    ),
                    "current_quantity": (
                        int(current_item["quantity"]) if current_item is not None else 0
                    ),
                    "quantity_delta": (
                        (int(current_item["quantity"]) if current_item is not None else 0)
                        - (int(previous_item["quantity"]) if previous_item is not None else 0)
                    ),
                }
            )

        summary_mask = summary_df["response_date"] == current_date
        summary_df.loc[summary_mask, "added_count"] = added_count
        summary_df.loc[summary_mask, "removed_count"] = removed_count
        summary_df.loc[summary_mask, "weight_changed_count"] = weight_changed_count
        summary_df.loc[summary_mask, "turnover_count"] = added_count + removed_count

    summary_df[
        ["added_count", "removed_count", "weight_changed_count", "turnover_count"]
    ] = (
        summary_df[
            ["added_count", "removed_count", "weight_changed_count", "turnover_count"]
        ]
        .fillna(0)
        .astype(int)
    )

    changes_df = pd.DataFrame(changes)
    if not changes_df.empty:
        changes_df["current_date"] = pd.to_datetime(changes_df["current_date"])
        changes_df["previous_date"] = pd.to_datetime(changes_df["previous_date"])
        changes_df = changes_df.sort_values(
            ["current_date", "change_type", "weight_delta_pct", "code"],
            ascending=[True, True, False, True],
        )

    return summary_df, changes_df


def build_summary_frame(meta: dict[str, Any], holdings_df: pd.DataFrame) -> pd.DataFrame:
    start_date = datetime.strptime(meta["start_date"], "%Y-%m-%d").date()
    end_date = datetime.strptime(meta["end_date"], "%Y-%m-%d").date()
    etf_idx = int(meta["etf"]["idx"])

    grouped = (
        holdings_df.groupby("requested_date", dropna=False)
        .agg(
            constituent_count=("code", "size"),
            total_market_value_krw=("market_value_krw", "sum"),
            total_weight_pct=("weight_pct", "sum"),
            response_date=("response_date", "first"),
        )
        .reset_index()
    )
    grouped["requested_date"] = pd.to_datetime(grouped["requested_date"])
    grouped["response_date"] = pd.to_datetime(grouped["response_date"])

    rows: list[dict[str, Any]] = []
    for current_date in daterange(start_date, end_date):
        rows.append(
            {
                "etf_idx": etf_idx,
                "requested_date": pd.Timestamp(current_date),
                "response_date": pd.Timestamp(current_date),
                "min_date": pd.NaT,
                "has_data": False,
                "constituent_count": 0,
                "total_market_value_krw": 0,
                "total_weight_pct": 0.0,
            }
        )

    summary_df = pd.DataFrame(rows)
    if grouped.empty:
        return summary_df

    merged = summary_df.merge(
        grouped,
        on="requested_date",
        how="left",
        suffixes=("", "_actual"),
    )
    merged["response_date"] = merged["response_date_actual"].combine_first(merged["response_date"])
    merged["constituent_count"] = (
        merged["constituent_count_actual"].fillna(merged["constituent_count"]).astype(int)
    )
    merged["total_market_value_krw"] = (
        merged["total_market_value_krw_actual"]
        .fillna(merged["total_market_value_krw"])
        .astype(int)
    )
    merged["total_weight_pct"] = (
        merged["total_weight_pct_actual"].fillna(merged["total_weight_pct"]).astype(float)
    )
    merged["has_data"] = merged["constituent_count"] > 0

    return merged[
        [
            "etf_idx",
            "requested_date",
            "response_date",
            "min_date",
            "has_data",
            "constituent_count",
            "total_market_value_krw",
            "total_weight_pct",
        ]
    ]


def write_dataset(
    output_dir: Path,
    etf_meta: dict[str, Any],
    catalog: list[dict[str, Any]],
    holdings_df: pd.DataFrame,
    raw_html_map: dict[str, str],
    start_date: date,
    end_date: date,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_html_dir = output_dir / "raw_html"
    raw_html_dir.mkdir(parents=True, exist_ok=True)

    valid_days = int(holdings_df["requested_date"].nunique()) if not holdings_df.empty else 0
    latest_response_date = None
    if not holdings_df.empty:
        latest_response_date = (
            pd.to_datetime(holdings_df["response_date"]).max().strftime("%Y-%m-%d")
        )

    meta = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source": BASE_URL,
        "etf": etf_meta,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "requested_days": int((end_date - start_date).days + 1),
        "valid_days": valid_days,
        "latest_response_date": latest_response_date,
    }

    (output_dir / "dataset_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    holdings_df.to_csv(
        output_dir / "holdings_history.csv",
        index=False,
        encoding="utf-8-sig",
    )

    for requested_date, raw_html in raw_html_map.items():
        (raw_html_dir / f"{requested_date}.html").write_text(raw_html, encoding="utf-8")


def load_dataset(
    dataset_dir: Path,
) -> tuple[dict[str, Any], pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    meta = json.loads((dataset_dir / "dataset_meta.json").read_text(encoding="utf-8"))
    holdings_path = dataset_dir / "holdings_history.csv"
    holdings_df = (
        pd.read_csv(holdings_path, dtype={"code": "string", "name": "string"})
        if holdings_path.exists()
        else pd.DataFrame(
            columns=[
                "etf_idx",
                "requested_date",
                "response_date",
                "row_order",
                "code",
                "name",
                "quantity",
                "market_value_krw",
                "weight_pct",
            ]
        )
    )

    for column in ["requested_date", "response_date"]:
        if column in holdings_df.columns:
            holdings_df[column] = pd.to_datetime(holdings_df[column], errors="coerce")

    summary_df = build_summary_frame(meta=meta, holdings_df=holdings_df)
    summary_df, changes_df = compute_changes(summary_df=summary_df, holdings_df=holdings_df)
    return meta, summary_df, holdings_df, changes_df
