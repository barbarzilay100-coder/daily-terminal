# CLAUDE.md — Persistent Project Context

> Loaded automatically every session, alongside the global rules (~/.claude/CLAUDE.md).
> All behavior protocols — session start, checkpoints, scope control, verification,
> git, secrets, response style, maintenance — live in the global rules and are NOT
> repeated here. This file holds only what is unique to this project.
> If anything here contradicts the global rules, this file wins.
> Work plan and status live in PLAN.md — read it right after this file.
> Review queue in REVIEW.md, lessons in LESSONS.md.

## What This Project Is

A daily technical-research terminal for any US stock. It draws the
chart, derives support and resistance from where volume actually traded rather than from
eyeballed lines, grades the current bar against a fixed seven-condition checklist, and
shows the company's GARP scorecard beside it so the chart is never read in isolation.

Folder is `technical-terminal`; the GitHub repo and the app name are **daily-terminal**.
Companion to `equity-research-terminal`, which supplies the fundamental layer.

## Goal

A portfolio piece for junior M&A / Business Development / Financial Analyst roles in
Israel. It has to demonstrate that the analysis is defined, reproducible and honest about
its own limits — no invented levels, no look-ahead, explicit "not applicable" rather than
a silent zero. Live and public on GitHub Pages, openable from a CV link with no sign-up
and no API key.

## Commands

```bash
npm install && npx playwright install chromium   # first time only
npm test                                          # node tests/e2e.cjs
```

There is no lint step and no build step. `npm test` is the whole gate.

**The assertion count is quoted in three places** — the README's "Skills demonstrated" table,
the README's Tests section, and the header comment of `.github/workflows/test.yml`. Adding or
removing assertions means editing all three, in the same commit. It has gone stale twice: the
README claimed 148 while the suite was at 157, and when that was fixed the workflow comment was
missed, because this note said "twice" and only named the two in the README.

## Architecture Decisions

- **One file, no build.** The deliverable is a link a recruiter clicks. A build step is a way for that link to break.
- **Levels come from a 120-bin volume-by-price histogram**, never from drawn lines. A local peak clearing the mean bin becomes a level; peaks too close to one already taken are dropped, where "too close" is the asset's own median daily range × 1.5, clamped to 1–5%.
- **Volume enters the profile weighted by age**, half-life 126 bars. Recent accumulation outweighs year-old volume at the same price. A consequence worth knowing: on a multi-year window the oldest bars are effectively absent, so zooming out past roughly 18 months changes the levels very little.
- **No volume means no levels.** An empty window returns nothing and says why, rather than inventing a level out of a zero-mean histogram.
- **Levels follow the visible range and are measured against the last bar in view**; the score does not — it always uses a fixed lookback, so it stays comparable.
- **The profile histogram is drawn, docked to the price scale**, split into volume that arrived on up days (green) against down days (red). `hist` feeds the level maths, `histUp` feeds only the drawing — the two must never be merged.
- **Support and resistance are one flat blue** that no other series on the chart may use. The e2e suite enforces this.
- **The palette and the levels-panel DOM are test contract**, not decoration — see LESSONS.md before any restyle.
- **The clock is frozen in tests** to the fixture recording date, or the staleness guard rots the fixtures a month after recording.
- **UI is English**, matching the README and the companion project.

## Style Instructions

- UI copy is English, plain, and never apologises. An empty state explains what is missing and why, in a full sentence.
- Comments in `index.html` explain *why* a guard exists, usually naming the bug it prevents. Match that density — this codebase documents its own reasoning and should keep doing so.
- Colour is allowed to carry meaning; when it does, say so in a comment and enforce it in the suite.

## Do Not Touch

- `tests/fixtures/data/` — recorded real API responses. Re-recording invalidates the golden run (`R1=123.70`, `R2=130.83`, no support) and the frozen clock in `harness.js`. If they are ever re-recorded, `RECORDED_AT` moves with them. These values were re-based when the profile gained volatility-scaled separation and time decay; they are no longer parity with the original Python run, which no longer exists to compare against.
- The three golden-run assertions in `tests/e2e.cjs`. They are the guard that a change to the drawing never moved the maths.
