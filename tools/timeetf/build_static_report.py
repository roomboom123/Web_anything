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
      --bg: #f4f5ef;
      --panel: #fbfbf7;
      --panel-strong: #ffffff;
      --ink: #163038;
      --muted: #66757c;
      --line: rgba(22, 48, 56, 0.12);
      --accent: #0f766e;
      --accent-soft: rgba(15, 118, 110, 0.10);
      --accent-2: #d97706;
      --shadow: 0 24px 60px rgba(22, 48, 56, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 34%),
        radial-gradient(circle at top right, rgba(217, 119, 6, 0.10), transparent 28%),
        var(--bg);
    }
    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 24px;
    }
    .hero {
      background: linear-gradient(135deg, rgba(15,118,110,0.96), rgba(22,48,56,0.96));
      color: white;
      border-radius: 28px;
      padding: 28px 30px;
      box-shadow: var(--shadow);
      margin-bottom: 18px;
    }
    .hero h1 {
      margin: 0;
      font-size: 34px;
      letter-spacing: -0.02em;
    }
    .hero p {
      margin: 10px 0 0 0;
      color: rgba(255,255,255,0.84);
      font-size: 15px;
    }
    .layout {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .section {
      padding: 20px;
    }
    .section h2 {
      margin: 0 0 14px 0;
      font-size: 18px;
      letter-spacing: -0.02em;
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
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: var(--panel-strong);
      color: var(--ink);
      font-size: 14px;
      outline: none;
      margin-bottom: 14px;
    }
    .stock-search:focus {
      border-color: rgba(15, 118, 110, 0.35);
      box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.08);
    }
    .stock-button-list {
      max-height: calc(100vh - 220px);
      overflow: auto;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-content: flex-start;
    }
    .stock-button {
      border: 1px solid var(--line);
      background: var(--panel-strong);
      color: var(--ink);
      padding: 10px 12px;
      border-radius: 999px;
      font-size: 13px;
      cursor: pointer;
      transition: 0.18s ease;
      white-space: nowrap;
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
    .detail-top {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
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
      min-width: 120px;
      background: var(--panel-strong);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 12px 14px;
    }
    .mini-stat .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .mini-stat .value {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.1;
    }
    .chart-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    .chart-box {
      width: 100%;
      height: 340px;
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(255,255,255,0.86), rgba(244,246,239,0.72));
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
      border-radius: 18px;
      background: var(--panel-strong);
      margin-top: 16px;
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
      margin-top: 18px;
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
      .layout {
        grid-template-columns: 1fr;
      }
      .stock-nav {
        position: static;
      }
    }
    @media (max-width: 900px) {
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
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <h1>__ETF_NAME__</h1>
      <p>종목별 비중과 순위 흐름 중심으로 정리한 전달용 리포트입니다. 브라우저에서 파일 하나로 바로 열 수 있습니다.</p>
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
              <div class="label">최고 비중</div>
              <div id="stat-best-weight" class="value">-</div>
            </div>
            <div class="mini-stat">
              <div class="label">최고 순위</div>
              <div id="stat-best-rank" class="value">-</div>
            </div>
            <div class="mini-stat">
              <div class="label">등장 기간</div>
              <div id="stat-span" class="value">-</div>
            </div>
          </div>
        </div>

        <div class="chart-grid">
          <div>
            <h3>비중 추이</h3>
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
      <h3>날짜별 구성 종목 수</h3>
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
    let activeStockCode = reportData.default_stock_code || "";

    function formatNumber(value) {
      return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
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

    function renderSvgLineChart(targetId, rows, yKey, color, labelFormatter, reverseY=false) {
      const root = document.getElementById(targetId);
      if (!rows || rows.length === 0) {
        root.innerHTML = '<div class="empty">표시할 데이터가 없습니다.</div>';
        return;
      }
      const width = root.clientWidth || 700;
      const height = root.clientHeight || 340;
      const margin = { top: 22, right: 18, bottom: 40, left: 52 };
      const minY = Math.min(...rows.map(r => Number(r[yKey] || 0)));
      const maxY = Math.max(...rows.map(r => Number(r[yKey] || 0)));
      const spanY = maxY - minY || 1;
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
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
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="rgba(22,48,56,0.10)" />
          <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="#647076" font-size="11">${labelFormatter ? labelFormatter(value) : Math.round(value)}</text>
        `;
      }).join("");
      const xLabels = points
        .filter((_, idx) => idx === 0 || idx === points.length - 1 || idx % Math.ceil(points.length / 6) === 0)
        .map(p => `<text x="${p.x}" y="${height - 12}" text-anchor="middle" fill="#647076" font-size="11">${p.row.response_date}</text>`)
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

    function renderWeightPriceOverlayChart(targetId, rows, priceSeries) {
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
        renderSvgLineChart(targetId, rows, "weight_pct", "#0f766e", value => `${Number(value).toFixed(2)}%`);
        return;
      }

      const width = root.clientWidth || 700;
      const height = root.clientHeight || 340;
      const margin = { top: 22, right: 54, bottom: 40, left: 52 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;

      const weightMin = Math.min(...merged.map(r => Number(r.weight_pct || 0)));
      const weightMax = Math.max(...merged.map(r => Number(r.weight_pct || 0)));
      const weightSpan = weightMax - weightMin || 1;

      const priceMin = Math.min(...merged.map(r => Number(r.close || 0)));
      const priceMax = Math.max(...merged.map(r => Number(r.close || 0)));
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
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="rgba(22,48,56,0.10)" />
          <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="#647076" font-size="11">${Number(value).toFixed(2)}%</text>
        `;
      }).join("");

      const rightAxis = rightTicks.map(value => {
        const y = margin.top + innerH - ((value - priceMin) / priceSpan) * innerH;
        return `<text x="${width - margin.right + 10}" y="${y + 4}" text-anchor="start" fill="#647076" font-size="11">${formatNumber(Math.round(value))}</text>`;
      }).join("");

      const xLabels = points
        .filter((_, idx) => idx === 0 || idx === points.length - 1 || idx % Math.ceil(points.length / 6) === 0)
        .map(p => `<text x="${p.x}" y="${height - 12}" text-anchor="middle" fill="#647076" font-size="11">${p.row.response_date}</text>`)
        .join("");

      const weightDots = points.map(p => `
        <circle cx="${p.x}" cy="${p.weightY}" r="4.5" fill="#0f766e" />
        <title>${p.row.response_date} | 비중 ${Number(p.row.weight_pct).toFixed(2)}%</title>
      `).join("");

      const priceDots = points.map(p => `
        <circle cx="${p.x}" cy="${p.priceY}" r="4.5" fill="#d97706" />
        <title>${p.row.response_date} | 종가 ${formatNumber(p.row.close)}원</title>
      `).join("");

      root.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          ${leftAxis}
          ${rightAxis}
          <polyline points="${weightLine}" fill="none" stroke="#0f766e" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
          <polyline points="${priceLine}" fill="none" stroke="#d97706" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
          ${weightDots}
          ${priceDots}
          ${xLabels}
          <text x="${margin.left}" y="16" fill="#0f766e" font-size="12" font-weight="700">비중(%)</text>
          <text x="${width - margin.right}" y="16" text-anchor="end" fill="#d97706" font-size="12" font-weight="700">종가(원)</text>
        </svg>
      `;
    }

    function getStockOptions() {
      return Array.from(new Map(
        holdings.map(row => [`${row.code}||${row.name}`, { code: row.code, name: row.name }])
      ).values()).sort((a, b) => {
        if (a.name === "리브스메드" && b.name !== "리브스메드") return -1;
        if (a.name !== "리브스메드" && b.name === "리브스메드") return 1;
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
          class="stock-button ${item.code === activeStockCode ? "active" : ""}"
          data-code="${item.code}"
          type="button"
        >${item.name}</button>
      `).join("");
      root.querySelectorAll(".stock-button").forEach(button => {
        button.addEventListener("click", () => {
          activeStockCode = button.dataset.code;
          buildStockButtons(document.getElementById("stock-search").value);
          renderStockDetail(activeStockCode);
        });
      });
    }

    function renderStockDetail(code) {
      const rows = holdings
        .filter(row => row.code === code)
        .sort((a, b) => a.response_date.localeCompare(b.response_date));
      if (rows.length === 0) {
        return;
      }
      const rankedRows = rows.map(row => {
        const sameDate = holdings
          .filter(item => item.response_date === row.response_date)
          .sort((a, b) => Number(b.weight_pct) - Number(a.weight_pct));
        const rank = sameDate.findIndex(item => item.code === row.code) + 1;
        return { ...row, rank };
      });
      const selected = rankedRows[0];
      const bestWeight = rankedRows.reduce((best, row) => Number(row.weight_pct) > Number(best.weight_pct) ? row : best, rankedRows[0]);
      const bestRank = rankedRows.reduce((best, row) => Number(row.rank) < Number(best.rank) ? row : best, rankedRows[0]);

      document.getElementById("detail-title").textContent = selected.name;
      document.getElementById("detail-sub").textContent = `${selected.code} | ${rankedRows[0].response_date} ~ ${rankedRows[rankedRows.length - 1].response_date}`;
      document.getElementById("stat-best-weight").textContent = `${Number(bestWeight.weight_pct).toFixed(2)}%`;
      document.getElementById("stat-best-rank").textContent = `${bestRank.rank}위`;
      document.getElementById("stat-span").textContent = `${rankedRows.length}일`;

      if (code === priceOverlay.code) {
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
        { key: "rank", label: "순위", render: value => `${value}위` }
      ], rankedRows);
    }

    function initSearch() {
      const input = document.getElementById("stock-search");
      input.addEventListener("input", () => {
        buildStockButtons(input.value);
      });
    }

    function initDefaultStock() {
      if (!activeStockCode) {
        const options = getStockOptions();
        activeStockCode = options.length > 0 ? options[0].code : "";
      }
      buildStockButtons();
      if (activeStockCode) {
        renderStockDetail(activeStockCode);
      }
    }

    function renderCountTrend() {
      renderSvgLineChart(
        "count-chart",
        validSummary,
        "constituent_count",
        "#0f766e",
        value => formatNumber(Math.round(value))
      );
    }

    initSearch();
    initDefaultStock();
    renderCountTrend();

    window.addEventListener("resize", () => {
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
