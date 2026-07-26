# REVIEW.md — Improvement Queue

> Prioritized findings from reviews (code review, portfolio review, audit).
> One item = one commit (or a few small ones). Work one item at a time, top to bottom.
> When an item is done — check it off with a one-line "verified by" note.

## Review context

Findings raised during the market-profile redesign, 26 Jul 2026, judged against the goal:
a portfolio piece that convinces a recruiter for junior finance roles in Israel.

## Queue (ordered by priority)

- [ ] P4 — The chart can leave blank space on its left after the window is resized — **Investigated 26 Jul 2026; mechanism known, cheap fix ruled out.** Not a redesign regression (identical on the pre-redesign `main`) and it does **not** happen on a clean load: `load()` sets the last `INITIAL_BARS` (140) and that holds — verified at several viewport sizes, and under a chart that has no layout at the moment the range is set. It appears only when the viewport widens *after* load: Lightweight Charts preserves bar spacing rather than bar count, so the view creeps left until it runs past the oldest bar. Self-correcting the moment the user scrolls or zooms.

  **Do not "fix" this with `timeScale.fixLeftEdge`.** It was tried and reverted: it costs the newest bar (`fitContent` then reports 1254 bars ending 23 Jul instead of 1255 ending 24 Jul), which changes the close the levels are measured against — an analytical change in exchange for a cosmetic one. Two assertions caught it.

  — Done when: the view stops running past the first bar on resize **without** altering which bar is last in view, suite green. Worth doing only if it is ever seen on a first impression rather than after a deliberate resize.

- [ ] P4 — Whitespace under the Verdict rail — The fundamentals row now has a narrow left rail that ends well above its neighbours. Better than the stretched empty card it replaced, but still unfinished-looking — Done when: either a third fact fills the rail or the row is rebalanced, without reintroducing dead space elsewhere

## Done

- [x] P3 — `docs/METHODOLOGY.md` unverified against the current code — 26 Jul 2026. Every numeric and factual claim checked against `index.html`: 120 bins, 1.5% separation, mean-bin threshold, first/last bin eligible, 5 trading days, RSI 50–70, 3% room, 2:1, 252-bar profile window, 252/504 percentile windows, 30/200-day staleness, 1% reconciliation gap, the four SIC ranges, the one-hour live cache, eleven live requests, 25 look-ahead samples, and white markers on the EMA 21 series — all correct. **One error found and fixed:** it claimed the default view and the score's profile window coincide at "the default one-year view". The opening view is `INITIAL_BARS = 140`, the score uses `PROFILE_LOOKBACK = 252`, so they do not. Also added the histogram's display and up/down split to the levels section, noting the split feeds only the drawing. Verified by: constants read directly from source; suite still 157/157.

- [x] P2 — Stale test name from the English migration — 26 Jul 2026. Renamed to "the out-of-bucket sector is spelled out with its reason, not printed as the raw token 'other'", which is what the assertion actually checks. Verified by: 157/157 green, and a sweep for Hebrew characters across every md/js/cjs/html/yml file in the repo now returns nothing.

- [x] P1 — README does not mention the drawn profile — 26 Jul 2026. Added a "The histogram is shown, not just used" paragraph covering price alignment, the green/red split by day direction, and that it follows the visible range; rewrote both image alt texts. Verified by: every claim checked against `profileLevels()` and `drawProfile()` in `index.html` — the split rule matches `up = !(j > 0 && b.c < bars[j-1].c)`, and the follows-the-view claim matches `renderLevels()` being driven by the visible-range subscription.
