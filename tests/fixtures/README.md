# Fixtures

Real API responses, recorded 26 July 2026, so the e2e suite needs no network and does not
change as markets move.

| File | Source | Why this one |
|---|---|---|
| `lwc.js` | Lightweight Charts 5.2.0 standalone build (Apache-2.0) | Vendored so the test runs offline |
| `data/orcl-history.json` | `api.stockanalysis.com/.../ORCL/history?range=5Y` | 1,255 daily bars; ORCL is in the covered universe |
| `data/culp-history.json`, `data/culp/*` | same host, plus `data.sec.gov` | A ticker **outside** the universe, so it exercises the live path. Its newest P/E is from 2022 — the staleness guard's real-world test case. SIC 2211 (textile mill) is not a growth sector, so Rule of 40 must be skipped |
| `data/plbc-history.json`, `data/plbc/*` | same | A small **bank**, SIC 6153. Proves the sector applicability rules fire off SEC data: Rule of 40, FCF margin and balance sheet must all be skipped and the score must be out of 4 |
| `data/btc-klines.json` | `data-api.binance.vision/api/v3/klines` | The crypto path, and the case where fundamentals must read as absent |
| `data/universe-trimmed.json` | `equity-research-terminal/data.json` | Trimmed to ORCL to keep the repo small; the `count` field is left at its real value because the UI quotes it |
