from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from timeetf_tracker import load_dataset


def json_default(value):
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def fetch_naver_price_history(
    stock_code: str,
    start_date: str,
    end_date: str,
    max_pages: int = 20,
) -> list[dict]:
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()

    rows: list[dict] = []
    seen_dates: set[str] = set()

    for page in range(1, max_pages + 1):
        response = session.get(
            "https://finance.naver.com/item/sise_day.naver",
            params={"code": stock_code, "page": page},
            timeout=30,
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "lxml")
        table_rows = soup.select("table.type2 tr")
        if not table_rows:
            break

        page_added = 0
        stop = False
        for tr in table_rows:
            cells = [cell.get_text(" ", strip=True) for cell in tr.select("td")]
            if len(cells) != 7:
                continue

            date_text = cells[0].replace(".", "-")
            try:
                row_date = datetime.strptime(date_text, "%Y-%m-%d").date()
            except ValueError:
                continue

            if row_date < start_dt:
                stop = True
                continue
            if row_date > end_dt:
                continue
            if date_text in seen_dates:
                continue

            rows.append(
                {
                    "date": date_text,
                    "close": int(cells[1].replace(",", "")),
                }
            )
            seen_dates.add(date_text)
            page_added += 1

        if stop and page_added == 0:
            break

    rows.sort(key=lambda item: item["date"])
    return rows


def serialize_report(dataset_dir: Path) -> dict:
    meta, summary_df, holdings_df, _changes_df = load_dataset(dataset_dir)

    summary = summary_df.copy()
    if not summary.empty:
        summary["requested_date"] = summary["requested_date"].dt.strftime("%Y-%m-%d")
        summary["response_date"] = summary["response_date"].dt.strftime("%Y-%m-%d")
        summary = summary.astype(object).where(summary.notna(), None)

    holdings = holdings_df.copy()
    if not holdings.empty:
        holdings["requested_date"] = holdings["requested_date"].dt.strftime("%Y-%m-%d")
        holdings["response_date"] = holdings["response_date"].dt.strftime("%Y-%m-%d")
        holdings = holdings.astype(object).where(holdings.notna(), None)

    default_stock_code = ""
    if not holdings.empty:
        preferred_rows = holdings.loc[holdings["name"] == "리브스메드"].copy()
        if not preferred_rows.empty:
            default_stock_code = str(preferred_rows.iloc[0]["code"])
        else:
            latest_date = meta.get("latest_response_date")
            if latest_date:
                latest_rows = holdings.loc[holdings["response_date"] == latest_date].copy()
                if not latest_rows.empty:
                    latest_rows = latest_rows.sort_values("weight_pct", ascending=False)
                    default_stock_code = str(latest_rows.iloc[0]["code"])

    return {
        "meta": meta,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "default_stock_code": default_stock_code,
        "price_overlay": {
            "code": "491000",
            "name": "리브스메드",
            "series": fetch_naver_price_history(
                stock_code="491000",
                start_date=meta["start_date"],
                end_date=meta["end_date"],
            ),
        },
        "summary": summary.to_dict(orient="records"),
        "holdings": holdings.to_dict(orient="records"),
    }


