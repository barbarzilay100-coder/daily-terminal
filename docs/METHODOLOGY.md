# Methodology — definitions, thresholds and limitations

Everything here is computed deterministically in the browser from daily OHLCV. Nothing is
smoothed by judgement, no value comes from a language model, and every threshold below is a
number in `index.html` that can be changed and re-tested.

## Indicators

| Indicator | Definition |
|---|---|
| EMA 9, EMA 21 | Exponential moving average, `k = 2/(n+1)`, seeded with a simple average of the first *n* closes — the same seeding TradingView uses, so the two agree after the warm-up. |
| SMA 50, SMA 100 | Simple moving average of the close. |
| RSI 14 | Wilder's smoothing (`avg = (avg·(n−1) + new)/n`), not a simple average of gains and losses. The distinction matters: a simple-average RSI reads several points different on the same data. |
| RSI SMA 14 | 14-period simple average **of the RSI series**, not of price. |
| Volume MA 50 | Simple average of volume, used only as a confirmation flag. |

The ribbon colours are fixed by design — 9 green, 21 yellow, 50 orange, 100 red — so the ribbon
owns the warm-to-cool spectrum. Trigger markers are therefore white and sit on the EMA 21 line
rather than on the candles: with four coloured averages already on the chart, any coloured
marker on the price bars competes with an indicator for the same meaning.

## Support and resistance from volume

A level is not a line drawn through two touches. It is a price band where an unusual amount of
volume changed hands, which is what makes it likely to matter again.

1. Take the bars in the visible window and split their full high-to-low range into **120 bins**.
2. For each bar, spread its volume **uniformly across that bar's own high-low range** rather
   than assigning all of it to the close. A wide bar traded through every price in its range and
   should contribute to all of them.
3. A level is a **local peak** of the resulting histogram whose value is at least the mean bin
   volume. Peaks are taken strongest-first, and any peak within **1.5%** of one already accepted
   is dropped, so the output is distinct bands and not three adjacent bins.
4. The two nearest levels above the current price are resistance; the nearest below is support.

**Deliberately empty states.** If no accumulation band sits below the price — the asset has
fallen through all of them — there is no support level and the panel says exactly that. The same
applies above. A fabricated level is worse than an absent one.

**Window.** These levels are computed on the **visible range**, so panning and zooming updates
them. That is intentional: it mirrors what a person does by hand when they change the timeframe
they are looking at.

## Triggers, and why each indicator has exactly one job

Four moving averages and an RSI are all functions of the same close series, so treating each
crossing as an independent signal double-counts one piece of information. The design assigns one
role per component:

| Component | Role | Not used as |
|---|---|---|
| SMA 50 vs SMA 100 | **Regime gate** — long triggers only count while 50 is above 100 | An entry. A golden cross fires a handful of times per decade, always after the move has begun. |
| EMA 9 vs EMA 21 | **The timing trigger** | Context. It is too fast to define a regime. |
| Close through a volume level | **The one independent event** — it says price cleared a band where real supply changed hands, which no moving average knows | — |
| RSI vs its own average, volume vs its 50-day average | **Confirmation flags** on a trigger bar | Triggers. Using RSI crossings as separate entries duplicates the EMA cross, and both are momentum. |

**Deliberately excluded:** RSI exiting oversold. That is a mean-reversion setup and it
contradicts a trend-following ribbon by construction — the two would produce opposing signals on
the same screen. If it is wanted it belongs in a separate, separately-labelled mode.

**Exits** are symmetric: EMA 9 crossing back below EMA 21, or losing a support level. Exits are
not gated — you leave a position regardless of what the slow pair is doing.

## Grading the current bar

Eight conditions, in four categories:

| Category | Conditions |
|---|---|
| Trend context | SMA 50 above SMA 100 · price above SMA 50 |
| Trigger freshness | an EMA 9 / 21 up-cross within the last **5 trading days** |
| Momentum | RSI above its own average · RSI below 70 · volume above its 50-day average |
| Geometry | more than **3%** of room to the nearest resistance · reward-to-risk of at least **2:1** |

### Three choices worth defending

**No veto.** An earlier draft made the gate and the fresh trigger hard prerequisites. That was
wrong: with eight conditions and two vetoes, almost every day returns "no entry", and a screen
that rejects everything carries no information. This is the same reasoning the companion
project uses to relax PEG from the canonical 1 to 2. A failed condition now simply fails.

