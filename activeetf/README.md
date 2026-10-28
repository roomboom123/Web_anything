## Active ETF Changes

- Public URL: `https://roomboom123.github.io/Web_anything/activeetf/`
- Scope: every domestic-equity active ETF in Naver's ETF list (`etfTabCode` 1, 2 with `액티브` in the name)
- Holdings: WiseReport "CU당 구성종목" (about a one-day lag, latest date only — history accumulates from the first collection)
- Auto update: twice daily via GitHub Actions

Data is written by `tools/activeetf/update_data.py`:

- `data/pdf/<date>.json` — per-ETF holdings snapshot (name, shares per CU, weight %) with ETF market cap (억원)
- `data/changes/<date>.json` — holdings whose share count changed versus each ETF's previous snapshot
- `data/index.json` — available dates
