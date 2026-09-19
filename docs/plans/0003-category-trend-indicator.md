---
title: Agent-Readiness Kit — per-category trend indicator
description: Add a small "did this category get better/worse since last run" indicator to each dashboard card's category badges, using history data already collected — no new scan sources, no new API calls.
date: 2026-09-18
updated: 2026-09-19
status: closed
issues: []
predecessor: 2
---

# Arc 0003 — per-category trend indicator

## Status (read this first — onboards the next session)

**Closed 2026-09-19 — shipped with one deferred verification gap.** Rows 1-2 shipped in full
(PR #49, merged): `scripts/buildSite.ts` computes `categoryStatus`, `site/app.js`/`style.css`
render the ▲/▼ trend arrow. **Deviation from the design's done-when bar**: row 3's full
patchright/e2e pass (desktop/mobile/tablet × light/dark, a synthetic history fixture forcing a
real ▲ and ▼, live re-screenshot) was **not performed** — the implementing agent's session was
interrupted mid-arc; recovery work (review + finish) covered unit tests (152→155 passing),
`tsc --noEmit`, and a build/inspect smoke test against real history (confirmed `categoryStatus`
backfills correctly, and the real "no-change" case renders no arrows), but stopped short of
actual browser verification. This was disclosed in PR #49's body before merge, and the owner
chose to merge anyway rather than block on it. A later WebFetch-based live check could not
substitute for real verification (WebFetch doesn't execute JavaScript, so it can't observe this
client-rendered dashboard's actual output). **Follow-up**: a real browser check (patchright or
equivalent) of the live dashboard is still owed — tracked as a fresh small item, not silently
dropped (see the remaining-work table's row 3 note).

**What shipped, in order** (full detail in the remaining-work table below):
1. Row 1 — `scripts/buildSite.ts` schema change + pure logic, RED-first tests. **Shipped.**
2. Row 2 — `site/app.js` + `site/style.css` rendering (depends on row 1's `categoryStatus`
   field existing). **Shipped**, code-level-verified only (see deviation note above).
3. Row 3 — verification: rebuild against real history, polyfetch/patchright e2e pass, ship.
   **Partially done** — build/inspect + unit tests done; e2e pass and live re-screenshot still
   outstanding.

**The loop** (same one used for every prior row this session): RED-first test → minimum
implementation to pass → `npx vitest run` + `npx tsc --noEmit` green → commit on a topic
branch → push + open PR (don't merge from inside a dispatched agent) → CI/CodeFactor/CodeQL
green → `gh pr merge --squash --admin --delete-branch` → delete branch (remote + local) →
`git fetch --prune`.

**Is this plan set up for parallel subagents + worktrees? No — and that's the correct answer,
not a gap.** This feature has exactly one dependency chain, not independent pieces: row 2
cannot render a trend indicator until row 1's `categoryStatus` field exists on `RunSummary`.
There is no clean split the way arc 0001's seven independent scan-source modules had. Per this
project's own established precedent (arc 0002's dashboard was also dispatched as **one** agent
in **one** worktree for the identical reason — see `docs/plans/0002-readiness-dashboard.md`'s
"Dispatch" section), dispatch this as a single subagent in a single worktree covering rows 1-3
as one branch/PR. Forcing two parallel agents onto a 1-dependency-deep, ~4-file feature would
create false parallelism and a guaranteed merge-order dependency, not real speedup.

**Owner-gates:** none. Everything here is agent-gated — no secrets, no new external calls, no
schema migration step (history is reconstructed fresh from git log on every build, so the new
field backfills automatically for every historical revision the moment `buildSite.ts` is
updated — same mechanism the recent history-dedup fix relied on, see Watch-outs).

**Commands:**
```bash
cd /workspaces/qte77/agent-readiness-kit
npm install
npx vitest run          # test suite
npx tsc --noEmit        # typecheck
npm run build && npm run site:build   # rebuild site-dist/ against real repo history
npx serve site-dist      # local preview (or `make preview`, which does build+site_build+serve)
```

**Watch-outs:**
- `env -u GH_TOKEN -u GITHUB_TOKEN` on every git/gh call (else 401/403 against the wrong
  token) — a standing gotcha for this whole repo, not new to this arc.
- `git config commit.gpgsign false` locally before any commit (no GPG key in this sandbox).
- This dev sandbox rejects literal `()`/`<>` in inline `-m`/`--body`/`--title` text — write
  commit/PR messages to a scratch file and use `-F`/`--body-file`.
- A worktree agent must use `/usr/bin/git <cmd>` directly — bare `git` is intercepted by an
  rtk hook inside worktrees.
- Every future bot-authored PR on this repo (i.e. anything `scan.yml`/Dependabot opens) needs
  an owner `--admin` squash-merge regardless of green checks — a known, standing repo-ruleset
  cost documented in `docs/plans/0001-scan-engine.md`'s arc-close notes. **Not relevant to
  this arc** — a human-dispatched worktree branch pushed under the coordinator's own git
  identity merges normally, same as every PR in arc 0002.
- `data/history/<id>.json` is a **build artifact**, never committed (`site-dist/` is
  gitignored) — it's reconstructed fresh from `git log` on every `pages.yml` run. Don't try to
  "fix" old history data by hand-editing a committed file; there isn't one.

## Context

The dashboard (arc 0002) shows each card's category breakdown (`Disc 2P 4F 0W`, etc.) computed
from the *current* run only — there's no way to see whether a category got better or worse
since last time, even though the sparkline already proves per-run history is available and
collected. Flagged as a follow-on enhancement after shipping the ora.ai score-attribution work
this session. Goal: add a small, honest "did this category change since last run" indicator
next to each category badge, using data already being collected — no new scan sources, no new
API calls, no owner gate.

## Design

**Schema change (retroactive — no data loss, no migration):** `data/scans/<id>.json`'s
`findings[]` already carries `category`/`status` per finding for every historical git
revision. Add a `categoryStatus: Record<Category, Status>` field to `RunSummary` — the *worst*
status per category for that run, using the exact same "fail > warn > unknown > pass" priority
`site/app.js`'s `worstStatus` already uses for badge coloring (reuse verbatim — don't invent a
second ordering). Since `buildSiteCli.ts` re-walks and re-summarizes every historical commit
on every build (the same mechanism the recent history-dedup fix relies on — see
`docs/plans/0002-readiness-dashboard.md`), this backfills for free the moment the code ships;
no migration step, no data to write.

**Where the comparison happens:** client-side, in `site/app.js`, at render time — comparing
the *current* run's freshly-computed per-category status against `history[history.length - 2]`
(the previous run; `history[history.length - 1]` is the current run itself, already included
as the newest history point by `buildSiteCli.ts`). This mirrors the existing pattern where all
rendering/derivation already lives in `app.js` (`buildCard`, `buildCategoryBadges`,
`buildSparkline` are all pure-from-data, computed fresh on every page load). No new field is
written to history for "trend direction" itself — just the raw per-category status, computed
once per run and stored; the delta is derived, never persisted.

**Comparison semantics:** rank statuses `fail=0, warn=1, unknown=2, pass=3` (higher = better,
the exact ordering `STATUS_PRIORITY` already implies by listing worst-first). Higher rank than
previous → improved (▲); lower → worsened (▼); equal → **no indicator at all** — the common
case in real data so far (every property's category breakdown has been identical run-to-run
across all recorded history; see the Source map below for the real numbers). Cluttering every
badge with a "no change" glyph would bury the signal that something actually moved. Needs
`history.length >= 2` to have anything to compare against; fewer points → no indicator, same
"not enough history yet" spirit `buildSparkline` already uses for N<2 (see its own
`sparkline-note` handling).

**Visual treatment:** append a single small `▲`/`▼` character to the category badge's text
content and its `title`/`aria-label`, only when present (omit both entirely when unchanged).
Fixed colors regardless of which specific statuses were involved — `▲` always
`var(--color-positive)`, `▼` always `var(--color-negative)` — a plain, consistent "which
direction did this move" signal layered on top of the badge's own absolute-status background
color, not redundant with it (the badge's background already says "how bad is it now"; the
arrow says "which way is it moving").

**Known, accepted simplification — state this in code comments, don't silently get it wrong
later:** a status transition through `unknown` (e.g. warn→unknown) ranks as "improved" under
this ordering, even though `unknown` really means "indeterminate," not "verified better." This
mirrors `STATUS_PRIORITY`'s existing, already-shipped treatment of `unknown` for badge
coloring — not a new inconsistency this feature introduces, and not worth a separate three-way
(better/worse/indeterminate) model for what's currently a rare edge case (zero occurrences in
real data collected so far).

