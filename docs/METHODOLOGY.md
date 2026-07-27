# Methodology: definitions, thresholds and limitations

Everything here is computed deterministically in the browser from daily OHLCV. Nothing is
smoothed by judgement, no value comes from a language model, and every threshold below is a
number in `index.html` that can be changed and re-tested.

## Indicators

| Indicator | Definition |
|---|---|
| EMA 9, EMA 21 | Exponential moving average, `k = 2/(n+1)`, seeded with a simple average of the first *n* closes. That is the seeding TradingView uses, so the two agree after the warm-up. |
| SMA 50, SMA 100 | Simple moving average of the close. |
| RSI 14 | Wilder's smoothing (`avg = (avg·(n−1) + new)/n`), not a simple average of gains and losses. The distinction matters: a simple-average RSI reads several points different on the same data. |
| RSI SMA 14 | 14-period simple average **of the RSI series**, not of price. It therefore starts 14 bars after the RSI does, at bar 27 rather than bar 14. The moving average counts real inputs instead of trusting the bar index, because the series it is fed begins with nulls. The index-based version emitted partial sums for the first thirteen bars, a ramp from about 3 up to the true value, drawn as if it were an average. |
| Volume MA 50 | Simple average of volume, used only as a confirmation flag. |

The ribbon colours are fixed by design (9 green, 21 yellow, 50 orange, 100 red) so the ribbon
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
3. Weight that contribution by the bar's age, halving every **126 bars** — about half a trading
   year. Recent volume therefore outweighs old volume at the same price: across a 252-bar window
   the oldest bar carries roughly a quarter of the newest bar's weight. Holders turn over, and the
   price being defended now is the one that moves price now.
4. A level is a **local peak** of the resulting histogram whose value is at least the mean bin
   volume. Peaks are taken strongest-first, and any peak too close to one already accepted is
   dropped, so the output is distinct bands and not three adjacent bins. "Too close" is not a
   fixed percentage: it is the asset's own **median daily range × 1.5**, clamped to **1–5%**. A
   flat threshold asked a utility and a crypto pair to call the same distance "a separate level",
   which is two different claims about the market; scaling it means one thing everywhere, that
   levels nearer than about a day and a half of normal movement are the same level. The median is
   used rather than the mean because a single gap day should not redefine the asset's normal
   range. The first and last bin are candidates like any other, compared against whichever
   neighbour they have; excluding them silently dropped an accumulation band that happened to sit
   at the extreme of the range.
5. The two nearest levels above the reference price are resistance; the nearest below is support.

The weighted histogram is drawn beside the price axis rather than discarded once the peaks
have been read off it, so a level can be checked against the shape it came from. Each bin is
split into the volume that arrived on bars closing above the previous close and the volume that
arrived on bars closing below it — the same up/down rule the volume pane uses. Both halves carry
the same age weight, or the drawn boundary would stop describing the volume the levels came from.
That split feeds only the drawing. The peak-finding in step 4 runs on the combined histogram, so
which prices become levels does not depend on it.

**Levels fade when they stop being traded.** A band nothing has touched for a year decays out of
the profile on its own, instead of standing until something removes it. That is the intended
behaviour, and it has a consequence worth stating on wide views: past roughly eighteen months the
weights are small enough that zooming out further barely moves the levels, so a five-year window
is in practice a recent-history profile with a long tail. A level that was decisive in 2022 and
has not been revisited since will not be drawn today.

**A peak is past agreement, not a wall.** A high-volume node marks a price where a lot of
business was done. Price often stalls there, which is why these levels are drawn and read as
barriers — but the same peak can equally attract price toward it, and the thin stretches between
peaks are where price tends to travel fastest. Reading the levels as barriers is one defensible
interpretation, not the only one, and the app's method note says the same.

**Deliberately empty states.** If no accumulation band sits below the price, meaning the asset
has fallen through all of them, there is no support level and the panel says exactly that. The same
applies above. A fabricated level is worse than an absent one.

**No volume, no profile.** If every bar in the window reports zero or missing volume, the mean
bin volume is zero, every bin trivially clears the "at least the mean" test, and the histogram
will happily emit a full set of levels built out of nothing. Some feeds do return zero volume, so
this is a reachable state and not a hypothetical: it is checked first, and the panel says there is
no volume to build a profile from rather than showing bands that no trading created.

**Window, and what the levels are measured against.** These levels are computed on the **visible
range**, so panning and zooming updates them. That is intentional: it mirrors what a person does
by hand when they change the timeframe they are looking at. The reference price is the close of
the **last bar in view**, not the last bar in the series. Pan back to 2022 and "resistance" has
to mean above the price as it was then, or a 2022 histogram gets sorted against a price that is
not in the window at all. Whenever the view does not reach the latest bar, the panel names the bar
the levels are measured against.

