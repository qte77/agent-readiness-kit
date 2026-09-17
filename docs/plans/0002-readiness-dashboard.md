---
title: Agent-Readiness Kit — GitHub Pages readiness dashboard
description: A static GitHub Pages dashboard over the scan engine's committed data/scans/*.json results — score/grade, per-category pass/fail/warn/unknown breakdown, a trend sparkline reconstructed from git history, and a client-side, display-only High/Mid/Low pass/warn/fail threshold preset.
date: 2026-09-17
updated: 2026-09-17
status: open
issues: []
predecessor: 1
---

# Arc 0002 — GitHub Pages readiness dashboard

## Status (read this first — onboards the next session)

**What shipped (this PR, branch `feat/readiness-dashboard`):**
- **`scripts/buildSite.ts`** (row 1) — pure `summarizeScanRun`/`capHistory` functions, RED-first
  tested in `test/scripts/buildSite.test.ts` (10 assertions: score-present, fallback-score
  computed from pass/fail/warn counts ignoring `unknown`, `undefined` — never `NaN` — when there
  are zero graded findings, `grade` passed through verbatim and never invented for the fallback
  case, N=0/N=1/under-cap/over-cap/explicit-max for `capHistory`). Added `"scripts/**/*.ts"` to
  `tsconfig.json`'s `include`.
- **`scripts/buildSiteCli.ts`** (row 2) — the git-log-walk + file-copy wiring: for each
  `data/scans/*.json` file, reconstructs history via `git log --reverse --format=%H` then
  `git show <sha>:<path>` per commit, summarizes + caps it, and writes
  `site-dist/data/history/<id>.json`; also copies the current `data/scans/*.json` to
  `site-dist/data/scans/`, copies `site/*` to `site-dist/`, and writes
  `site-dist/data/index.json` — a manifest of property ids (**not in the original plan file**;
  added because a static page served over http(s) can't list a directory, and the property list
  must not be hardcoded to `config/properties.ts`). Compiles to
  `dist/scripts/buildSiteCli.js`; `npm run site:build` runs it. **Deviation from the plan**: the
  plan specified `git log --follow --reverse --format=%H`. Verified at source before
  implementing — `--follow`'s rename-detection heuristic false-positives across this repo's
  `data/scans/*.json` files because they're structurally near-identical JSON:
  `git log --follow -- data/scans/redacted-property-com.json` returns commit `c97af99` as part of that
  file's history, but `git show --stat c97af99` proves that commit only touched
  `agenthud-agui-a2ui.json`/`qte77-github-io.json`/`sortmy-london.json` — never
  `redacted-property-com.json` at all. These files are always written in place by `src/checkpoint.ts`
  and never renamed, so `--follow` is unnecessary and actively wrong here. Uses a plain
  `git log --reverse --format=%H` instead (see the module's own docstring for the full
  evidence). Verified by effect: a real `npm run build && npm run site:build` run produced
  `site-dist/{index.html,style.css,app.js,data/index.json,data/scans/*.json,data/history/*.json}`
  for all 4 current properties, each with a history point per real committed revision (1 at
  first branch-off, 2 after rebasing onto a concurrent `scan.yml` run — see the rebase note
  below and Verification).
- **`site/{index.html,style.css,app.js}`** (row 3) — the dashboard itself: header (title +
  High/Mid/Low threshold preset buttons, `aria-pressed`, persisted via
  `localStorage["ark-threshold"]`, wrapped in try/catch), one card per property found in the
  build-time manifest (score/grade or `n/a`, a threshold-colored status badge, a six-category
  pass/fail/warn/unknown breakdown as small badges, a hand-rolled inline SVG sparkline reading
  `data/history/<id>.json`), and a footer (last-scan timestamp across all properties, a link to
  the repo). `app.js` mirrors `scripts/buildSite.ts`'s fallback-score formula in plain JS
  (commented as such) since this zero-build browser script has no way to import that module.
  All fetch/href paths are relative — required because the real deploy serves under
  `/agent-readiness-kit/`, not domain root; verified by serving `site-dist/` both at a server
  root and nested under a nested `/agent-readiness-kit/` subpath locally (see Verification).
