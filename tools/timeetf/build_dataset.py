from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from timeetf_tracker import TimeETFClient, daterange, write_dataset


def build_dataset(idx: int, start_date: date, end_date: date, output_dir: Path) -> None:
    client = TimeETFClient()
    catalog = client.fetch_catalog()
    etf_meta = next(
        (item for item in catalog if item["idx"] == idx),
        {"idx": idx, "name": f"ETF {idx}", "tags": []},
    )

    holdings: list[dict] = []
    raw_html_map: dict[str, str] = {}

    total_days = (end_date - start_date).days + 1
    for position, current_date in enumerate(daterange(start_date, end_date), start=1):
        result = client.fetch_holdings(idx=idx, pdf_date=current_date)
        holdings.extend(result.holdings)
        raw_html_map[current_date.isoformat()] = result.raw_html
        print(
            f"[{position:>2}/{total_days}] {current_date.isoformat()} "
            f"rows={result.summary['constituent_count']}"
        )

    holdings_df = pd.DataFrame(holdings)
    if holdings_df.empty:
        holdings_df = pd.DataFrame(
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

    write_dataset(
        output_dir=output_dir,
        etf_meta=etf_meta,
        catalog=catalog,
        holdings_df=holdings_df,
        raw_html_map=raw_html_map,
        start_date=start_date,
        end_date=end_date,
    )
    print(f"Saved dataset to {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a TIME ETF holdings dataset.")
    parser.add_argument("--idx", type=int, default=24, help="ETF idx value from timeetf.co.kr")
    parser.add_argument(
        "--start-date",
        type=lambda value: datetime.strptime(value, "%Y-%m-%d").date(),
        default=date(2026, 3, 1),
    )
    parser.add_argument(
        "--end-date",
        type=lambda value: datetime.strptime(value, "%Y-%m-%d").date(),
        default=date.today(),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory to write dataset files into",
    )
    args = parser.parse_args()

    output_dir = args.output_dir or (
        Path(__file__).resolve().parents[2] / "timeetf" / "data"
    )

    build_dataset(
        idx=args.idx,
        start_date=args.start_date,
        end_date=args.end_date,
        output_dir=output_dir,
    )


if __name__ == "__main__":
    main()