## Repo structure (target — only 4 files touched, 2 pre-existing untouched for reference)

```
agent-readiness-kit/
  src/types.ts                        # Category, CATEGORIES, Status, Finding, ScanRun — untouched, just imported from
  scripts/buildSite.ts                # MODIFIED — add categoryStatuses() + categoryStatus field
  scripts/buildSiteCli.ts             # untouched — already calls summarizeScanRun per historical revision, no change needed
  test/scripts/buildSite.test.ts      # MODIFIED — new RED-first cases
  site/index.html                     # untouched
  site/app.js                         # MODIFIED — trend-arrow rendering in buildCard/buildCategoryBadges
  site/style.css                      # MODIFIED — .category-trend-up/.category-trend-down
```

## Source map (exact current content — so the next session doesn't have to re-map)

**`src/types.ts`** (full file, 77 lines, already stable, no changes needed) — exports:
```ts
export type Category = "Discovery" | "Content" | "Trust" | "Execution" | "Agent-to-Agent" | "Identity & Auth";
export const CATEGORIES: readonly Category[] = ["Discovery", "Content", "Trust", "Execution", "Agent-to-Agent", "Identity & Auth"] as const;
export type Status = "pass" | "fail" | "warn" | "unknown";
export interface Finding { id: string; category: Category; source: SourceId; status: Status; summary: string; remediation?: string; evidence?: Record<string, unknown>; }
export interface ScanRun { propertyId: string; url: string; scannedAt: string; findings: Finding[]; score?: number; grade?: string; }
```

