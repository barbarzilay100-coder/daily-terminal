# PLAN.md — Work Plan & Status

> Living document. Updated at the end of every session. This is the single source of truth for project state.
> Session start: summarize the state below and declare your intended task — then work autonomously per the Checkpoints section in CLAUDE.md.

## Current Status

**Active phase:** Phase 3 — visual identity and presentation
**Active task:** none open — the queue is down to two P4s, both cosmetic
**Last updated:** 2026-07-27

The app is feature-complete and live on GitHub Pages. The English migration and the
market-profile redesign are both merged to `main` and deployed. 160 e2e assertions pass
locally and in CI. What remains is presentation polish and the review queue.

The scoring rules and the level maths were revised on 27 Jul (see the session log). The
profile is now volatility-scaled and age-weighted, so the golden run was re-based against the
new algorithm — it is no longer parity with the original Python run, which no longer exists.
The most visible consequence: ORCL's 2022 support at 104.71 decays out of the profile
entirely, and on multi-year windows zooming out barely moves the levels.

## Project Phases

- [x] Phase 1 — The chart, the indicator set, and the volume-profile levels
- [x] Phase 2 — The graded checklist, the percentile history, and the GARP layer
- [~] Phase 3 — Visual identity and presentation
- [ ] Phase 4 — Portfolio framing: make the README argue the analytical case, not just describe features

## Tasks — Active Phase

- [x] Move the whole UI from Hebrew to English — Done when: zero Hebrew characters in `index.html`, `lang="en"`, suite green
- [x] Give the terminal its own visual identity — Done when: no GitHub default palette, a display face other than the system stack, suite green
- [x] Draw the volume-profile histogram the levels are derived from — Done when: it renders docked to the price scale, clears when there is no profile, and the golden run is unchanged
- [x] Split the profile into up-day and down-day volume — Done when: `histUp` never exceeds `hist`, both sides carry volume, `hist` untouched
- [x] Regenerate the README screenshots at 2x — Done when: both match the original dimensions and show the current design
- [x] Say in the README that the profile is now drawn — Done when: the "support and resistance" paragraph mentions the histogram, and the alt text matches the new image
- [x] Stop the room / reward-to-risk double count, and make the volume condition direction-aware — Done when: R:R reads n/a with nothing overhead instead of taking a second free point, the volume point needs an up bar, suite green
- [x] Six strategy-logic corrections — Done when: RSI floor at 40, a 4% anti-chase cap on freshness, volatility-scaled level separation, 126-bar time decay, exits drawn only for gated entries, and the HVN-as-magnet limit stated; today and history graded by identical rules; suite green
- [x] Sync `docs/METHODOLOGY.md` with the new rules — Done when: every threshold in the document maps to a constant in `index.html`

## Deadlines

None set.

## Backlog

- The fundamentals row leaves whitespace under the narrow Verdict rail. Honest whitespace now rather than a stretched empty card, but a third item could fill it.
- `flagsAt()` in `index.html` is dead code with no callers, and it still holds the pre-27-Jul volume rule without the up-bar test. Either delete it or route the confirmation flags through it.
- The HVN-as-magnet limitation is stated in the app's method note but not in `docs/METHODOLOGY.md`. Not a contradiction, just an asymmetry between the two.

## Blockers & Open Questions

None.

## Session Log

2026-07-27 | Sync METHODOLOGY.md with the new scoring and level rules | Done | Verified by: the four contradicting claims corrected plus a fifth found on the full re-read (the exit rule is ungated, but the arrow now needs an open entry), and every bolded threshold in the document mapped back to a constant in index.html | Next: the two cosmetic P4s remain
2026-07-27 | Six strategy-logic corrections: RSI floor 40, 4% anti-chase cap, volatility-scaled separation, 126-bar time decay, gated exit markers, HVN caveat | Done | Verified by: suite 160/160; ORCL scores 2 of 7 and BTCUSDT 4 of 8; zoom and pan exercised across five windows on both symbols with the profile canvas re-inking each time; AAPL checked against the live API since it is not in the fixtures | Next: sync METHODOLOGY.md
2026-07-27 | Stop the room/R:R double count, make the volume condition direction-aware, add the footer disclaimer | Done | Verified by: suite green after each change, ORCL's denominator really moves to 7, and the new volume assertion exercises a real down bar and up bar from the fixtures rather than a synthetic one | Next: the six strategy-logic corrections
2026-07-26 | Fix the stale assertion count in the CI workflow comment | Done | Verified by: `npm test` printed "157 passed, 0 failed" before the edit, and the comment now matches; CLAUDE.md's sync note corrected from two quote sites to three, since naming only the README is what let this one rot | Next: only the two cosmetic P4s remain
2026-07-26 | Verify METHODOLOGY.md against the code (REVIEW P3) | Done | Verified by: every threshold read from source and matched one by one; one error fixed (default view is 140 bars, not the 252 the score uses, so the two bases do not coincide); suite 157/157 | Next: only two cosmetic P4s remain
2026-07-26 | Investigate the chart's blank left edge (REVIEW P3) | Partial | Verified by: clean loads at several viewports all hold 140 bars, a Playwright repro ruled out the zero-layout theory, and fixLeftEdge was tried and reverted after 2 assertions caught it dropping the newest bar | Next: item re-scoped and downgraded to P4 with the dead end recorded; no code change shipped
2026-07-26 | Rename the stale "in Hebrew" test (REVIEW P2) | Done | Verified by: 157/157 green, repo-wide sweep for Hebrew characters returns nothing | Next: REVIEW P3, the chart's empty left half on a 5Y fit
2026-07-26 | README: say the profile is drawn (REVIEW P1) | Done | Verified by: each claim checked against profileLevels/drawProfile in index.html; docs-only change, no code touched | Next: REVIEW P2, rename the test that still says "in Hebrew"
2026-07-26 | Market-profile redesign + English migration follow-up | Done | Verified by: 157/157 e2e locally and in CI, GitHub Pages deploy green, screenshots regenerated and visually checked | Next: mention the drawn profile in the README

## Update Instructions for Claude Code

At the end of every session, before finishing:

1. Check off completed tasks — only if they passed the full Definition of Done and the evidence rule
2. If a task is unfinished — mark it `[!]` stuck and note why + the next step
3. Update the current status and the next active task
4. Add one line to the session log in the strict five-field format
5. If a blocker or open question came up — write it down
6. If the session produced a lesson (a correction or a confirmed approach) — record it in LESSONS.md
7. If a phase was completed — mark it, sweep the Backlog and the REVIEW.md queue (promote to tasks or delete), and break the next phase into tasks (using the valid task format)
8. Commit and push per the Git rules in the global CLAUDE.md