def build_html(payload: dict) -> str:
    template = """<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__TITLE__</title>
  <style>
    :root {
      --bg: #f3f5f6;
      --panel: #ffffff;
      --panel-soft: #f8faf9;
      --ink: #17252b;
      --muted: #66757c;
      --line: #dfe6e8;
      --accent: #087c73;
      --accent-soft: #e7f3f1;
      --accent-2: #c96b12;
      --danger: #b42318;
      --shadow: 0 16px 42px rgba(23, 37, 43, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }
    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 20px;
    }
    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: end;
      margin-bottom: 14px;
    }
    .title-block h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.18;
      letter-spacing: 0;
    }
    .title-block p {
      margin: 7px 0 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .range-control {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .range-button {
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      padding: 8px 10px;
      white-space: nowrap;
    }
    .range-button.active {
      background: var(--accent);
      color: #ffffff;
    }
    .focus-panel {
      display: grid;
      grid-template-columns: minmax(0, 0.95fr) minmax(420px, 1.4fr);
      gap: 16px;
      background: #10282e;
      color: #ffffff;
      border-radius: 8px;
      padding: 18px;
      box-shadow: var(--shadow);
      margin-bottom: 16px;
    }
    .focus-kicker {
      color: #8ed7cf;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }
    .focus-title-row {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 12px;
    }
    .focus-title {
      font-size: 31px;
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .focus-sub {
      margin-top: 8px;
      color: rgba(255, 255, 255, 0.72);
      font-size: 13px;
    }
    .focus-action {
      border: 1px solid rgba(255, 255, 255, 0.24);
      background: rgba(255, 255, 255, 0.10);
      color: #ffffff;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 800;
      padding: 9px 11px;
      white-space: nowrap;
    }
    .focus-action:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .focus-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 18px;
    }
    .focus-metric {
      min-height: 74px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      padding: 12px;
    }
    .focus-metric .label {
      color: rgba(255, 255, 255, 0.68);
      font-size: 12px;
      margin-bottom: 7px;
    }
    .focus-metric .value {
      color: #ffffff;
      font-size: 23px;
      font-weight: 800;
      line-height: 1.1;
    }
    .focus-chart-wrap {
      min-width: 0;
    }
    .focus-chart-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 9px;
      color: rgba(255, 255, 255, 0.76);
      font-size: 13px;
      font-weight: 700;
    }
    .focus-chart-head span:last-child {
      color: #f6b979;
    }
    .focus-panel .chart-box {
      height: 260px;
      border-color: rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.06);
    }
    .focus-panel .table-wrap {
      margin-top: 10px;
      border-color: rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.06);
      max-height: 188px;
    }
    .focus-panel table {
      min-width: 420px;
    }
    .focus-panel th {
      background: #18373d;
      color: rgba(255, 255, 255, 0.72);
    }
    .focus-panel td {
      color: rgba(255, 255, 255, 0.88);
      border-bottom-color: rgba(255, 255, 255, 0.10);
    }
    .layout {
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .section {
      padding: 16px;
    }
    .section h2 {
      margin: 0 0 12px 0;
      font-size: 18px;
      letter-spacing: 0;
    }
    .section h3 {
      margin: 0 0 12px 0;
      font-size: 15px;
      color: var(--muted);
      font-weight: 600;
    }
    .stock-nav {
      position: sticky;
      top: 18px;
    }
    .stock-search {
      width: 100%;
      padding: 11px 12px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      font-size: 14px;
      outline: none;
      margin-bottom: 10px;
    }
    .stock-search:focus {
      border-color: rgba(15, 118, 110, 0.35);
      box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.08);
    }
    .stock-button-list {
      max-height: calc(100vh - 220px);
      overflow: auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .stock-button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      padding: 10px 11px;
      border-radius: 7px;
      font-size: 13px;
      cursor: pointer;
      transition: 0.18s ease;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      text-align: left;
    }
    .stock-button:hover {
      border-color: rgba(15, 118, 110, 0.28);
      background: var(--accent-soft);
    }
    .stock-button.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      box-shadow: 0 10px 24px rgba(15, 118, 110, 0.20);
    }
    .stock-button.important:not(.active) {
      border-color: rgba(8, 124, 115, 0.42);
      background: var(--accent-soft);
    }
    .stock-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }
    .stock-meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
    }
    .stock-button.active .stock-meta {
      color: rgba(255, 255, 255, 0.78);
    }
    .stock-weight {
      font-size: 12px;
      font-weight: 800;
      color: var(--accent);
    }
    .stock-button.active .stock-weight {
      color: #ffffff;
    }
    .detail-top {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: start;
      margin-bottom: 12px;
    }
    .detail-title {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .detail-sub {
      color: var(--muted);
      font-size: 14px;
      margin-top: 6px;
    }
    .mini-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }
    .mini-stat {
      min-width: 112px;
      background: var(--panel-soft);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 11px 12px;
    }
    .mini-stat .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .mini-stat .value {
      font-size: 19px;
      font-weight: 700;
      line-height: 1.1;
    }
    .delta-up { color: var(--accent); }
    .delta-down { color: var(--danger); }
    .chart-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-top: 16px;
    }
    .chart-box {
      width: 100%;
      height: 318px;
      border-radius: 8px;
      background: var(--panel-soft);
      border: 1px solid var(--line);
      overflow: hidden;
      position: relative;
    }
    .chart-box svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      margin-top: 16px;
      max-height: 360px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 480px;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid rgba(22,48,56,0.08);
      text-align: left;
      font-size: 14px;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: #f8faf8;
      z-index: 1;
      color: var(--muted);
      font-weight: 600;
    }
    .trend-wrap {
      margin-top: 16px;
    }
    .trend-wrap .chart-box {
      height: 300px;
    }
    .empty {
      padding: 18px;
      color: var(--muted);
    }
    .footer {
      margin-top: 18px;
      padding: 0 4px;
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 1200px) {
      .focus-panel {
        grid-template-columns: 1fr;
      }
      .layout {
        grid-template-columns: 1fr;
      }
      .stock-nav {
        position: static;
      }
    }
    @media (max-width: 900px) {
      .shell {
        padding: 12px;
      }
      .topbar {
        grid-template-columns: 1fr;
        align-items: start;
      }
      .range-control {
        width: 100%;
        overflow-x: auto;
      }
      .focus-panel {
        padding: 14px;
      }
      .focus-title-row {
        display: block;
      }
      .focus-action {
        margin-top: 12px;
      }
      .focus-metrics {
        grid-template-columns: 1fr 1fr;
      }
      .chart-grid {
        grid-template-columns: 1fr;
      }
      .detail-top {
        flex-direction: column;
        align-items: start;
      }
      .mini-stats {
        width: 100%;
        justify-content: start;
      }
    }
    @media (max-width: 560px) {
      .focus-metrics {
        grid-template-columns: 1fr;
      }
      .mini-stat {
        flex: 1 1 45%;
      }
      th, td {
        padding: 9px 10px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="title-block">
        <h1>__ETF_NAME__</h1>
        <p id="report-subtitle">구성종목 비중, 순위, 리브스메드 흐름</p>
      </div>
      <div class="range-control" aria-label="표시 기간">
        <button class="range-button" data-range="14" type="button">최근 14일</button>
        <button class="range-button active" data-range="30" type="button">최근 30일</button>
        <button class="range-button" data-range="60" type="button">최근 60일</button>
        <button class="range-button" data-range="all" type="button">전체</button>
      </div>
    </header>

    <section class="focus-panel" id="revesmed-focus">
      <div>
        <div class="focus-kicker">REVESMED FOCUS</div>
        <div class="focus-title-row">
          <div>
            <div class="focus-title" id="focus-title">리브스메드</div>
            <div class="focus-sub" id="focus-sub">-</div>
          </div>
          <button class="focus-action" id="focus-jump" type="button">상세 보기</button>
        </div>
        <div class="focus-metrics">
          <div class="focus-metric">
            <div class="label">최신 비중</div>
            <div class="value" id="focus-weight">-</div>
          </div>
          <div class="focus-metric">
            <div class="label">최신 순위</div>
            <div class="value" id="focus-rank">-</div>
          </div>
          <div class="focus-metric">
            <div class="label">전일 대비</div>
            <div class="value" id="focus-delta">-</div>
          </div>
          <div class="focus-metric">
            <div class="label">최신 종가</div>
            <div class="value" id="focus-price">-</div>
          </div>
        </div>
      </div>
      <div class="focus-chart-wrap">
        <div class="focus-chart-head">
          <span>비중과 주가</span>
          <span id="focus-range-label">최근 30일</span>
        </div>
        <div class="chart-box" id="focus-chart"></div>
        <div class="table-wrap" id="focus-table"></div>
      </div>
    </section>

    <section class="layout">
      <aside class="card section stock-nav">
        <h2>종목 선택</h2>
        <input id="stock-search" class="stock-search" type="text" placeholder="종목명 또는 코드 검색">
        <div id="stock-button-list" class="stock-button-list"></div>
      </aside>

      <main class="card section">
        <div class="detail-top">
          <div>
            <div id="detail-title" class="detail-title">선택된 종목</div>
            <div id="detail-sub" class="detail-sub"></div>
          </div>
          <div class="mini-stats">
            <div class="mini-stat">
              <div class="label">최신 비중</div>
              <div id="stat-latest-weight" class="value">-</div>
            </div>
            <div class="mini-stat">
              <div class="label">최신 순위</div>
              <div id="stat-latest-rank" class="value">-</div>
            </div>
            <div class="mini-stat">
              <div class="label">표시 일수</div>
              <div id="stat-span" class="value">-</div>
            </div>
            <div class="mini-stat">
              <div class="label">비중 변화</div>
              <div id="stat-delta" class="value">-</div>
            </div>
          </div>
        </div>

        <div class="chart-grid">
          <div>
            <h3 id="weight-chart-title">비중 추이</h3>
            <div class="chart-box" id="stock-weight-chart"></div>
          </div>
          <div>
            <h3>순위 추이</h3>
            <div class="chart-box" id="stock-rank-chart"></div>
          </div>
        </div>

        <div class="table-wrap" id="stock-table"></div>
      </main>
    </section>

    <section class="card section trend-wrap">
      <h2>전체 흐름</h2>
      <h3 id="count-chart-title">날짜별 구성 종목 수</h3>
      <div class="chart-box" id="count-chart"></div>
    </section>

    <div class="footer">
      생성 시각: __GENERATED_AT__ | 내장 데이터 기반 정적 HTML 리포트
    </div>
  </div>

  <script>
    const reportData = __DATA_JSON__;
    const summary = reportData.summary || [];
    const holdings = reportData.holdings || [];
    const validSummary = summary.filter(row => row.has_data);
    const priceOverlay = reportData.price_overlay || { code: "", name: "", series: [] };
    const FOCUS_STOCK_NAME = "리브스메드";
    const rowsByDate = new Map();
    holdings.forEach(row => {
      if (!rowsByDate.has(row.response_date)) {
        rowsByDate.set(row.response_date, []);
      }
      rowsByDate.get(row.response_date).push(row);
    });
    rowsByDate.forEach(rows => {
      rows.sort((a, b) => Number(b.weight_pct) - Number(a.weight_pct));
    });
    const focusStockCode = findFocusStockCode();
    let activeStockCode = reportData.default_stock_code || "";
    let activeRangeDays = 30;

    function formatNumber(value) {
      return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
    }

    function formatCurrency(value) {
      return `${formatNumber(Math.round(Number(value || 0)))}원`;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function formatShortDate(value) {
      return String(value || "").slice(5).replace("-", ".");
    }

    function getDateValue(value) {
      return new Date(`${value}T00:00:00`).getTime();
    }

    function sortByDateAsc(a, b) {
      return String(a.response_date).localeCompare(String(b.response_date));
    }

    function sortByDateDesc(a, b) {
      return String(b.response_date).localeCompare(String(a.response_date));
    }

    function getRangeLabel() {
      return activeRangeDays === "all" ? "전체 기간" : `최근 ${activeRangeDays}일`;
    }

    function filterRowsByRange(rows, dateKey="response_date") {
      if (!rows || rows.length === 0 || activeRangeDays === "all") {
        return rows || [];
      }
      const latestTime = Math.max(...rows.map(row => getDateValue(row[dateKey])));
      const cutoff = latestTime - (Number(activeRangeDays) - 1) * 24 * 60 * 60 * 1000;
      const filtered = rows.filter(row => getDateValue(row[dateKey]) >= cutoff);
      return filtered.length > 0 ? filtered : rows;
    }

    function formatDelta(value, suffix="%") {
      const numeric = Number(value || 0);
      if (Math.abs(numeric) < 0.005) {
        return `0.00${suffix}`;
      }
      const sign = numeric > 0 ? "+" : "";
      return `${sign}${numeric.toFixed(2)}${suffix}`;
    }

    function setDeltaElement(elementId, value, suffix="%") {
      const target = document.getElementById(elementId);
      const numeric = Number(value || 0);
      target.textContent = formatDelta(numeric, suffix);
      target.classList.toggle("delta-up", numeric > 0);
      target.classList.toggle("delta-down", numeric < 0);
    }

    function findFocusStockCode() {
      const preferred = holdings.find(row => row.name === FOCUS_STOCK_NAME);
      if (preferred) return String(preferred.code);
      const byOverlay = holdings.find(row => String(row.code) === String(priceOverlay.code));
      return byOverlay ? String(byOverlay.code) : "";
    }

    function getRowsForCode(code) {
      return holdings
        .filter(row => String(row.code) === String(code))
        .sort(sortByDateAsc);
    }

    function addRanks(rows) {
      return rows.map(row => {
        const sameDate = rowsByDate.get(row.response_date) || [];
        const rank = sameDate.findIndex(item => String(item.code) === String(row.code)) + 1;
        return { ...row, rank: rank || null };
      });
    }

    function getLatestPrice(dateText) {
      const series = (priceOverlay.series || []).slice().sort((a, b) => a.date.localeCompare(b.date));
      if (series.length === 0) return null;
      let latest = null;
      for (const item of series) {
        if (item.date <= dateText) {
          latest = item;
        }
      }
      return latest || series[series.length - 1];
    }

    function renderTable(targetId, columns, rows) {
      const root = document.getElementById(targetId);
      if (!rows || rows.length === 0) {
        root.innerHTML = '<div class="empty">표시할 데이터가 없습니다.</div>';
        return;
      }
      const thead = columns.map(col => `<th>${col.label}</th>`).join("");
      const tbody = rows.map(row => {
        const tds = columns.map(col => `<td>${col.render ? col.render(row[col.key], row) : (row[col.key] ?? "")}</td>`).join("");
        return `<tr>${tds}</tr>`;
      }).join("");
      root.innerHTML = `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
    }

    function renderSvgLineChart(targetId, rows, yKey, color, labelFormatter, reverseY=false, dark=false) {
      const root = document.getElementById(targetId);
      if (!rows || rows.length === 0) {
        root.innerHTML = '<div class="empty">표시할 데이터가 없습니다.</div>';
        return;
      }
      const width = root.clientWidth || 700;
      const height = root.clientHeight || 340;
      const margin = { top: 22, right: 18, bottom: 40, left: 52 };
      const rawMinY = Math.min(...rows.map(r => Number(r[yKey] || 0)));
      const rawMaxY = Math.max(...rows.map(r => Number(r[yKey] || 0)));
      const minY = rawMinY === rawMaxY ? rawMinY - 1 : rawMinY;
      const maxY = rawMinY === rawMaxY ? rawMaxY + 1 : rawMaxY;
      const spanY = maxY - minY || 1;
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const axisColor = dark ? "rgba(255,255,255,0.62)" : "#647076";
      const gridColor = dark ? "rgba(255,255,255,0.12)" : "rgba(22,48,56,0.10)";
      const points = rows.map((row, idx) => {
        const x = margin.left + (rows.length === 1 ? innerW / 2 : (innerW * idx) / (rows.length - 1));
        const ratio = (Number(row[yKey] || 0) - minY) / spanY;
        const y = reverseY
          ? margin.top + ratio * innerH
          : margin.top + innerH - ratio * innerH;
        return { x, y, row };
      });
      const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
      const yTicks = Array.from({ length: 5 }, (_, idx) => minY + (spanY * idx) / 4);
      const tickLines = yTicks.map(value => {
        const ratio = (value - minY) / spanY;
        const y = reverseY
          ? margin.top + ratio * innerH
          : margin.top + innerH - ratio * innerH;
        return `
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${gridColor}" />
          <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="${axisColor}" font-size="11">${labelFormatter ? labelFormatter(value) : Math.round(value)}</text>
        `;
      }).join("");
      const maxLabels = width < 560 ? 4 : 7;
      const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));
      const xLabels = points
        .filter((_, idx) => idx === 0 || idx === points.length - 1 || idx % labelStep === 0)
        .map(p => `<text x="${p.x}" y="${height - 12}" text-anchor="middle" fill="${axisColor}" font-size="11">${formatShortDate(p.row.response_date)}</text>`)
        .join("");
      const dots = points.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${color}" />
        <title>${p.row.response_date} : ${labelFormatter ? labelFormatter(p.row[yKey]) : p.row[yKey]}</title>
      `).join("");
      root.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          ${tickLines}
          <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
          ${dots}
          ${xLabels}
        </svg>
      `;
    }

    function renderWeightPriceOverlayChart(targetId, rows, priceSeries, dark=false) {
      const root = document.getElementById(targetId);
      if (!rows || rows.length === 0) {
        root.innerHTML = '<div class="empty">표시할 데이터가 없습니다.</div>';
        return;
      }
      const priceMap = new Map((priceSeries || []).map(item => [item.date, Number(item.close || 0)]));
      const merged = rows
        .map(row => ({ ...row, close: priceMap.get(row.response_date) }))
        .filter(row => row.close !== undefined && row.close !== null);

      if (merged.length === 0) {
        renderSvgLineChart(targetId, rows, "weight_pct", "#0f766e", value => `${Number(value).toFixed(2)}%`, false, dark);
        return;
      }

      const width = root.clientWidth || 700;
      const height = root.clientHeight || 340;
      const margin = { top: 22, right: 54, bottom: 40, left: 52 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const axisColor = dark ? "rgba(255,255,255,0.62)" : "#647076";
      const gridColor = dark ? "rgba(255,255,255,0.12)" : "rgba(22,48,56,0.10)";
      const weightColor = dark ? "#51d5c8" : "#0f766e";
      const priceColor = dark ? "#f2a65a" : "#d97706";

      const rawWeightMin = Math.min(...merged.map(r => Number(r.weight_pct || 0)));
      const rawWeightMax = Math.max(...merged.map(r => Number(r.weight_pct || 0)));
      const weightMin = rawWeightMin === rawWeightMax ? rawWeightMin - 1 : rawWeightMin;
      const weightMax = rawWeightMin === rawWeightMax ? rawWeightMax + 1 : rawWeightMax;
      const weightSpan = weightMax - weightMin || 1;

      const rawPriceMin = Math.min(...merged.map(r => Number(r.close || 0)));
      const rawPriceMax = Math.max(...merged.map(r => Number(r.close || 0)));
      const priceMin = rawPriceMin === rawPriceMax ? rawPriceMin - 1 : rawPriceMin;
      const priceMax = rawPriceMin === rawPriceMax ? rawPriceMax + 1 : rawPriceMax;
      const priceSpan = priceMax - priceMin || 1;

      const points = merged.map((row, idx) => {
        const x = margin.left + (merged.length === 1 ? innerW / 2 : (innerW * idx) / (merged.length - 1));
        const weightY = margin.top + innerH - ((Number(row.weight_pct || 0) - weightMin) / weightSpan) * innerH;
        const priceY = margin.top + innerH - ((Number(row.close || 0) - priceMin) / priceSpan) * innerH;
        return { x, weightY, priceY, row };
      });

      const weightLine = points.map(p => `${p.x},${p.weightY}`).join(" ");
      const priceLine = points.map(p => `${p.x},${p.priceY}`).join(" ");

      const leftTicks = Array.from({ length: 5 }, (_, idx) => weightMin + (weightSpan * idx) / 4);
      const rightTicks = Array.from({ length: 5 }, (_, idx) => priceMin + (priceSpan * idx) / 4);

      const leftAxis = leftTicks.map(value => {
        const y = margin.top + innerH - ((value - weightMin) / weightSpan) * innerH;
        return `
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${gridColor}" />
          <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="${axisColor}" font-size="11">${Number(value).toFixed(2)}%</text>
        `;
      }).join("");

      const rightAxis = rightTicks.map(value => {
        const y = margin.top + innerH - ((value - priceMin) / priceSpan) * innerH;
        return `<text x="${width - margin.right + 10}" y="${y + 4}" text-anchor="start" fill="${axisColor}" font-size="11">${formatNumber(Math.round(value))}</text>`;
      }).join("");

      const maxLabels = width < 560 ? 4 : 7;
      const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));
      const xLabels = points
        .filter((_, idx) => idx === 0 || idx === points.length - 1 || idx % labelStep === 0)
        .map(p => `<text x="${p.x}" y="${height - 12}" text-anchor="middle" fill="${axisColor}" font-size="11">${formatShortDate(p.row.response_date)}</text>`)
        .join("");

      const weightDots = points.map(p => `
        <circle cx="${p.x}" cy="${p.weightY}" r="4.5" fill="${weightColor}" />
        <title>${p.row.response_date} | 비중 ${Number(p.row.weight_pct).toFixed(2)}%</title>
      `).join("");

      const priceDots = points.map(p => `
        <circle cx="${p.x}" cy="${p.priceY}" r="4.5" fill="${priceColor}" />
        <title>${p.row.response_date} | 종가 ${formatNumber(p.row.close)}원</title>
      `).join("");

      root.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          ${leftAxis}
          ${rightAxis}
          <polyline points="${weightLine}" fill="none" stroke="${weightColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
          <polyline points="${priceLine}" fill="none" stroke="${priceColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
          ${weightDots}
          ${priceDots}
          ${xLabels}
          <text x="${margin.left}" y="16" fill="${weightColor}" font-size="12" font-weight="700">비중(%)</text>
          <text x="${width - margin.right}" y="16" text-anchor="end" fill="${priceColor}" font-size="12" font-weight="700">종가(원)</text>
        </svg>
      `;
    }

    function getStockOptions() {
      return Array.from(new Map(
        holdings.map(row => [`${row.code}||${row.name}`, { code: row.code, name: row.name }])
      ).values()).sort((a, b) => {
        if (a.name === FOCUS_STOCK_NAME && b.name !== FOCUS_STOCK_NAME) return -1;
        if (a.name !== FOCUS_STOCK_NAME && b.name === FOCUS_STOCK_NAME) return 1;
        return a.name.localeCompare(b.name, "ko");
      });
    }

    function buildStockButtons(filterText="") {
      const root = document.getElementById("stock-button-list");
      const keyword = filterText.trim().toLowerCase();
      const options = getStockOptions().filter(item => {
        if (!keyword) return true;
        return item.name.toLowerCase().includes(keyword) || String(item.code).toLowerCase().includes(keyword);
      });
      root.innerHTML = options.map(item => `
        <button
          class="stock-button ${String(item.code) === String(activeStockCode) ? "active" : ""} ${item.name === FOCUS_STOCK_NAME ? "important" : ""}"
          data-code="${item.code}"
          type="button"
        >
          <span>
            <span class="stock-name">${escapeHtml(item.name)}</span>
            <span class="stock-meta">${escapeHtml(item.code)}</span>
          </span>
          <span class="stock-weight">${getLatestWeightText(item.code)}</span>
        </button>
      `).join("");
      root.querySelectorAll(".stock-button").forEach(button => {
        button.addEventListener("click", () => {
          activeStockCode = button.dataset.code;
          buildStockButtons(document.getElementById("stock-search").value);
          renderStockDetail(activeStockCode);
        });
      });
    }

    function getLatestWeightText(code) {
      const rows = getRowsForCode(code);
      if (rows.length === 0) return "-";
      const latest = rows[rows.length - 1];
      return `${Number(latest.weight_pct).toFixed(2)}%`;
    }

    function renderFocusPanel() {
      if (!focusStockCode) {
        document.getElementById("revesmed-focus").style.display = "none";
        return;
      }
      document.getElementById("revesmed-focus").style.display = "";
      const rankedAllRows = addRanks(getRowsForCode(focusStockCode));
      const chartRows = filterRowsByRange(rankedAllRows);
      if (rankedAllRows.length === 0) {
        return;
      }
      const latest = rankedAllRows[rankedAllRows.length - 1];
      const prev = rankedAllRows.length > 1 ? rankedAllRows[rankedAllRows.length - 2] : null;
      const latestPrice = getLatestPrice(latest.response_date);

      document.getElementById("focus-title").textContent = latest.name;
      document.getElementById("focus-sub").textContent = `${latest.code} | 최신 ${latest.response_date} | ${getRangeLabel()} ${chartRows.length}일`;
      document.getElementById("focus-weight").textContent = `${Number(latest.weight_pct).toFixed(2)}%`;
      document.getElementById("focus-rank").textContent = `${latest.rank}위`;
      document.getElementById("focus-price").textContent = latestPrice ? formatCurrency(latestPrice.close) : "-";
      document.getElementById("focus-range-label").textContent = getRangeLabel();
      setDeltaElement("focus-delta", prev ? Number(latest.weight_pct) - Number(prev.weight_pct) : 0);
      renderWeightPriceOverlayChart("focus-chart", chartRows, priceOverlay.series || [], true);
      renderTable("focus-table", [
        { key: "response_date", label: "날짜" },
        { key: "weight_pct", label: "비중", render: value => `${Number(value).toFixed(2)}%` },
        { key: "rank", label: "순위", render: value => `${value}위` },
        { key: "quantity", label: "수량", render: value => formatNumber(value) }
      ], chartRows.slice().sort(sortByDateDesc).slice(0, 8));
    }

    function renderStockDetail(code) {
      const rows = getRowsForCode(code);
      if (rows.length === 0) {
        return;
      }
      const rankedAllRows = addRanks(rows);
      const rankedRows = filterRowsByRange(rankedAllRows);
      const selected = rankedAllRows[rankedAllRows.length - 1];
      const prev = rankedAllRows.length > 1 ? rankedAllRows[rankedAllRows.length - 2] : null;
      const delta = prev ? Number(selected.weight_pct) - Number(prev.weight_pct) : 0;
      const visibleStart = rankedRows[0].response_date;
      const visibleEnd = rankedRows[rankedRows.length - 1].response_date;

      document.getElementById("detail-title").textContent = selected.name;
      document.getElementById("detail-sub").textContent = `${selected.code} | 최신 ${selected.response_date} | 표시 ${visibleStart} ~ ${visibleEnd}`;
      document.getElementById("stat-latest-weight").textContent = `${Number(selected.weight_pct).toFixed(2)}%`;
      document.getElementById("stat-latest-rank").textContent = `${selected.rank}위`;
      document.getElementById("stat-span").textContent = `${rankedRows.length}일`;
      setDeltaElement("stat-delta", delta);
      document.getElementById("weight-chart-title").textContent =
        String(code) === String(priceOverlay.code) ? "비중 추이 + 주가" : "비중 추이";

      if (String(code) === String(priceOverlay.code)) {
        renderWeightPriceOverlayChart("stock-weight-chart", rankedRows, priceOverlay.series || []);
      } else {
        renderSvgLineChart(
          "stock-weight-chart",
          rankedRows,
          "weight_pct",
          "#0f766e",
          value => `${Number(value).toFixed(2)}%`
        );
      }
      renderSvgLineChart(
        "stock-rank-chart",
        rankedRows,
        "rank",
        "#d97706",
        value => `${Math.round(value)}위`,
        true
      );
      renderTable("stock-table", [
        { key: "response_date", label: "날짜" },
        { key: "weight_pct", label: "비중(%)", render: value => Number(value).toFixed(2) },
        { key: "rank", label: "순위", render: value => `${value}위` },
        { key: "quantity", label: "수량", render: value => formatNumber(value) },
        { key: "market_value_krw", label: "평가금액", render: value => formatCurrency(value) }
      ], rankedRows.slice().sort(sortByDateDesc));
    }

    function initSearch() {
      const input = document.getElementById("stock-search");
      input.addEventListener("input", () => {
        buildStockButtons(input.value);
      });
    }

    function initDefaultStock() {
      if (!activeStockCode) {
        activeStockCode = focusStockCode || (getStockOptions()[0]?.code ?? "");
      }
      buildStockButtons();
      if (activeStockCode) {
        renderStockDetail(activeStockCode);
      }
    }

    function renderCountTrend() {
      const rows = filterRowsByRange(validSummary);
      document.getElementById("count-chart-title").textContent = `날짜별 구성 종목 수 (${getRangeLabel()})`;
      renderSvgLineChart(
        "count-chart",
        rows,
        "constituent_count",
        "#0f766e",
        value => formatNumber(Math.round(value))
      );
    }

    function initRangeControl() {
      document.querySelectorAll(".range-button").forEach(button => {
        button.addEventListener("click", () => {
          const value = button.dataset.range;
          activeRangeDays = value === "all" ? "all" : Number(value);
          document.querySelectorAll(".range-button").forEach(item => {
            item.classList.toggle("active", item === button);
          });
          renderFocusPanel();
          if (activeStockCode) {
            renderStockDetail(activeStockCode);
          }
          renderCountTrend();
        });
      });
    }

    function initFocusJump() {
      document.getElementById("focus-jump").addEventListener("click", () => {
        if (!focusStockCode) return;
        activeStockCode = focusStockCode;
        buildStockButtons(document.getElementById("stock-search").value);
        renderStockDetail(activeStockCode);
        document.querySelector(".layout").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    function initSubtitle() {
      const meta = reportData.meta || {};
      const latest = meta.latest_response_date || (validSummary.length ? validSummary[validSummary.length - 1].response_date : "-");
      document.getElementById("report-subtitle").textContent =
        `${meta.start_date || "-"} ~ ${meta.end_date || "-"} | 최신 기준일 ${latest}`;
    }

    initSubtitle();
    initRangeControl();
    initFocusJump();
    initSearch();
    initDefaultStock();
    renderFocusPanel();
    renderCountTrend();

    window.addEventListener("resize", () => {
      renderFocusPanel();
      if (activeStockCode) {
        renderStockDetail(activeStockCode);
      }
      renderCountTrend();
    });
  </script>
</body>
</html>
"""
    return (
        template.replace("__TITLE__", f'{payload["meta"]["etf"]["name"]} 리포트')
        .replace("__ETF_NAME__", payload["meta"]["etf"]["name"])
        .replace("__GENERATED_AT__", payload["generated_at"])
        .replace(
            "__DATA_JSON__",
            json.dumps(payload, ensure_ascii=False, default=json_default),
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a self-contained HTML report.")
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "timeetf" / "data",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "timeetf" / "index.html",
    )
    args = parser.parse_args()

    payload = serialize_report(args.dataset_dir)
    html = build_html(payload)
    args.output.write_text(html, encoding="utf-8")
    print(f"Saved report to {args.output}")


if __name__ == "__main__":
    main()