**`scripts/buildSite.ts`** (full file, 69 lines, pre-this-arc) — the file to modify:
```ts
import type { ScanRun, Status } from "../src/types.js";

export interface StatusCounts { pass: number; fail: number; warn: number; unknown: number; }

export interface RunSummary {
  scannedAt: string;
  score?: number;
  grade?: string;
  counts: StatusCounts;
}

function countByStatus(run: ScanRun): StatusCounts {
  const counts: StatusCounts = { pass: 0, fail: 0, warn: 0, unknown: 0 };
  for (const finding of run.findings) counts[finding.status] += 1;
  return counts;
}

const GRADED_STATUSES: readonly Status[] = ["pass", "fail", "warn"];

function fallbackScore(counts: StatusCounts): number | undefined {
  const denominator = GRADED_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  if (denominator === 0) return undefined;
  return Math.round((100 * counts.pass) / denominator);
}

export function summarizeScanRun(run: ScanRun): RunSummary {
  const counts = countByStatus(run);
  return { scannedAt: run.scannedAt, score: run.score ?? fallbackScore(counts), grade: run.grade, counts };
}

function dedupeConsecutive(summaries: RunSummary[]): RunSummary[] {
  const result: RunSummary[] = [];
  for (const summary of summaries) {
    if (result[result.length - 1]?.scannedAt !== summary.scannedAt) result.push(summary);
  }
  return result;
}

export function capHistory(summaries: RunSummary[], max = 52): RunSummary[] {
  return dedupeConsecutive(summaries).slice(-max);
}
```

