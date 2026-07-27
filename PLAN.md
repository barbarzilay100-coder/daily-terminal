# PLAN.md — Work Plan & Status

> Living document. Updated at the end of every session. This is the single source of truth for project state.
> Session start: summarize the state below and declare your intended task — then work autonomously per the Checkpoints section in CLAUDE.md.

## Current Status

**Active phase:** Phase 4 — portfolio framing
**Active task:** none open — next candidate: decide whether Phase 4 needs anything beyond the worked example, or close it
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
- [x] Phase 3 — Visual identity and presentation (two cosmetic P4s remain in REVIEW.md, neither blocks the phase)
- [~] Phase 4 — Portfolio framing: make the README argue the analytical case, not just describe features

## Tasks — Active Phase

- [x] Bring the README's level description current with the 27 Jul maths — Done when: age weighting, the decay consequence and volatility-scaled separation appear in the levels paragraph with their reasons, and no claim contradicts `index.html`
- [x] Worked example: read one screen — Done when: a short README section walks the ORCL screenshot from chart to verdict, arguing why each element earns its place rather than listing it
- [x] Regenerate both README screenshots (found stale mid-task) — Done when: the images show the post-27-Jul rules and levels at the original 2x dimensions
- [x] Live session display: live header price + forming candle, analysis untouched — Done when: the quote refreshes each minute while the market is open, the forming bar never enters BARS, the levels line says it is not counted, and the suite covers both the live path and the caught-up no-op

## Deadlines

None set.

## Backlog

- Crypto asymmetry with the new live-bar rule: Binance klines include the forming day and it
  goes straight into BARS, so for crypto the forming bar IS counted by the score and the levels,
  unlike stocks. Existing behaviour, predates the live feature. Either split it out the same way
  (moves the BTC test baselines) or state the asymmetry in METHODOLOGY.md.

(Otherwise empty — swept 2026-07-27 at the Phase 4 opening: `flagsAt()` deleted, the HVN
limitation added to METHODOLOGY.md, and the Verdict-rail whitespace line removed as a duplicate
of REVIEW.md's P4.)

## Blockers & Open Questions

None.

## Session Log

2026-07-27 | Consistency review of the live feature: lagging-history guard (quote's own previous close must match our last bar), transient network errors keep the last print instead of flashing the stale close, and the crypto forming-day asymmetry stated in METHODOLOGY.md | Done | Verified by: suite 168/168 with the new refusal assertion, real-network run still live (120.50 +4.79% at 11:09 EDT) so the guard passes genuine quotes, count synced in all three sites | Next: the crypto split stays in the Backlog
2026-07-27 | Live session display: keyless quote endpoint feeds a live header price and a translucent forming candle, refreshed per minute while the exchange is open; analysis stays on closed bars | Done | Verified by: suite 167/167 (7 new assertions: live path + caught-up no-op), and a real-network run during the open session showed ORCL live at 120.75 +5.00% with levels still measured against the 24 Jul close and the "not counted" note on screen; assertion count synced in all three quote sites | Next: the crypto forming-kline asymmetry sits in the Backlog
2026-07-27 | Worked example added to the README, and both screenshots regenerated after they turned out to show the pre-27-Jul rules | Done | Verified by: every number in the new section read off the freshly captured panels (score 2/7, R1 124.35 +8.1%, R2 131.12 +14.0%, percentiles 30/26, verdict 5/8), images match the original 2x dimensions, suite 160/160 | Next: decide whether Phase 4 needs more or closes
2026-07-27 | Backlog sweep + Phase 4 opened: deleted dead flagsAt(), added the HVN-as-magnet limit to METHODOLOGY.md, synced the README's level maths (age decay, volatility-scaled separation) | Done | Verified by: suite 160/160 after the code deletion, every new README claim traced to a constant or the method note in index.html, assertion count unchanged so the three quote sites stay correct | Next: the worked-example README section
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