**The forming session is shown, never counted.** While the exchange is open, a keyless quote
endpoint supplies the current session — open, high, low, last and volume — and it is drawn as a
translucent candle with a live price in the header, refreshed once a minute. It never enters the
bar series the analysis reads: the score, the levels, the reference close and the percentile all
keep reading closed bars only, and the levels line says so while the forming bar is on screen. A
bar that can still change must not be graded against bars that cannot, and an intraday print is
exactly such a bar. When the quote fails or the market is closed, the page simply shows the last
close, which is what it always did. Two guards keep the display honest: a quote whose own
previous close does not match the last bar held is refused outright, because the history is
then behind by more than the forming session and the change would be measured against the wrong
close; and a transient network failure keeps the last print and retries, instead of flashing
back to a close the market has moved away from.

**Known exception: crypto counts its forming day.** Binance serves daily klines with the
current UTC day included, and this terminal feeds them to the analysis as delivered — so for
crypto pairs the forming bar *is* inside the score and the levels, unlike stocks. The bar
closes at 00:00 UTC, so the discrepancy is largest early in the UTC day and zero at the close.
Splitting it out the way the stock path does is planned; until then this asymmetry is stated
here rather than hidden.

## Triggers, and why each indicator has exactly one job

Four moving averages and an RSI are all functions of the same close series, so treating each
crossing as an independent signal double-counts one piece of information. The design assigns one
role per component:

| Component | Role | Not used as |
|---|---|---|
| SMA 50 vs SMA 100 | **Regime gate.** Long triggers only count while 50 is above 100 | An entry. A golden cross fires a handful of times per decade, always after the move has begun. |
| EMA 9 vs EMA 21 | **The timing trigger** | Context. It is too fast to define a regime. |
| Close through a volume level | **The one independent event.** It says price cleared a band where real supply changed hands, which no moving average knows | |
| RSI vs its own average, volume vs its 50-day average on an up bar | **Confirmation flags** on a trigger bar | Triggers. Using RSI crossings as separate entries duplicates the EMA cross, and both are momentum. |

**A trigger is not a scored condition.** The table above governs what may *fire an entry*. The
checklist below scores the *state* of the current bar, and RSI appears there: "RSI above its own
average" is one of the eight. That is not a contradiction of the rule and it is worth being
explicit about why: a trigger is a discrete event that says *act now*, and letting two correlated
indicators each fire one double-counts a single piece of information. A scored condition asks a
different question, *is momentum currently positive*, and answers it with a continuous state
rather than an event. The 9/21 cross and the RSI reading are correlated in the score, as any two
functions of the same closes must be, and the category profile exists so that the correlation is
visible: both live under "momentum", and a bar that scores well there scored well on one thing.

**Deliberately excluded:** RSI exiting oversold. That is a mean-reversion setup and it
contradicts a trend-following ribbon by construction, since the two would produce opposing
signals on the same screen. If it is wanted it belongs in a separate, separately-labelled mode.

**Exits** are symmetric: EMA 9 crossing back below EMA 21, or losing a support level. The exit
rule itself is not gated — you leave a position regardless of what the slow pair is doing. The
chart, though, only *draws* a down arrow when a marked entry is still open for it to close. Every
down-cross used to be drawn, including the ones closing positions the gate never let you open,
which put sell markers on the chart for trades this system was never in.

## Grading the current bar

Eight conditions, in four categories:

| Category | Conditions |
|---|---|
| Trend context | SMA 50 above SMA 100 · price above SMA 50 |
| Trigger freshness | an EMA 9 / 21 up-cross within the last **5 trading days**, with price no more than **4%** above the close of the cross bar |
| Momentum | RSI above its own average · RSI between **40 and 70** · volume above its 50-day average **on an up bar** |
| Geometry | more than **3%** of room to the nearest resistance · reward-to-risk of at least **2:1** |

**Why the RSI condition is a band and not a ceiling.** "RSI below 70" is satisfied by RSI 25, so a
name in freefall collected the point for not being overbought. That is a filter masquerading as a
merit. The band asks momentum to be positive *and* not stretched, which is what the condition was
always meant to say; the ceiling on its own said only half of it.

The floor sits at **40** rather than 50 because the checklist was otherwise arguing with itself.
The 9/21 cross fires just after a pullback, while RSI is still recovering, so a floor at 50 failed
the momentum condition at exactly the moment the trigger condition passed. Forty still rejects
broken momentum without punishing the state the trigger exists to catch.

