## Active ETF Holdings by Stock

- Public URL: `https://roomboom123.github.io/Web_anything/activeetf/`
- Scope: every domestic-equity active ETF in Naver's ETF list (`etfTabCode` 1, 2 with `액티브` in the name)
- Holdings: WiseReport "CU당 구성종목" (about a one-day lag, latest date only — history accumulates from the first collection)
- Auto update: twice daily via GitHub Actions
- Page: pick one or more stocks (`?s=삼성전자,SK하이닉스`) to see which ETFs hold them and the estimated daily buying/selling per ETF; `r` sets the trading-day range, `b` the brand

Data is written by `tools/activeetf/update_data.py`:

- `data/pdf/<date>.json` — per-ETF holdings snapshot (name, shares per CU, weight %) with ETF market cap (억원)
- `data/index.json` — available dates

Stock-level positions and estimated flows are computed in the page from the snapshots in the selected range.
