# LESSONS.md — Lessons From Past Sessions

> Read at session start. Add at session end only if the session produced a real lesson —
> a correction (something assumed that turned out wrong) or a confirmed approach worth repeating.
> One lesson per entry, one-line summary first. Update existing entries rather than duplicating.
> Delete entries proven wrong. Don't record what the repo, PLAN.md, or chat history already records.

## Lessons

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

### Regenerating the screenshots is a verification step, not just a deliverable
2026-07-26. The refreshed README images exposed the Verdict card's source line clipped
mid-word at "(1 d" — the value was `flex:none` and overflowed the narrowed rail. Neither
the suite nor ordinary browsing had surfaced it. When a change alters layout widths,
produce the images before declaring the change finished; they force a look at states that
casual clicking skips.
