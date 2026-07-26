# Fixtures

Real API responses, recorded 26 July 2026, so the e2e suite needs no network and does not
change as markets move.

The suite also freezes `Date.now()` to that date (`RECORDED_AT` in `../harness.js`). The staleness
guard compares these fixed timestamps against the clock, so on a live clock the fixtures rot:
PLBC's P/E is dated 24/07/2026 and crosses the 30-day horizon a month after recording, at which
point assertions about its GARP score fail with the source unchanged. **If you re-record these
fixtures, move `RECORDED_AT` with them.**

| File | Source | Why this one |
|---|---|---|
| `lwc.js` | Lightweight Charts 5.2.0 standalone build (Apache-2.0) | Vendored so the test runs offline. Byte-identical to the CDN copy the shipped `index.html` pins with SRI |
| `data/orcl-history.json` | `api.stockanalysis.com/.../ORCL/history?range=5Y` | 1,255 daily bars; ORCL is in the covered universe |
| `data/culp-history.json`, `data/culp/*` | same host, plus `data.sec.gov` | A ticker **outside** the universe, so it exercises the live path. Its newest P/E is from 2022, which is the staleness guard's real-world test case. SIC 2211 (textile mill) is not a growth sector, so Rule of 40 must be skipped |
| `data/plbc-history.json`, `data/plbc/*` | same | A small **bank**, SIC 6153. Proves the sector applicability rules fire off SEC data: Rule of 40, FCF margin and balance sheet must all be skipped. Its EPS growth is also negative, which makes PEG an explicit failure rather than a missing value, so the score is out of 5 rather than 4 |
| `data/btc-klines.json` | `data-api.binance.vision/api/v3/klines` | The second price source, and the case where fundamentals must read as absent |
| `data/universe-trimmed.json` | `equity-research-terminal/data.json` | Trimmed to ORCL to keep the repo small; the `count` field is left at its real value because the UI quotes it |