**Required edit to `scripts/buildSite.ts`** — add after the `import` line:
```ts
import type { Category, Finding, ScanRun, Status } from "../src/types.js";
import { CATEGORIES } from "../src/types.js";
```
Add to `RunSummary`: `categoryStatus: Record<Category, Status>;`
Add a new function (mirrors `app.js`'s `worstStatus`, described below, exactly):
```ts
const STATUS_PRIORITY: readonly Status[] = ["fail", "warn", "unknown", "pass"];

function worstStatusInCategory(findings: Finding[], category: Category): Status {
  const inCategory = findings.filter((f) => f.category === category);
  return STATUS_PRIORITY.find((status) => inCategory.some((f) => f.status === status)) ?? "unknown";
}

function categoryStatuses(run: ScanRun): Record<Category, Status> {
  const result = {} as Record<Category, Status>;
  for (const category of CATEGORIES) result[category] = worstStatusInCategory(run.findings, category);
  return result;
}
```
Wire it into `summarizeScanRun`'s return object: `categoryStatus: categoryStatuses(run)`.

**`test/scripts/buildSite.test.ts`** (108 lines pre-this-arc; already has `summarizeScanRun`
and `capHistory` describe blocks, including the 3 dedup tests added earlier this session —
see their existing `finding(status, id)` helper and `BASE_RUN` fixture at the top of the file,
reuse both). Every existing `summarizeScanRun` test's `toEqual({...})` expectation will need
`categoryStatus: {...}` added once the field exists — **update these, don't leave them
silently incomplete** (a `toEqual` on an object missing a real field the function now returns
will fail loudly, which is correct — fix the expectations, don't loosen the assertion to
`toMatchObject`).

New cases to add:
- worst-status-wins across mixed findings within one category (e.g. two Discovery findings,
  one `pass` one `fail` → `categoryStatus.Discovery === "fail"`).
- `"unknown"` for a category with zero findings mapped to it.
- all 6 `CATEGORIES` keys always present in the result, even when a run's findings don't cover
  every category.

**`site/app.js`** (full file, 282 lines pre-this-arc; relevant excerpts) — existing constants
near the top:
```js
const CATEGORIES = ["Discovery", "Content", "Trust", "Execution", "Agent-to-Agent", "Identity & Auth"]; // restated locally — browser script, no build step, can't import from src/types.ts
const CATEGORY_ABBR = { Discovery: "Disc", Content: "Cont", Trust: "Trust", Execution: "Exec", "Agent-to-Agent": "A2A", "Identity & Auth": "Auth" };
const STATUS_PRIORITY = ["fail", "warn", "unknown", "pass"]; // <-- the ordering to reuse verbatim
const STATUS_CLASS = { pass: "status-pass", warn: "status-warn", fail: "status-fail", unknown: "status-unknown" };
```
Existing functions to extend (not replace):
```js
function countsByCategory(findings) { /* returns {[category]: {pass,fail,warn,unknown}} from CURRENT run's findings */ }
function worstStatus(counts) { return STATUS_PRIORITY.find((status) => counts[status] > 0) ?? "unknown"; }
function buildCategoryBadges(findings) { /* builds one <span class="category-badge ..."> per category, called from buildCard */ }
function buildCard(property, thresholdKey) {
  const { id, run, history } = property; // history is already available here — the previous point is history[history.length - 2]
  // ... categoryBadges = el("div", { class: "category-breakdown" }, buildCategoryBadges(run.findings));
}
```
**Required edit:** `buildCategoryBadges` needs the previous run's `categoryStatus` (or
`undefined` if `history.length < 2`) passed in so it can compute each category's rank delta
using the same `STATUS_PRIORITY` array (rank = index in a *reversed* copy, or just compare
`STATUS_PRIORITY.indexOf(current)` vs `STATUS_PRIORITY.indexOf(previous)` directly — lower
index = worse in this array's existing worst-first ordering, so **lower index number now than
before = worsened**, not improved; get this inversion right, it's the one easy place to
introduce an inverted-arrow bug). Append `▲`/`▼` to the badge's `text`/`title`/`aria-label`
only when the two differ.