**Why the volume flag reads direction too.** Volume above its 50-day average on a heavy *down* day
is the market leaving, which is evidence against a long rather than for it. Asking only "is volume
high" handed the point to precisely the bars the condition should penalise, so it asks for
participation and direction together, using the same up/down rule as the volume pane: a bar is
down only if it closed below the one before it.

**Why "no resistance overhead" passes rather than reading n/a.** When the profile finds no
accumulation band above the price, the room to the nearest resistance is not unmeasurable. It is
unbounded, the maximum of the quantity being measured. Marking it `n/a` deleted the strongest
state the asset can be in from its own exam, and quietly shrank the denominator at the same time.
Room is therefore infinite and passes, and the checklist prints the reason next to the tick.

Reward-to-risk is **not** given the point as well. With nothing overhead it is the same
observation divided by the same missing number, so passing both conditions would pay twice for one
fact inside a single total. It is marked `n/a` and leaves the denominator instead, with the reason
printed on its row.

**The two geometry conditions are deliberately not symmetric, and that is worth stating rather
than hiding.** With no accumulation band *below* the price either, reward-to-risk stays `n/a`.
One could argue it should fail by the same logic, since no identifiable stop means unbounded risk.
The reason it does not is that the two conditions answer different questions. Room asks how far
this can run before it meets supply, and "nothing above it" is a real, favourable answer.
Reward-to-risk asks what you risk to find out, and "no level to measure against" is a missing
input, not a bad value of one. Either side of that measurement missing therefore takes it out of
the exam. The consequence is that a name trading below every accumulation zone, or one running
under a clear sky, is scored out of 7 rather than 8, which the panel shows. If you would rather it
failed, the change is one line in `evalConditions`.

### Three choices worth defending

**No veto.** An earlier draft made the gate and the fresh trigger hard prerequisites. That was
wrong: with eight conditions and two vetoes, almost every day returns "no entry", and a screen
that rejects everything carries no information. This is the same reasoning the companion
project uses to relax PEG from the canonical 1 to 2. A failed condition now simply fails.

**"EMA 9 above EMA 21" was removed.** It is fully redundant with the fresh-up-cross condition,
since a recent up-cross *means* 9 is above 21, and it would have scored the same fact twice.
Eight conditions, not nine.

**Five days for freshness, and a 4% cap on the chase.** Three misses an entry that developed
around a weekend; ten no longer describes *now*. The 9/21 pair exists to be fast, and a
fortnight-old cross is a move already running without you. Recency on its own was not enough,
though: a cross four days back that price has already run 8% past is not a fresh entry, it is a
chase, and what the signal offered is gone while the risk is not. So the condition also asks that
the current close sit no more than **4%** above the close of the cross bar. The cap is one-sided
by design — price back *below* the cross is a worse setup rather than a chase, and the trend and
momentum conditions are what judge that.

### Not-applicable is not failure

A condition with **no data**, or reward-to-risk when either side of the measurement is missing,
is marked `n/a` and **excluded from the denominator**, exactly as in the companion
project's scorecard. The consequence, stated plainly: scores of different assets can have
different denominators, so `4/7` and `5/8` were measured against different exams. The panel
always shows the denominator for this reason.