**"EMA 9 above EMA 21" was removed.** It is fully redundant with the fresh-up-cross condition —
a recent up-cross *means* 9 is above 21 — and would have scored the same fact twice. Eight
conditions, not nine.

**Five days for freshness.** Three misses an entry that developed around a weekend; ten no
longer describes *now*. The 9/21 pair exists to be fast, and a fortnight-old cross is a move
already running without you.

### Not-applicable is not failure

A condition with no data — or reward-to-risk when there is no support level to measure risk
against — is marked `n/a` and **excluded from the denominator**, exactly as in the companion
project's scorecard. The consequence, stated plainly: scores of different assets can have
different denominators, so `4/7` and `5/8` were measured against different exams. The panel
always shows the denominator for this reason.

## Placing the score in context

A raw score answers "do my conditions hold". It does not answer "is that unusual". So the score
is also expressed as a percentile of the same score computed on every prior bar, over **one
year** and **two years**, both shown.

**Why two windows.** A single lookback is a hidden parameter. Six months of a name in freefall
contains only low scores, so a mediocre day reads as the 95th percentile — a degenerate
reference set, and it degrades exactly at the trend turns where the number matters. Two years
has the opposite problem: it compares today to a regime that no longer exists. Showing both
means that when they disagree, the disagreement is itself the finding.

**No look-ahead.** Each historical bar's score is computed against volume levels derived from a
**252-bar window ending at that bar**. Scoring a bar from last year against today's levels would
feed future information into the past and inflate the percentile. This is enforced by a test:
one bar is scored twice, once with the full series and once with the series truncated so that
bar is the last one, and the two results must be identical.

**The score does not move when you zoom.** It always uses a fixed 252-bar profile window, so it
is stable. The blue lines on the chart *do* follow the view. At the default one-year view the two
bases coincide.

### Limitations of the percentile

- It is computed on the asset's own history. It says "unusual **for this name**", never "good in
  absolute terms".
- Trend states persist for weeks, so daily observations are **not independent**. Five hundred
  bars are perhaps thirty to forty independent episodes, and confidence in the percentile is
  correspondingly lower than the day count suggests.
- It describes conditions, not outcomes. Nothing here measures whether a setup made money.

## The fundamental layer

The eight GARP criteria, their thresholds and the sector-applicability rules are taken verbatim
from the companion project — see its `docs/METHODOLOGY.md` for the source behind each threshold.
Two things are specific to this project:

**Two sources, ranked.** Covered names come from the companion project's committed `data.json`;
that pipeline is versioned, CI-validated and therefore primary. Everything else is fetched live
from `stockanalysis.com`'s timeseries API. That API is undocumented and unsanctioned, so it is
confined to extending reach: if it changes, free-text lookups lose their fundamental panel and
nothing else is affected. The panel always states which source it used.

**Staleness is treated as absence.** A stale value is more dangerous than a missing one, because
it looks like data. Culp Inc's newest P/E in the live source is from 2022 — real, and four years
out of date, because the company has been loss-making since. Multiples and analyst targets older
than **30 days** and statement figures older than **200 days** are discarded rather than
displayed.

**Sector, when the live source has none.** The applicability rules need to know whether a
company is a financial or a growth-sector name. The live source does not carry a sector, so it
is derived from the SIC code in the company's SEC submissions: 6000–6799 → Financial Services,
7370–7379 / 3570–3579 / selected 36xx → Technology, 4800–4899 → Communication Services. SIC is
coarser than GICS and the panel labels it as SIC-derived.

**PEG is a different number on each path.** The pipeline uses Yahoo's `trailingPegRatio`, whose
denominator is a five-year *expected* growth estimate. The live path has no PEG field, so it is
computed as trailing P/E ÷ realised EPS growth. These are not the same metric and the panel marks
the computed one. Do not compare them across the two paths.

## Reconciliation

Prices arrive from two independent places: the chart's price source and, for covered names, the
fundamental snapshot. They are compared on screen and a gap above **1%** is flagged. Agreement
is also stated explicitly, because silence is not evidence of a check.

## What this is not

It is a research and study tool. It states whether a defined set of conditions holds on the
current bar and how unusual that is historically. It does not forecast returns, does not measure
whether any setup has ever been profitable, and is not a recommendation to buy or sell anything.
