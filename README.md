# Technical Terminal

Built by **Bar Barzilay** — [LinkedIn](https://www.linkedin.com/in/bar-barzilay-ba932235b) · [GitHub](https://github.com/barbarzilay100-coder) · [barbarzilay100@gmail.com](mailto:barbarzilay100@gmail.com)

A daily-timeframe technical research terminal for any US stock or crypto pair, with the
fundamental read layered underneath it. Type a symbol, get the chart with a fixed indicator
set, deterministic support and resistance derived from where volume actually traded, a graded
assessment of the current bar against a defined checklist, and the company's GARP scorecard
beside it.

Companion to [equity-research-terminal](https://github.com/barbarzilay100-coder/equity-research-terminal),
which supplies the fundamental layer. That project answers *whether a business is worth owning*;
this one answers *what the chart is doing now* — and the two are shown together so neither is
read in isolation.

Single HTML file, no build step, no API key, no backend.

## What it shows

**The chart.** Daily candles with a fixed moving-average ribbon — EMA 9 (green), EMA 21
(yellow), SMA 50 (orange), SMA 100 (red) — volume, and RSI 14 with its own 14-period average in
a separate pane. Drawn with [Lightweight Charts](https://github.com/tradingview/lightweight-charts),
TradingView's open-source library, over price data the page computes indicators from itself.

**Support and resistance from volume, not eyeballing.** Each day's volume is spread uniformly
across that day's high-low range, building a volume-by-price histogram. Levels are local peaks
of that histogram: the two nearest above the price are resistance, the nearest below is support.
They are drawn on the chart in blue and listed with their distance from the price. When price
sits below every accumulation zone there is no support level, and the panel says so rather than
inventing one.

**Entry and exit triggers.** An EMA 9 / EMA 21 cross, marked on the ribbon at the crossing
point. Long triggers only count while SMA 50 sits above SMA 100 — the slow pair is a regime
gate, never an entry, because a golden cross fires long after the move has started. RSI and
volume are confirmation flags, never triggers, and a close through a volume level is tracked
separately because it is the one event that is not a moving-average derivative.

**A graded read of the current bar.** Eight conditions in four categories — trend context,
trigger freshness, momentum, geometry — scored X of Y applicable, with the full checklist
visible. There is deliberately no veto: a screen that rejects nearly every day carries no
information. Instead the score is placed against the asset's own history as a percentile over
both one and two years, so a middling-looking score can be recognised as unusually good for
that name (or the reverse). Both windows are shown; if they disagree, the regime changed.

**The fundamental layer.** The same eight-criterion GARP scorecard as the companion project,
with the same sector-applicability rules, plus implied value against price and analyst target.
For the 126 covered names it reads the committed pipeline output. For anything else it is
fetched live, and the panel labels which source it used and when that source was current.

**Quality × timing.** One line joining the two: a quality business at a poor technical entry
reads differently from a weak one that happens to look good on the chart, and neither layer
says that alone.

## Skills demonstrated

| Feature | Skill it proves |
|---|---|
| Volume-profile support/resistance computed in-browser from OHLCV | Quantitative method, not chart-reading by eye |
| Rolling historical scoring with an explicit no-look-ahead guarantee, unit-tested | Understanding of backtest bias — the error that invalidates most retail analysis |
| Regime gate / trigger / confirmation separated by design, with the redundant condition removed | Analytical thinking; knowing when two indicators say the same thing |
| Percentile context over two windows instead of a single hardcoded lookback | Parameter sensitivity shown rather than hidden |
| Two independent price sources reconciled and any gap flagged on screen | Reconciliation, accuracy, attention to detail |
| Staleness guard that rejects a real-but-four-year-old P/E | Data quality — the failure that silently corrupts a model |
| Sector applicability recovered from SEC SIC codes when the primary source lacks it | Working with primary regulatory sources |
| GARP scorecard shared with the companion project, same thresholds | Financial statement analysis |
| 99-assertion end-to-end suite over recorded API fixtures | Testing and verification discipline |

## How it works

Everything is computed in the browser. There is no pipeline and no stored state.

**Prices.** `api.stockanalysis.com` for stocks (five years of daily OHLCV, keyless, CORS-open)
and `data-api.binance.vision` for crypto pairs. The chart opens on roughly the last trading
year and keeps the rest for zooming out.

**Indicators.** Computed in `index.html`: SMA, EMA seeded from a simple average, Wilder RSI —
the same smoothing TradingView uses — and the volume-by-price histogram.

**Fundamentals.** For the covered universe, the committed `data.json` of the companion project,
refreshed there by GitHub Actions every weekday. That pipeline is versioned and validated, so
it stays the primary source. Anything outside it is fetched from `stockanalysis.com`'s
timeseries API, one request per metric, with the sector recovered from the company's SIC code
via `data.sec.gov`. That API is undocumented, so it is used only to extend reach: if it stops
working, free-text lookups lose their fundamental panel and nothing else breaks.

Method, thresholds and every known limitation are documented in
[docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Run it

Open `index.html` in a browser. That is all — it is a single file and it fetches its own data.

## Tests

```bash
npm install playwright
npx playwright install chromium
node tests/e2e.cjs
```

99 assertions against recorded API responses, so the suite needs no network and does not
change as markets move. It checks the indicator maths against hand-rolled values, the
volume-profile levels against a golden run, the applicability rules on a real bank, the
staleness guard on a real stale P/E, and every honest-empty state.

The assertion that matters most: a bar from sixty days ago is scored twice — once with the full
series present, once with the series truncated so that bar is the last one — and the two scores
must match. That is what proves no future information leaks into a historical score.

## Stack

Vanilla JS · Lightweight Charts · stockanalysis.com · Binance · SEC EDGAR · Playwright
