# REVIEW.md — Improvement Queue

> Prioritized findings from reviews (code review, portfolio review, audit).
> One item = one commit (or a few small ones). Work one item at a time, top to bottom.
> When an item is done — check it off with a one-line "verified by" note.

## Review context

Findings raised during the market-profile redesign, 26 Jul 2026, judged against the goal:
a portfolio piece that convinces a recruiter for junior finance roles in Israel.

## Queue (ordered by priority)

- [ ] P2 — Stale test name from the English migration — `tests/e2e.cjs` still names an assertion "the out-of-bucket sector is stated in Hebrew". The assertion is correct; only the name rotted. Anyone reading the suite as a work sample sees an inconsistency — Done when: the name matches what it checks and the suite is still green

- [ ] P3 — The chart wastes the left half of its width on a 5Y fit — Confirmed pre-existing, not a redesign regression: loading the pre-redesign `main` side by side showed the identical gap. Still the first thing a visitor sees — Done when: a full fit either fills the width or the default view is narrowed to one that does, with the suite still green

- [ ] P3 — `docs/METHODOLOGY.md` unverified against the current code — It was not re-read during the redesign. The level maths did not change, so it is probably accurate, but "probably" is not the standard the rest of this project holds — Done when: every numeric claim in it is checked against `profileLevels()` and the constants, and any drift is corrected

- [ ] P4 — Whitespace under the Verdict rail — The fundamentals row now has a narrow left rail that ends well above its neighbours. Better than the stretched empty card it replaced, but still unfinished-looking — Done when: either a third fact fills the rail or the row is rebalanced, without reintroducing dead space elsewhere

## Done

- [x] P1 — README does not mention the drawn profile — 26 Jul 2026. Added a "The histogram is shown, not just used" paragraph covering price alignment, the green/red split by day direction, and that it follows the visible range; rewrote both image alt texts. Verified by: every claim checked against `profileLevels()` and `drawProfile()` in `index.html` — the split rule matches `up = !(j > 0 && b.c < bars[j-1].c)`, and the follows-the-view claim matches `renderLevels()` being driven by the visible-range subscription.