The emphasis on *no data* is the whole rule, because an `n/a` shrinks the denominator and so
raises the ratio. A value that exists but is bad in a way its threshold cannot express is a
failure, not an absence. That is why a negative PEG, two negative multiples and negative
shareholder equity all resolve to ✗ with the reason printed, and why "no resistance overhead"
resolves to ✓ on the room condition rather than dropping out. See
[the room / reward-to-risk note](#grading-the-current-bar) above for why the *other* geometry
condition does drop out on the same fact, and why that is deliberate rather than inconsistent.

## Placing the score in context

A raw score answers "do my conditions hold". It does not answer "is that unusual". So the score
is also expressed as a percentile of the same score computed on **every prior bar**, strictly
before today, over **one year** and **two years**, both shown. Today is not in its own comparison
set. The median of that reference set is reported as a share of conditions rather than as
"x out of y": the historical bars carried their own denominators, so pairing a historical ratio
with today's denominator prints a score that was never measured.

**Why two windows.** A single lookback is a hidden parameter. Six months of a name in freefall
contains only low scores, so a mediocre day reads as the 95th percentile. That is a degenerate
reference set, and it degrades exactly at the trend turns where the number matters. Two years
has the opposite problem: it compares today to a regime that no longer exists. Showing both
means that when they disagree, the disagreement is itself the finding.

**No look-ahead.** Each historical bar's score is computed against volume levels derived from a
**252-bar window ending at that bar**. Scoring a bar from last year against today's levels would
feed future information into the past and inflate the percentile. This is enforced by a test:
**twenty-five bars spread across the series** are each scored twice. Once with the full series
loaded, once with the series truncated so that bar is the last one that exists. Every pair has to
match. A single sample can agree by coincidence; the point of the check is that it cannot
agree twenty-five times by coincidence.

**The score does not move when you zoom.** It always uses a fixed 252-bar profile window, so it
is stable. The blue lines on the chart *do* follow the view, and the two bases are not the same:
the opening view is 140 bars, chosen for legibility because 252 candles across one screen are
about two pixels wide each. So the levels drawn on a freshly loaded chart are built on a shorter
window than the one the score used, and zooming out to roughly a year is what makes them agree.

### Limitations of the percentile

- It is computed on the asset's own history. It says "unusual **for this name**", never "good in
  absolute terms".
- Trend states persist for weeks, so daily observations are **not independent**. Five hundred
  bars are perhaps thirty to forty independent episodes, and confidence in the percentile is
  correspondingly lower than the day count suggests.
- It describes conditions, not outcomes. Nothing here measures whether a setup made money.

## The fundamental layer

The eight GARP criteria, their thresholds and the sector-applicability rules are taken verbatim
from the companion project. Its `docs/METHODOLOGY.md` has the source behind each threshold.
Two things are specific to this project:

**Two sources, ranked.** Covered names come from the companion project's committed `data.json`;
that pipeline is versioned, CI-validated and therefore primary *while it is current*. Everything
else is fetched live from `stockanalysis.com`'s timeseries API. That API is undocumented and
unsanctioned, so it is confined to extending reach: if it changes, free-text lookups lose their
fundamental panel and nothing else is affected. The panel always states which source it used, when
that source was built, and how long ago that was.

**Staleness is treated as absence, on both paths.** A stale value is more dangerous than a
missing one, because it looks like data. Culp Inc's newest P/E in the live source is from 2022.
It is a real number, and four years out of date, because the company has been loss-making since. Multiples and
analyst targets older than **30 days** and statement figures older than **200 days** are discarded
rather than displayed.

The same two horizons now apply to the pipeline snapshot, measured against its own build date. The
guard used to live only on the live path while the panel's note claimed it for both, so a frozen
pipeline, whether from a broken Action or a tab left open over a long weekend, kept serving
multiples and price targets as though they were current. Past 30 days the snapshot's multiples, analyst target, implied
value and reference price are dropped and the panel says so; past 200 days the snapshot is refused
outright and the live path takes over. A build date that cannot be parsed counts as unusable, not
as fresh.

**A bad number is not a missing number.** A criterion with no data leaves the denominator, so
mapping a value that is bad *beyond what its threshold can express* to "no data" did not merely
hide the problem. It raised the score. Three sign traps were live and are now explicit failures
with the reason printed:

| Trap | What used to happen | Now |
|---|---|---|
| Negative PEG, from losses or shrinking EPS | a negative number satisfies `PEG < 2`, so a loss-making company **passed** valuation | fails, threshold restated as `0 < PEG < 2` |
| Two negative multiples | `Fwd < Trail` ranked them against each other and produced a verdict | fails; the comparison is meaningless without positive earnings |
| Negative shareholder equity | D/E was set to null, so the worst readable balance sheet **left the exam** | fails; threshold restated as `0 ≤ D/E < 1.5`, and both spellings of the fact are caught: `Infinity` from the live path's own division, and a negative ratio straight from the pipeline |

**A stale snapshot cannot be cached into freshness.** The projected fundamental object used to be
memoised per symbol, which froze its age at whatever it was the first time you looked. The
pipeline path is a lookup in memory and is now simply recomputed on every render; only the live
path, which costs eleven requests, is cached, and that cache expires after an hour.

**Sector, when the live source has none.** The applicability rules need to know whether a
company is a financial or a growth-sector name. The live source does not carry a sector, so it
is derived from the SIC code in the company's SEC submissions: 6000–6799 → Financial Services,
7370–7379 / 3570–3579 / selected 36xx → Technology, 4800–4899 → Communication Services. SIC is
coarser than GICS and the panel labels it as SIC-derived.

Two caveats on that call. SEC's fair-access policy asks requests to declare a User-Agent with
contact details, and a browser will not let a page set that header, so this one request goes out
with the browser's own. It is a best-effort enrichment of a single field and every failure path
returns nothing, but it is the one call here that is not fully within its source's terms. And when
it does return nothing, the sector is unknown: `Rule of 40` correctly does not apply, but the
balance-sheet and FCF-margin rules cannot know they are looking at a bank. The panel states that
the applicability rules could not be applied and that the score is therefore not comparable with
other companies', rather than presenting a number that quietly assumed "not a financial".

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
