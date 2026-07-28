# LESSONS.md — Lessons From Past Sessions

> Read at session start. Add at session end only if the session produced a real lesson —
> a correction (something assumed that turned out wrong) or a confirmed approach worth repeating.
> One lesson per entry, one-line summary first. Update existing entries rather than duplicating.
> Delete entries proven wrong. Don't record what the repo, PLAN.md, or chat history already records.

## Lessons

### Closed means deleted, not memorialised
2026-07-27. Bar's correction at the project close: do not add paragraphs for their own sake,
and when an idea is closed, delete its mentions rather than leaving a record of the record.
A "Closed without action" section restating what LESSONS already holds was exactly that, and
so was repeatedly re-offering a declined README idea in session summaries. The queue says
"empty"; the reasoning lives in one place only.

### A weighting change can delete a level outright, and a "do not touch" baseline can be legitimately invalidated by it
2026-07-27. Adding time decay to the volume profile (half-life 126 bars) removed ORCL's 2022
support at 104.71 from every window: at roughly seven half-lives it carries under 1% of a
recent bar's weight and stops clearing the mean bin. The three golden-run assertions, marked
Do Not Touch in CLAUDE.md, were asserting the *old* algorithm and had to be re-based. Two
things worth carrying forward. First, when a half-life is much shorter than the window, the
long window quietly stops meaning what its label says — a 5Y profile became a recent-history
profile with a tail, so zooming out past ~18 months barely moves the levels. Check that
consequence before assuming a decay parameter is only a weighting detail. Second, a protected
baseline that a *requested* algorithm change invalidates should be re-based loudly — new
numbers, a comment saying what changed, and a line in the report — never quietly edited to
match. The golden run also lost its independent Python reference in the process, which
downgrades it from a parity check to a self-baseline; that is a real loss and worth stating.

### The e2e suite treats the palette and the levels-panel DOM as contract — a restyle is always a two-file change
2026-07-26. The redesign changed colours and replaced the three level cards with one line,
and roughly ten assertions failed on hard-coded hexes and `#lv .cell` selectors before a
single real defect was found. This is the suite working as designed, not a flaw in it:
locking "gold means volume, nothing else is gold" into a test is what keeps the encoding
honest. Next time, budget for `index.html` and `tests/e2e.cjs` moving together, and when
updating an assertion preserve its *intent* rather than just its selector — a colour test
that no longer forbids anything is worse than no test.

### A failing colour assertion caught a real design flaw, not just a stale expectation
2026-07-26. The plan reserved gold for the volume profile, but EMA 21 was still bright
yellow — on the chart they were the same colour, so the "colour carries a number" claim was
already false. The test that failed was the one asserting no other series holds the level
colour. Treat a failing invariant as a possible finding about the design, not automatically
as a test that needs updating.

### Verify canvas output with the deterministic probe, not with ad-hoc pixel reads in the browser
2026-07-26. A hand-run `getImageData` count in the live page returned an empty canvas twice
while the histogram was plainly drawn on screen — the reads landed at the wrong moment
relative to the debounced redraw. The trustworthy checks were the screenshot and the
suite's `__vpInk()` probe, which runs after `__stable()`. Do not conclude "it is broken"
from an interactive probe that has no synchronisation.

### Reproduce a visual complaint before fixing it — this one was not what it looked like
2026-07-26. "The chart wastes the left half of its width" was filed from a screenshot and
looked like a layout bug in the fit. It is not: a clean load sets the last 140 bars and
holds them at every viewport size tested, including with the chart unlaid-out at the moment
the range is set. The blank appears only when the window widens *after* load, because
Lightweight Charts preserves bar spacing rather than bar count. Two hypotheses were
disproved by experiment before the real mechanism showed up — the second, a zero-height
container, took a throwaway Playwright script to rule out and was worth the five minutes.

### `timeScale.fixLeftEdge` costs the newest bar — never use it here
2026-07-26. It is the obvious one-line answer to blank space on the left, and it silently
drops the last bar from the fitted range: `fitContent` reported 1254 bars ending 23 Jul
instead of 1255 ending 24 Jul. Since the levels are measured against the close of the last
bar *in view*, that turns a cosmetic fix into an analytical change. The suite caught it in
two places. Reverted.

### Regenerating the screenshots is a verification step, not just a deliverable
2026-07-26. The refreshed README images exposed the Verdict card's source line clipped
mid-word at "(1 d" — the value was `flex:none` and overflowed the narrowed rail. Neither
the suite nor ordinary browsing had surfaced it. When a change alters layout widths,
produce the images before declaring the change finished; they force a look at states that
casual clicking skips.
2026-07-27 addendum: the images also rot when the *rules* change, not just the layout — the
committed screenshots still showed the pre-27-Jul checklist (RSI 50–70, no up-bar test) and the
old levels a full session after the maths moved. A scoring or level change invalidates the
screenshots the same way it invalidates METHODOLOGY.md; regenerate them in the same session.