- **`.github/workflows/pages.yml`** (row 4) — build-and-deploy workflow for the already-enabled
  Pages target (`build_type: "workflow"`). Triggers on push to `main` touching
  `data/scans/**`/`site/**`/`scripts/buildSite*.ts`, plus `workflow_dispatch`; checkout uses
  `fetch-depth: 0` (required for the git-log walk); no `configure-pages` step (Pages is already
  provisioned). Minor addition beyond the plan's literal text: `permissions` adds
  `contents: read` alongside `pages: write`/`id-token: write` — once a `permissions:` block is
  declared, every unlisted scope defaults to `none`, and `actions/checkout` needs `contents:
  read`; GitHub's own Pages starter workflow and `agenthud-agui-a2ui`'s own `gh-pages.yml` both
  list all three. **YAML validated (parsed with PyYAML) and structurally reviewed against
  `agenthud-agui-a2ui/.github/workflows/gh-pages.yml`'s shape — not yet live-run.** The workflow
  only triggers on push to `main`; triggering it via `workflow_dispatch` from this feature branch
  before merge would either no-op (branch filter) or, if run manually against a non-default ref,
  risk deploying an unmerged feature to the live Pages URL prematurely — neither was done. **The
  first real confirmation that `https://qte77.github.io/agent-readiness-kit/` serves the live
  dashboard is a live-verification item for after this PR merges to `main`**, not something this
  PR claims as done — see the Verification section and row 4 below.
