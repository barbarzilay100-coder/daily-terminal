# CLAUDE.md — Persistent Project Context

> Loaded automatically every session, alongside the global rules (~/.claude/CLAUDE.md).
> All behavior protocols — session start, checkpoints, scope control, verification,
> git, secrets, response style, maintenance — live in the global rules and are NOT
> repeated here. This file holds only what is unique to this project.
> If anything here contradicts the global rules, this file wins.
> Work plan and status live in PLAN.md — read it right after this file.
> Review queue in REVIEW.md, lessons in LESSONS.md.

## What This Project Is

A daily technical-research terminal for any US stock or major crypto pair. It draws the
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

## Stack & Technologies

- One self-contained `index.html` — vanilla JS, no build step, no framework
- [Lightweight Charts](https://github.com/tradingview/lightweight-charts) 5.2.0 from unpkg, pinned with an SRI hash
- Google Fonts: Archivo (display, variable width axis) + IBM Plex Mono (figures)
- Playwright + headless Chromium for the e2e suite
- GitHub Actions for tests, GitHub Pages for hosting

## Project Structure

```
index.html               the entire app — markup, styles, logic
docs/
  METHODOLOGY.md         how the levels and the score are defined
  screenshot*.png        README images, regenerated at 2x from live data
tests/
  e2e.cjs                the suite: boots index.html against fixtures
  harness.js             offline build + the window.__* test hooks
  fixtures/data/         recorded real API responses — DO NOT re-record casually
.github/workflows/test.yml
```

## Commands

```bash
npm install && npx playwright install chromium   # first time only
npm test                                          # node tests/e2e.cjs
```

There is no lint step and no build step. `npm test` is the whole gate.

## Architecture Decisions

- **One file, no build.** The deliverable is a link a recruiter clicks. A build step is a way for that link to break.
- **Levels come from a 120-bin volume-by-price histogram**, never from drawn lines. A local peak clearing the mean bin becomes a level; peaks within 1.5% of one already taken are dropped.
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

- `tests/fixtures/data/` — recorded real API responses. Re-recording invalidates the golden run (`R1=116.58`, `R2=126.08`, `S1=104.71`) and the frozen clock in `harness.js`. If they are ever re-recorded, `RECORDED_AT` moves with them.
- The three golden-run assertions in `tests/e2e.cjs`. They are the guard that a change to the drawing never moved the maths.
