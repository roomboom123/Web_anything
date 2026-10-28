from __future__ import annotations

import argparse
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

from active_etf_tracker import (
    SnapshotStore,
    build_session,
    fetch_active_etfs,
    fetch_cu_holdings,
    write_json,
)

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
# Stop early when WiseReport stops answering instead of waiting out every ETF's retries.
MAX_CONSECUTIVE_CONNECTION_ERRORS = 5


def collect_snapshots(delay_seconds: float) -> dict[str, dict[str, dict[str, Any]]]:
    """Fetch every domestic-equity active ETF's holdings, grouped by trade date."""
    session = build_session()
    etfs = fetch_active_etfs(session)
    logger.info("Found %d domestic-equity active ETFs", len(etfs))

    by_date: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    failures: list[str] = []
    connection_errors = 0
    for position, etf in enumerate(etfs, start=1):
        try:
            result = fetch_cu_holdings(session, etf["code"])
        except requests.ConnectionError as error:
            logger.warning("%s %s: %s", etf["code"], etf["name"], error)
            failures.append(etf["code"])
            connection_errors += 1
            if connection_errors >= MAX_CONSECUTIVE_CONNECTION_ERRORS:
                logger.error("WiseReport unreachable after %d attempts in a row; stopping", connection_errors)
                break
            continue
        except (requests.RequestException, ValueError) as error:
            logger.warning("%s %s: %s", etf["code"], etf["name"], error)
            failures.append(etf["code"])
            continue

        connection_errors = 0
        if result is None:
            logger.warning("%s %s: no CU holdings", etf["code"], etf["name"])
            failures.append(etf["code"])
        else:
            trade_date, holdings = result
            by_date[trade_date][etf["code"]] = {**etf, "holdings": holdings}
            logger.info(
                "[%d/%d] %s %s %s rows=%d",
                position, len(etfs), trade_date, etf["code"], etf["name"], len(holdings),
            )
        time.sleep(delay_seconds)

    if not by_date:
        raise SystemExit("No ETF holdings were collected")
    if failures:
        logger.warning("Skipped %d ETFs: %s", len(failures), ", ".join(failures))
    return by_date


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect active ETF holdings into daily snapshots."
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "activeetf" / "data",
    )
    parser.add_argument("--delay", type=float, default=0.3, help="Seconds between requests")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    store = SnapshotStore(args.data_dir)
    by_date = collect_snapshots(args.delay)
    for trade_date, etfs in sorted(by_date.items()):
        store.upsert_snapshot(trade_date, etfs)

    pdf_dates = store.pdf_dates()
    write_json(
        args.data_dir / "index.json",
        {
            "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
            "pdf_dates": pdf_dates[::-1],
            "latest_etf_count": len(store.load_snapshot(pdf_dates[-1])["etfs"]),
        },
    )
    logger.info("Saved data to %s", args.data_dir)


if __name__ == "__main__":
    main()