- Docs (row 5): `README.md` (new `## Dashboard` section with the live URL, `## Status` now
  points at this arc instead of the closed 0001, `npm run site:build` documented under
  Development), `CONTRIBUTING.md` (same command + a pointer to this plan doc + a note that the
  deployed dashboard is `pages.yml`'s job), `AGENTS.md` ("Where things live" now points at this
  arc's plan as the current remaining-work table, keeping 0001 as the closed prior arc),
  `CHANGELOG.md` (`### Added` entry), this plan doc.

**Rebase note:** while this arc was in progress, two unrelated PRs merged to `main` first: #33
(moved `.github/CONTRIBUTING.md` to root `CONTRIBUTING.md`, added `.github/workflows/codeql.yml`
+ `.github/dependabot.yml`, excluded `.claude/**` from `vitest.config.ts`'s test discovery) and
#32 (a scheduled `scan.yml` run, adding a second committed revision of every
`data/scans/*.json` file). This branch was rebased onto that `main` before opening the PR;
`CONTRIBUTING.md`/`README.md`/`AGENTS.md`/`CHANGELOG.md` conflicts were resolved by hand
(reapplying this arc's edits onto the new root `CONTRIBUTING.md` path, merging both README/
CHANGELOG additions), and `scripts/buildSiteCli.ts`'s own commits needed no changes — its output
was re-verified after the rebase and correctly picked up the second scan revision (see
Verification).

**What's next, in order:** nothing agent-actionable remains in this arc's own table (see the
remaining-work table below — all 5 rows shipped in this PR). The one open item is **out of this
PR's control**: confirming `pages.yml` actually runs green on `main` and that the live URL serves
real data, once this PR is reviewed and merged (owner action, not an agent one — see Owner-gates).
Follow-on candidates from arc 0001's close (`docs/plans/0001-scan-engine.md`'s "Follow-on work
identified but out of this arc's scope") are unrelated to this dashboard and are **not** part of
this arc — see that section directly rather than duplicating it here.

**The loop** (same shape as arc 0001's): RED-first test for module logic
(`scripts/buildSite.ts`) → minimum implementation → `npx vitest run` + `npx tsc --noEmit` green →
commit on a topic branch → push + open PR (don't merge from inside the dispatched agent) → CI +
CodeFactor green → owner reviews and merges.

**Owner-gates:** reviewing and merging this PR (a human-authored PR from a real git identity, not
a bot token — per this arc's own plan, this should merge without the bot-authored-PR friction hit
on arc 0001's row 13, but that is **not yet empirically confirmed** on this real PR); after merge,
confirming the first real `pages.yml` run on `main` goes green and that
`https://qte77.github.io/agent-readiness-kit/` serves the live dashboard with real data (row 4's
full done-when — see the table).

**Commands:**

```bash
cd /workspaces/qte77/agent-readiness-kit
npm install
npx vitest run                          # test suite
npx tsc --noEmit                        # typecheck
npm run build && npm run site:build     # produces site-dist/ locally
npx serve site-dist                     # local preview (or: python3 -m http.server --directory site-dist)
```

**Watch-outs:**
- **`git log --follow` is unsafe for this repo's `data/scans/*.json` files** — see the row 2
  entry above and `scripts/buildSiteCli.ts`'s docstring for the full evidence. Don't reintroduce
  `--follow` here without re-verifying against a real multi-file, multi-revision history first.
- **No real browser was used to verify `site/app.js`'s DOM-building logic** — this sandbox has no
  browser. Verification was HTTP-level (serving `site-dist/` with a local static server,
  including from a nested subpath simulating `/agent-readiness-kit/`, and fetching every data
  path) plus careful manual code review of `app.js`. A real-browser check (rendering, threshold
  button clicks, console errors) is still worth doing once this is live — see Verification.
- **`data/scans/*.json` has 2 committed revisions per property as of this PR** (1 from arc
  0001's row 13, a 2nd from a `scan.yml` run that landed on `main` while this arc was in
  progress — see the rebase note above) — every sparkline currently renders a real 2-point
  line, not the single-dot N=1 case. `capHistory`/`buildSparkline` both still handle N=0/N=1
  explicitly (see the tests and the module docstrings) for whenever a property has fewer
  revisions — e.g. a brand-new property added to `config/properties.ts` before its first
  `scan.yml` run — this just isn't the state any currently-tracked property is in right now.
- This sandbox's `ls`/`find`/piped commands are denied in places; `git -C <dir> ls-files` and a
  small `node -e` script were used instead where a directory listing was needed — same pattern
  arc 0001's Watch-outs already recommends.

## Design tokens (EyeRest, vendored — full detail in `site/style.css`'s own comment)

Light/dark hex values, sourced from `qte77/qte77/brand/DESIGN.md`, vendored as plain CSS custom
properties (not consumed as the `@qte77/ui-theme` npm package — see that file's header comment
for why): `--color-bg`, `--color-surface`, `--color-border`, `--color-text`,
`--color-text-muted`, `--color-primary`, and the four status colors `--color-positive` (pass),
`--color-caution` (warn), `--color-negative` (fail), `--color-alt` (unknown). System font stack
only (`Inter, system-ui, -apple-system, "Segoe UI", sans-serif` / `"JetBrains Mono", ui-monospace,
monospace`) — no self-hosted webfonts, no manual theme toggle (OS `prefers-color-scheme` only).

## Threshold model (client-side, display-only — full detail in `site/app.js`)

Three presets against a 0-100 score (`ScanRun.score` when present, else a fallback computed from
that run's pass/fail/warn findings, ignoring `unknown`), stored in
`localStorage["ark-threshold"]`, default `"mid"`:

| Preset | pass | warn | fail |
|---|---|---|---|
| High | ≥ 80 | 60-79 | < 60 |
| Mid (default) | ≥ 60 | 40-59 | < 40 |
| Low | ≥ 40 | 20-39 | < 20 |

## Remaining-work table (SINGLE source of open work)

| # | Item | Gate | Depends on | Done-when |
|---|------|------|------------|-----------|
| ~~1~~ | ~~`scripts/buildSite.ts` (pure summarize/cap-history functions) + tests~~ | agent | — | **shipped** — RED-first tests green, covers score-present/fallback/N=0/N=1/cap-at-52 |
| ~~2~~ | ~~`scripts/buildSiteCli.ts` (git-log walk, file I/O, `site-dist/` output)~~ | agent | 1 | **shipped** — `npm run build && npm run site:build` produces `site-dist/{index.html,style.css,app.js,data/scans/*.json,data/history/*.json,data/index.json}` locally, verified by effect |
| ~~3~~ | ~~`site/{index.html,style.css,app.js}` (dashboard: cards, threshold presets, sparklines, EyeRest theme)~~ | agent | — | **shipped** — opens correctly via a local static server over `site-dist/` (including a nested-subpath simulation of the real deploy target), N=0/N=1 history doesn't crash (code-reviewed + unit-covered via `buildSite.ts`'s shared formula; real data is currently N=2, see Status), threshold buttons wire `aria-pressed` + `localStorage` (code-reviewed — no real browser available in this sandbox, see Status) |
| ~~4~~ | ~~`.github/workflows/pages.yml` (build + deploy to the already-enabled Pages target)~~ | agent + owner | 1, 2, 3 | **shipped** — workflow YAML validated (PyYAML parse) and structurally reviewed; **live run pending** — a real push-triggered run on `main` after this PR merges is the actual confirmation that `https://qte77.github.io/agent-readiness-kit/` serves the live dashboard with real data (owner-observable after merge, not verifiable from a feature branch without a premature live deploy) |
| ~~5~~ | ~~Docs audit — README/CONTRIBUTING dashboard URL + `npm run site:build`, CHANGELOG, this plan doc~~ | agent | 1-4 | **shipped** — bundled into this same PR |

## Repo structure (as built this arc)

```
agent-readiness-kit/
  scripts/{buildSite.ts, buildSiteCli.ts}
  site/{index.html, style.css, app.js}
  .github/workflows/pages.yml
  docs/plans/0002-readiness-dashboard.md
  test/scripts/buildSite.test.ts
```

## Source map (what exists now — next session should not need to re-map)

- `scripts/buildSite.ts` — `RunSummary`/`StatusCounts` types; `summarizeScanRun(run: ScanRun):
  RunSummary` (counts findings by status; `score` is `run.score` when present, else
  `fallbackScore` — `round(100 * pass / (pass+fail+warn))`, `undefined` when that denominator is
  0; `grade` is `run.grade` passed through verbatim, never invented); `capHistory(summaries,
  max = 52)` — `summaries.slice(-max)`, oldest-to-newest, N=0/N=1-safe.
- `test/scripts/buildSite.test.ts` — RED-first, 10 assertions (see Status above).
- `scripts/buildSiteCli.ts` — `listPropertyIds()` (reads `data/scans/`, filters to
  `/^[a-z0-9-]+\.json$/`, sorted); `buildHistory(propertyId)` (git-log walk, see Status'
  `--follow` deviation; never throws — a bad revision is skipped with a `console.warn`, not
  fatal); `copyStaticSite`/`copyScanSnapshots`/`writeHistoryFiles`/`writeManifest` — the
  `site-dist/` assembly. Imports `SCANS_DIR` from `src/checkpoint.ts` (single source of truth
  for the `data/scans` path, not restated). Entry point `main()`, run via `npm run site:build`
  → `node dist/scripts/buildSiteCli.js`.
- `site/index.html` — header (title, subtitle, 3 threshold preset buttons with
  `aria-pressed`), `<main id="cards">` (populated by `app.js`), footer (`#footer-text` + a link
  to the repo).
- `site/style.css` — EyeRest tokens (see Design tokens above) under `:root` +
  `@media (prefers-color-scheme: dark)`; card shape (12px radius, 1px border, two-layer
  box-shadow, 1.25rem padding); status-badge/category-badge color classes
  (`status-pass`/`status-warn`/`status-fail`/`status-unknown`); responsive card grid
  (`repeat(auto-fill, minmax(300px, 1fr))`).
- `site/app.js` — `CATEGORIES`/`CATEGORY_ABBR` (the six categories from `src/types.ts`,
  restated as plain data since this browser script can't import a `.ts` module);
  `THRESHOLDS`/`getStoredThreshold`/`setStoredThreshold` (the High/Mid/Low model, localStorage
  wrapped in try/catch); `fallbackScore`/`effectiveScore`/`statusForScore` (mirrors
  `scripts/buildSite.ts`'s formula, commented as such); `countsByCategory`/`worstStatus`/
  `buildCategoryBadges` (per-category pass/fail/warn/unknown badges, worst-status-first color,
  full breakdown in `title`/`aria-label`); `buildSparkline` (fixed 0-100 y-scale, N=0 → text
  note only, N=1 → a lone dot, N>1 → `<polyline>` + a threshold-colored dot at the latest
  point); `buildCard`/`renderCards`/`renderFooter`/`wirePresetButtons`; `loadProperties` (fetches
  `data/index.json` then each property's `data/scans/<id>.json` + `data/history/<id>.json`,
  skipping any property whose scan snapshot fails to fetch rather than failing the whole page).
- `.github/workflows/pages.yml` — two jobs, `build` (checkout `fetch-depth: 0` → setup-node →
  `npm ci` → `npm run build` → `npm run site:build` → `upload-pages-artifact` with
  `path: site-dist`) and `deploy` (`environment: github-pages`, `deploy-pages`, `needs: build`).
  `permissions: { contents: read, pages: write, id-token: write }`;
  `concurrency: { group: pages, cancel-in-progress: false }`. SHA-pinned actions:
  `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1, already used elsewhere in
  this repo), `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (v6, ditto),
  `actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9` (v5.0.0),
  `actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346` (v5.0.1).

## Tests (strict RED-first; modules only)

- `test/scripts/buildSite.test.ts` — done this arc, see Source map above. Only module with
  non-trivial logic in this arc, per `AGENTS.md`'s "Tests" section.
- `scripts/buildSiteCli.ts` is config/wiring (git subprocess + file I/O) — verified by effect
  (a real `npm run site:build` run, inspected directly), not unit-tested, same precedent as
  `src/main.ts`.
- `site/*` is a zero-build browser script/markup/CSS — not swept by `tsconfig.json`'s `include`,
  not typechecked, not unit-tested; verified by effect (a local static server + HTTP-level
  checks) and manual code review, same precedent as `.github/workflows/*.yml`.
- `.github/workflows/pages.yml` is config/wiring — verified by YAML parsing + structural review
  against `agenthud-agui-a2ui/.github/workflows/gh-pages.yml`; a real triggered run is the actual
  effect-based verification, pending this PR's merge (see row 4 above).

## Verification (this arc's commits)

- `npx vitest run` — 146/146 passing (10 new from `test/scripts/buildSite.test.ts`).
- `npx tsc --noEmit` — clean.
- `npm run build && npm run site:build` — produced
  `site-dist/{index.html,style.css,app.js,data/index.json,data/scans/*.json,data/history/*.json}`
  for all 4 real properties; each history file has exactly 2 points, matching this repo's real
  git history (confirmed directly with `git log`, not assumed) — re-verified after rebasing onto
  a concurrent `scan.yml` run (see the Status rebase note); before that rebase each had exactly
  1 point, confirming `capHistory`/`buildHistory` correctly track real history growth rather than
  a hardcoded count.
- Served `site-dist/` locally with `python3 -m http.server` (both at a server root and copied
  into a nested `agent-readiness-kit/` subdirectory to simulate the real
  `/agent-readiness-kit/` deploy path) and fetched every data path
  (`index.html`, `style.css`, `app.js`, `data/index.json`, `data/scans/<id>.json`,
  `data/history/<id>.json`) plus one deliberately-missing path to confirm a real 404 (not a
  catch-all) — all resolved as expected, and all paths in `index.html`/`app.js` are
  relative (grepped for a leading `/` in `href`/`src`/fetch-literal attributes — none found).
- **Not verified**: rendering in a real browser (this sandbox has no browser — see Status'
  Watch-outs) and a live `pages.yml` run on `main` (pending this PR's merge — see row 4).

## At arc close

Tick the remaining-work table against what merged, update this Status section, note any
deviations from the design this arc locked in, and migrate any still-open rows to the next
`NNNN` pair. If the post-merge live-verification item (row 4's pending half) surfaces a real
issue with `pages.yml`, record it here before opening a new arc for the fix — don't let it go
unrecorded the way it would if only fixed silently.