**`site/style.css`** (relevant existing rules to extend, not replace):
```css
.category-badge { font-size: 0.7rem; font-family: var(--font-mono); padding: 2px calc(var(--space) / 1.5); border-radius: var(--radius-sm); color: var(--color-bg); white-space: nowrap; }
.category-badge.status-pass { background: var(--color-positive); }
.category-badge.status-warn { background: var(--color-caution); }
.category-badge.status-fail { background: var(--color-negative); }
.category-badge.status-unknown { background: var(--color-alt); }
```
Add:
```css
.category-trend-up { color: var(--color-positive); }
.category-trend-down { color: var(--color-negative); }
```
(No layout classes needed — the arrow is inline text inside the existing badge, not a new
element requiring flex/grid changes.)

**Real current data, for verification/e2e** (from the live dashboard as of 2026-09-18): all 3
tracked properties (`qte77-github-io`, `agenthud-agui-a2ui`, `sortmy-london`) have had
**identical per-finding status breakdowns across every recorded history point so far** — zero
real category changes exist yet in production data. The e2e pass will need a synthetic
history mutation (or a temporary local fixture) to actually see a rendered ▲/▼; verifying "no
indicator renders" against the real live dashboard is still meaningful and should be checked,
but it alone cannot prove the arrow-rendering code path works.

## Remaining-work table (SINGLE source of open work)

| # | Item | Gate | Depends on | Done-when |
|---|------|------|------------|-----------|
| 1 | ~~`scripts/buildSite.ts`: `categoryStatuses()` + `categoryStatus` field on `RunSummary`, RED-first tests~~ | agent | — | **Shipped** (PR #49) — 3 new tests, all pass; `npx tsc --noEmit` clean |
| 2 | ~~`site/app.js` trend-arrow rendering + `site/style.css` trend classes~~ | agent | 1 | **Shipped** (PR #49) — logic traced correct by hand (rank comparison, no inversion); **not** verified in a real browser (see Status deviation note) |
| 3 | Real browser (patchright or equivalent) verification of the live dashboard: confirm the real "no-change" case renders cleanly across viewports/themes with zero console errors, then force a synthetic ▲/▼ via a temporary local fixture and confirm correct rendering | agent | 1, 2 | Still open — carried forward from row 3's original done-when, which was not met before merge. Not urgent (all 3 tracked properties currently have identical category status, so the live "no-arrows" case is low-risk), but owed before the arrow-rendering path can be called verified |

## Tests (strict RED-first; modules only)

- `scripts/buildSite.ts`'s new `categoryStatuses`/`worstStatusInCategory` are real module logic
  (worth testing) — same bar this repo already applies to `summarizeScanRun`/`capHistory` in
  the same file.
- `site/app.js`'s rendering changes are config/wiring (browser script, no build step, not
  swept by `tsconfig.json`) — verified by effect (local server + polyfetch/patchright
  screenshots), not unit-tested, matching this repo's existing, established treatment of every
  other `app.js` change this session (score attribution, subtitle line-break, category-badge
  contrast fix).

## Verification

- `npx vitest run` / `npx tsc --noEmit` green.
- Rebuild (`npm run build && npm run site:build`) against this repo's real history and inspect
  `site-dist/data/history/*.json` — confirm `categoryStatus` is populated for every point,
  including older, already-committed revisions (retroactive backfill working, no migration
  needed).
- Local polyfetch/patchright e2e pass (matching the pattern already used for the score
  attribution and category-badge-contrast fixes this session): serve `site-dist/` locally,
  confirm the real (no-change) case renders with zero clutter across desktop/mobile/tablet ×
  light/dark, then use a synthetic/temporary history fixture to force at least one real ▲ and
  one ▼ and confirm both render with the correct color and direction (not inverted), zero
  console errors, zero network failures. Re-screenshot the live remote dashboard after
  deploying to confirm the no-change baseline case in production.

## At arc close

**Closed 2026-09-19.** Rows 1-2 shipped as designed — the `STATUS_PRIORITY` index-inversion risk
the design flagged did **not** need different handling; the implementation matched the design
exactly (`statusRank(current) > statusRank(previous)` ⇒ improved). Row 3's browser-verification
gap (see Status section) is migrated forward rather than left silently dropped — no dedicated
new arc needed for one verification task; do it opportunistically alongside the next dashboard
change, or promote it to its own row if a dashboard-focused arc opens before then.
