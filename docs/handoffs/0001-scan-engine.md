---
plan: docs/plans/0001-scan-engine.md
issue: 1
status: open
updated: 2026-09-16
---

# Handoff — Scan Engine + MCP Worker Scaffold

Onboarding for the next session. Read `docs/plans/0001-scan-engine.md` in full first — it
carries the 9 locked architecture decisions (full rationale in `docs/architecture.md`), the
source map (so you need not re-map what already exists), and the single remaining-work
table. This handoff is the "where we are / what's next / how to run it".

## What shipped this session (repo creation + scaffold, commit 1 direct to `main`)

- Repo created: `qte77/agent-readiness-kit` (public). Tracking issue:
  [#1](https://github.com/qte77/agent-readiness-kit/issues/1).
- `package.json` — zero runtime deps; `vitest` + `typescript` as dev deps only; `npm test` /
  `npm run typecheck` scripts wired.
- `tsconfig.json` — strict, `NodeNext` module resolution, `noUncheckedIndexedAccess`.
- `src/types.ts` — `Category`, `CATEGORIES`, `SourceId`, `Status`, `Finding`, `ScanRun`.
- `src/scan/crosswalk.ts` — `assignCategory(signal)`, seeded from the real crosswalk table
  in `agenthud-agui-a2ui/docs/agent-readiness.md` (read at source, lines 134-141).
- `config/properties.ts` — the 3 target properties (`qte77-github-io`,
  `agenthud-agui-a2ui`, `sortmy-london`).
- `test/types.test.ts` — 13 passing assertions (Finding/ScanRun construction +
  `assignCategory` over all 6 categories + an unknown-signal-throws case).
- `docs/architecture.md` — durable copy of the locked decisions, full rationale.
- Verified green: `npx vitest run` (13/13) and `npx tsc --noEmit` (clean), both run from
  `/workspaces/qte77/agent-readiness-kit`.

**Explicitly NOT built this session** (by design — this was a bounded scaffold pass, not the
full build): `src/scan/sources/*`, `src/scan/orchestrator.ts`, `src/checkpoint.ts`,
`src/playbook.ts`, `src/mcpClient.ts`, `src/main.ts`, `src/remediation/*`, `.github/workflows/*`,
`worker/*`, `data/scans/*.json`. All tracked as open rows in the plan's remaining-work table.

## First actions on resume (in order)

1. **Re-read `docs/plans/0001-scan-engine.md` and `docs/architecture.md` in full** before
   writing any code — the 9 locked decisions are not to be re-derived or second-guessed.
2. **Pick up remaining-work table row 1** (`src/scan/sources/wellKnown.ts` +
   `contentSignal.ts`) — the simplest source (plain `fetch`, no polling, no subprocess), good
   first slice to establish the `src/scan/sources/*.ts` -> `Finding[]` pattern the rest will
   follow. Write its test RED-first in `test/scan/sources/wellKnown.test.ts`.
3. Then row 2 (`discoverSnapshot.ts`, the polyfetch-scrape CLI env-borrow call) — **do not**
   import `polyfetch_scrape.contrib.easter_hunt` and **do not** `uv add git+...`
   polyfetch-scrape; only the CLI subprocess pattern from architecture.md.
4. Then rows 3-5 (the two async-poll sources + the MCP/A2A probes), row 6
   (`orchestrator.ts` to fan them out into one `ScanRun`), row 7 (`checkpoint.ts` to persist
   it to `data/scans/<id>.json`).
5. Row 8 (`remediation/issue.ts`) is the highest-care item — the dedup-safe search-then-
   update-or-create pattern is explicitly required (see architecture.md's "Dedup-safe issue
   creation" section); do not skip the dedup search, it is the exact pattern that prevented a
   35-duplicate-issue bug class elsewhere in this estate.
6. Row 9 (`main.ts`) wires 1-8 together; only then are rows 10-13 (CI, the scheduled
   workflow, the worker, and the first real scan run) meaningful.
7. **Branch + PR from here on** — this repo's first commit went direct to `main` only because
   the repo was brand new with nothing to protect and no CI yet; once row 10 (`ci.yml`)
   lands, switch to the estate's normal branch-per-topic + PR + squash-merge convention.

## Also see (not in the remaining-work table — standalone proposal/support issues)

- [#3](https://github.com/qte77/agent-readiness-kit/issues/3) — generalize `PROPERTIES` beyond
  the 3 hardcoded entries. Deferred; doesn't block this arc.
- [#4](https://github.com/qte77/agent-readiness-kit/issues/4) — row-1 detector patterns
  (markdown-negotiation/content-signal/api-catalog/openapi-spec), generalized to avoid naming an
  unverified-visibility external repo (see watch-out below).
- [#5](https://github.com/qte77/agent-readiness-kit/issues/5) — candidate crosswalk signal gaps
  (a11y, WebMCP, Link response headers, ARD) surfaced by comparing ora.ai and isitagentready.com
  against `crosswalk.ts`. Upstream-crosswalk call, not actionable here yet.
- [#6](https://github.com/qte77/agent-readiness-kit/issues/6) — `api-catalog` category-placement
  disagreement (Discovery here vs. "Protocol Discovery" on isitagentready.com) to reconcile
  against the real upstream table.

## Owner-gates (batch into one sitting, per remaining-work table)

- **Row 11** (`scan.yml`): owner must provision ora.ai / Cloudflare API token secrets on the
  repo before the scheduled workflow can run green. Everything else in the table is
  agent-gated and can proceed without an owner sitting.

## Commands

```bash
cd /workspaces/qte77/agent-readiness-kit
npm install
npx vitest run       # test suite
npx tsc --noEmit      # typecheck
```

## Watch-outs (verified this session)

- `env -u GH_TOKEN -u GITHUB_TOKEN` on **every** git/gh call (else 401/403 against the wrong
  token).
- `-c commit.gpgsign=false` on commits — no GPG key in this environment.
- Sandbox in this environment blocks Bash pipes/`;`/`&&` and even plain `ls`/`find`/`tail` in
  some configurations — prefer `test -d`, shell globs (`for f in dir/*; do …`), and single
  simple commands per call; use targeted `Read`/`Edit`/`Write` tools over `cat`/`sed`.
- The crosswalk table in `agenthud-agui-a2ui/docs/agent-readiness.md` has a few genuinely
  ambiguous signals (bare "robots.txt" spans both Discovery and Trust depending on whether
  presence or AI-crawler-policy *content* is being checked) — `src/scan/crosswalk.ts`
  deliberately omits those bare ids; disambiguate with a more specific signal id when the
  source module that needs it is written (see the comment in `crosswalk.ts`).
- **Verify an external repo's visibility (`gh api repos/<owner>/<name> -q '.visibility'`) before
  naming it in any issue/doc in this public repo.** Issues #3 and #4 originally named specific
  external repos/paths that turned out not to resolve publicly (qte77 has zero private repos, so
  they're either private-to-someone-else or gone) — both were generalized on 2026-09-16.
- **Row 3 (`oraAi.ts`) has two open questions to resolve before implementing**, surfaced reading
  ora.ai's `/docs` page directly: whether `POST /api/scan` requires an API key (decides if the
  row stays agent-gated or needs to move under row 11's owner-provisioned secrets), and whether
  `GET /api/score/<url>` returns per-check results or only the aggregate score/grade (decides
  whether a Finding can compare against ora.ai per-signal, or only at the category level).
- **No lint tooling is configured** (`package.json` has `test`/`typecheck` scripts only, no
  eslint/biome, no lint script) — decide this once, when row 10 (`ci.yml`) is built, rather than
  assuming "strict lint" is already covered.

## At arc close

Tick the plan's remaining-work table against what merged, set this handoff `status: closed`,
note any deviations from the locked decisions, and migrate any still-open rows to the next
`NNNN` pair (`0002-*`).
