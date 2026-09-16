---
title: Agent-Readiness Kit — scan engine + MCP worker scaffold
description: Build the estate's agent-native-readiness scanner — a GHA-only scan engine over 3 qte77 properties, one committed JSON per property as the trend record, dedup-safe remediation issues, and a read-only MCP worker exposing results. This arc ships the repo scaffold, core types, and the category crosswalk.
date: 2026-09-01
updated: 2026-09-16
status: open
issues: [1, 3, 4, 5, 6]
predecessor: null
---

# Arc 0001 — Scan Engine + MCP Worker Scaffold

## Status (read this first — onboards the next session)

**What shipped:**
- **2026-09-01 (scaffold):** repo created (public), tracking [#1](https://github.com/qte77/agent-readiness-kit/issues/1);
  `package.json`/`tsconfig.json`, `src/types.ts`, `src/scan/crosswalk.ts` (seeded from
  `agenthud-agui-a2ui/docs/agent-readiness.md`), `config/properties.ts` (3 target properties),
  `test/types.test.ts` (13 passing), `docs/architecture.md`.
- **2026-09-16 (docs/process + row 10):** `.github/workflows/ci.yml` (row 10 — typecheck+test on
  PR); `.github/workflows/tag-release.yaml` + `publish-release.yaml` (dormant until a version is
  actually cut — see `.github/CONTRIBUTING.md`'s Releasing section); `AGENTS.md`, `CLAUDE.md`
  (pointer to `AGENTS.md`), `.github/CONTRIBUTING.md` — modeled on `agenthud-agui-a2ui`'s
  conventions, scoped for this repo's single-package, pre-v1 state; `MEMORY.md` gitignored (a
  Claude Code meta-artifact, not project content). Issues #3 and #4 had unverified-visibility
  external-repo references generalized (see Watch-outs). Opened
  [#5](https://github.com/qte77/agent-readiness-kit/issues/5) (candidate crosswalk signal gaps:
  a11y, WebMCP, Link response headers, ARD) and
  [#6](https://github.com/qte77/agent-readiness-kit/issues/6) (`api-catalog`
  category-placement mismatch), both surfaced by comparing ora.ai/isitagentready.com against
  `crosswalk.ts` — both are upstream-crosswalk calls, not local scope.
  **This plan absorbed the former `docs/handoffs/0001-scan-engine.md`; that file and the
  `docs/handoffs/` pattern are retired for this project — this Status section is the one
  onboarding surface from now on, per this estate's single-file-per-arc convention.**
- **2026-09-16 (row 2):** `src/scan/sources/discoverSnapshot.ts` — wraps the polyfetch-scrape
  `discover --json` CLI (env-borrow subprocess, directory configurable via
  `POLYFETCH_SCRAPE_DIR`/option, never hardcoded); owns `schema-type-breadth` scored from
  `json_ld_types` breadth, with `sitemaps`/`feeds`/`llms_txt` attached as auxiliary evidence for
  a future orchestrator cross-check against row 1's `agent-instruction` finding (no competing
  Finding emitted). `test/scan/sources/discoverSnapshot.test.ts` (10 new, 23 total passing).
- **2026-09-16 (row 1):** `src/scan/sources/wellKnown.ts` + `contentSignal.ts` — all 15 signal
  ids the row owns are implemented (see Source map below); `dns-aid` is always emitted as
  `"unknown"` with an explanatory note rather than graded, because research at implementation
  time found three competing, non-RFC individual IETF drafts with incompatible record formats
  (draft-mozleywilliams-dnsop-dnsaid/"DNS-AID" (SVCB-based), draft-nemethi-aid-agent-identity-
  discovery/"AID" (a `_agent.<domain>` TXT record), draft-ihsanullah-dnsid/"DNSid") and no
  settled/stable format to check against — per this row's explicit instruction to mark
  `"unknown"` rather than invent one. `test/scan/sources/wellKnown.test.ts` +
  `contentSignal.test.ts` (22 passing). Also added `@types/node` devDependency +
  `tsconfig.json`'s `"types": ["node"]` (needed for `fetch`/`URL`/`node:dns/promises` types;
  dev-only, doesn't affect the zero-runtime-dependency policy).
- **2026-09-16 (row 7):** `src/checkpoint.ts` (round-trips a `ScanRun` to/from
  `data/scans/<propertyId>.json`, `baseDir`-parameterized for test isolation) and
  `src/playbook.ts` (`remediationFor(finding)`: source-supplied `remediation` wins, then a
  pass short-circuit, then a per-signal template table keyed off `src/scan/crosswalk.ts`'s
  signal ids matched by substring against `finding.id`, then an honest generic fallback that
  never fabricates specificity). Remediation copy for all 18 crosswalk signals grounded in
  `agenthud-agui-a2ui/docs/agent-readiness.md`'s Crosswalk/Next-steps sections (read at
  source) plus issue #4's worked examples and verified specs (RFC 9727, RFC 9728, RFC 9421 +
  the web-bot-auth draft family, the AID DNS spec, Cloudflare's Content Signals policy, OpenID
  Connect Discovery); schemas the upstream doc itself flags "emerging" (`ai-catalog.json`,
  `agent-skills/index.json`, `mcp/server-card.json`) carry that caveat forward instead of
  being presented as settled. `test/checkpoint.test.ts` + `test/playbook.test.ts` add 17
  assertions (round-trip/overwrite/mkdir-recursive/rejects-on-missing for checkpoint;
  crosswalk-coverage + precedence + one-fixture-per-category with varied id delimiters for
  playbook) — 30/30 green. Added `@types/node` devDependency + `"types": ["node"]` in
  `tsconfig.json` (first module to import a `node:*` builtin; needed once, not per-row).

**What's next, in order** (full detail in the remaining-work table below; its "Depends on"
column is the source of truth for sequencing):

1. Rows 4, 5, 8, 12 have **no dependency on each other** — dispatch these in
   **parallel**, one subagent per row, **each in its own git worktree**
   (`Agent({isolation: "worktree", ...})`) so concurrent writes to different
   `src/scan/sources/*.ts` files never collide on the same working tree.
2. Row 3 (`oraAi.ts`) also has no row-dependency, but resolve its two open questions (API-key
   requirement, per-check vs. aggregate score data — see Watch-outs) as part of that row's work,
   not deferred after.
3. Row 6 (`orchestrator.ts`) — only after rows 1–5 land (fans them out).
4. Row 9 (`main.ts`) — only after rows 1–8 land (wires orchestrator → checkpoint → remediation).
5. Row 11 (`scan.yml`) — owner-gated (API secrets) — only after row 9.
6. Row 13 (first real scan run) — after rows 1–7, 9, and 11.

**The loop** (per source-module row): RED-first test in `test/scan/sources/*.test.ts` (fake
`fetch`/subprocess) → minimum implementation to pass → `npx vitest run` + `npx tsc --noEmit`
green → commit on a `feat/TOPIC` branch → PR → CI green → squash-merge → delete branch (remote +
local).

**Owner-gates (batch into one sitting):** Row 11 — owner must provision ora.ai / Cloudflare API
token secrets on the repo before the scheduled workflow can run green. Everything else in the
table is agent-gated and can proceed without an owner sitting.

**Commands:**

```bash
cd /workspaces/qte77/agent-readiness-kit
npm install
npx vitest run       # test suite
npx tsc --noEmit      # typecheck
```

**Watch-outs:**

- `env -u GH_TOKEN -u GITHUB_TOKEN` on **every** git/gh call (else 401/403, or "Resource not
  accessible by integration" against the wrong token).
- `-c commit.gpgsign=false` on commits — no GPG key in this environment.
- This sandbox blocks some Bash forms (pipes/heredocs/chained commands, `ls`/`find` in some
  configurations) — prefer `Read`/`Edit`/`Write` tools and single, simple `Bash` commands.
- **Verify an external repo's visibility (`gh api repos/<owner>/<name> -q '.visibility'`) before
  naming it in any issue/doc in this public repo.** Issues #3 and #4 originally named specific
  external repos/paths that didn't resolve publicly (qte77 has zero private repos, so they were
  either private-to-someone-else or gone); both were generalized on 2026-09-16.
- Row 3 (`oraAi.ts`) has two open questions to resolve before/while implementing: whether
  `POST /api/scan` requires an API key (decides if the row stays agent-gated or needs to move
  under row 11's secrets), and whether `GET /api/score/<url>` returns per-check results or only
  the aggregate score/grade (decides whether a Finding can compare against ora.ai per-signal, or
  only at the category level).
- No lint tooling is configured (`package.json` has `test`/`typecheck` scripts only) — decide
  once, not per-row, if/when a `worker/` CI job or stricter gating is added.
- The crosswalk table in `agenthud-agui-a2ui/docs/agent-readiness.md` has a few genuinely
  ambiguous bare signal ids (e.g. "robots.txt" spans both Discovery and Trust depending on
  whether presence or AI-crawler-policy *content* is being checked) — `src/scan/crosswalk.ts`
  deliberately omits those; disambiguate with a more specific signal id when the source module
  that needs it is written.

**Also see (standalone issues, intentionally not rows in the table below — they're proposals or
support material, not committed arc scope):**
[#3](https://github.com/qte77/agent-readiness-kit/issues/3) generalize `PROPERTIES` beyond the 3
hardcoded entries (deferred, doesn't block this arc),
[#4](https://github.com/qte77/agent-readiness-kit/issues/4) row-1 detector reference patterns,
[#5](https://github.com/qte77/agent-readiness-kit/issues/5) candidate crosswalk signal gaps,
[#6](https://github.com/qte77/agent-readiness-kit/issues/6) `api-catalog` category mismatch.

## Context

qte77 wants a standalone estate tool that periodically scans qte77's own hosted properties
(starting with `qte77.github.io`, `agenthud-agui-a2ui`, `sortmy.london`/`ldnmxx-hack`) for
"agent-native readiness" against six categories (Discovery / Content / Trust / Execution /
Agent-to-Agent / Identity & Auth) and produces concrete remediation, not just a score. This
generalizes work already done ad hoc for `qte77.github.io` + `agenthud-agui-a2ui` (see
`agenthud-agui-a2ui/docs/agent-readiness.md`, arc 017) into a reusable, scheduled tool.

## Locked decisions (verified at source; durable copy lives in `docs/architecture.md`)

Full rationale for each is in `docs/architecture.md` — summarized here, do not duplicate the
prose further; update `docs/architecture.md` first if a decision changes and this list will
drift out of sync until it's updated to match.

1. **Runtime: GitHub Actions only** — no Cloudflare Worker for the scan engine (needs a real
   OS subprocess for the `polyfetch-scrape` `discover()` env-borrow CLI call).
2. **State: one committed `data/scans/<propertyId>.json` per property**, overwritten each
   run — git history is the trend record, no KV/DB.
3. **Never import `polyfetch_scrape.contrib.easter_hunt`; never `uv add git+...`
   polyfetch-scrape.** Reimplement the `Finding` shape locally (`src/types.ts`, done this
   arc); only the CLI env-borrow pattern is used.
4. **Crosswalk lives in `agenthud-agui-a2ui/docs/agent-readiness.md`** — this repo links to
   it and encodes it as a lookup (`src/scan/crosswalk.ts`, done this arc), never forks the
   table.
5. **ora.ai two-phase scoring + Cloudflare URL Scanner's async result both resolve via a
   plain synchronous `await`/poll** inside the one GHA job — no persisted pending-state.
6. **Dedup-safe issue creation**: search by a fixed title marker before creating; update the
   existing issue's body + a changelog comment, never silent stale reuse. Mirrors (and
   improves on) `2026-08-26-AgentNativeHack-FT-CF-SF/src/execute.ts:37-55`'s
   `findOpenIdleDiscoveryIssue`.
7. **PR-generation is OUT of v1 scope** — checklist output only, no auto-PRs to remediation
   repos.
8. **Zero runtime dependencies** — native `fetch` only.
9. **A separate thin, stateless, read-only Cloudflare Worker in `worker/`** exposes computed
   results over MCP (`createMcpHandler`, no Durable Object), mirroring
   `agenthud-agui-a2ui/worker/`'s pattern exactly (`GET /.well-known/agent-card.json`,
   `POST /mcp` with `get_latest_score`/`get_playbook`/`list_properties`, each just
   `fetch()`-ing `data/scans/<id>.json` off `raw.githubusercontent.com` — no scanning logic
   in the Worker).

## Repo structure (target — not all present yet, see remaining-work table)

```
agent-readiness-kit/
  package.json  tsconfig.json
  AGENTS.md  CLAUDE.md
  .github/CONTRIBUTING.md
  .github/workflows/{ci.yml, tag-release.yaml, publish-release.yaml, scan.yml}
  docs/plans/0001-scan-engine.md  docs/architecture.md
  config/properties.ts
  src/{main.ts, types.ts, checkpoint.ts, playbook.ts, mcpClient.ts}
  src/scan/{orchestrator.ts, crosswalk.ts}
  src/scan/sources/{cloudflareMcp.ts, cloudflareUrlScanner.ts, oraAi.ts, wellKnown.ts, contentSignal.ts, mcpA2aProbe.ts, discoverSnapshot.ts}
  src/remediation/{github.ts, issue.ts}
  test/  (mirrors src/, plain vitest)
  worker/{wrangler.jsonc, package.json, src/index.ts, src/mcp/tools.ts, src/wellknown/agent-card.ts, test/}
  data/scans/{qte77-github-io,agenthud-agui-a2ui,sortmy-london}.json
```

## Source map (what exists now — next session should not need to re-map)

- `src/types.ts` — `Category` (6-value union) + `CATEGORIES` const array; `SourceId` (7-value
  union, one per planned `src/scan/sources/*.ts` module); `Status`
  (`"pass"|"fail"|"warn"|"unknown"`); `Finding` interface (`id`, `category`, `source`,
  `status`, `summary`, `remediation?`, `evidence?`); `ScanRun` interface (`propertyId`,
  `url`, `scannedAt`, `findings[]`, `score?`, `grade?`) — the exact shape persisted to
  `data/scans/<propertyId>.json`.
- `src/scan/crosswalk.ts` — `SIGNAL_TO_CATEGORY` lookup + `assignCategory(signal): Category`
  (throws on unregistered signal), seeded from the real crosswalk table in
  `agenthud-agui-a2ui/docs/agent-readiness.md` lines 134-141 (read at source this arc, not
  invented — see that file's "Crosswalk" section for the ora.ai/Cloudflare signal names).
- `config/properties.ts` — `PropertyConfig` interface + `PROPERTIES` const array with the 3
  target properties (`qte77-github-io`, `agenthud-agui-a2ui`, `sortmy-london`).
- `test/types.test.ts` — RED-first TDD: `Finding`/`ScanRun` construction assertions +
  `assignCategory` parameterized over all 6 categories' real signal ids + an
  unknown-signal-throws case. 13 assertions, all green (`npx vitest run`); `npx tsc --noEmit`
  clean.
- `docs/architecture.md` — durable copy of the 9 locked decisions above, with full rationale
  (this plan only summarizes; architecture.md is the source of truth if they diverge).
- `.github/workflows/ci.yml` — single `check` job: checkout (SHA-pinned) → `actions/setup-node`
  (Node 22, npm cache) → `npm ci` → `npm run typecheck` → `npm test`. Triggers on push to
  `main`, PRs, and `workflow_dispatch`. No `lint` step (no linter configured — see Watch-outs);
  no separate `worker` job yet (`worker/` doesn't exist yet — add one mirroring this job,
  `working-directory: worker`, when row 12 lands, per `agenthud-agui-a2ui/.github/workflows/ci.yml`'s
  pattern).
- `.github/workflows/tag-release.yaml` / `publish-release.yaml` — dormant until a version is
  actually cut; adapted from `agenthud-agui-a2ui`'s pattern for this repo's root `package.json`
  (no `ui/` subdir here). See `.github/CONTRIBUTING.md`'s Releasing section for the recipe.
- `AGENTS.md` / `CLAUDE.md` (pointer) / `.github/CONTRIBUTING.md` — behavioral rules, dev
  commands, branch/PR/commit conventions; modeled on `agenthud-agui-a2ui`'s shape.
- `src/scan/sources/wellKnown.ts` — `scanWellKnown(url)`; owns `agent-instruction`,
  `ai-catalog`, `agent-skills-index`, `api-catalog`, `auth-md`, `oauth-protected-resource`,
  `oauth-oidc-discovery`, `openapi-spec`, `dev-resource-discovery` (all resolved against the
  URL's origin, per RFC 8615 / the "at site root" convention) and `dns-aid` (a best-effort
  `node:dns/promises` `resolveTxt` probe against `_agent.<hostname>`, always reported
  `"unknown"` — see the module's docstring for why). Internal `evaluateTextPresence` /
  `evaluateJsonPresence` helpers classify each fetch as pass/fail/warn/unknown.
- `src/scan/sources/contentSignal.ts` — `scanContentSignal(url)`; owns `content-signal` +
  `bot-rules` (one shared `/robots.txt` fetch, resolved against origin), `web-bot-auth`
  (`/.well-known/http-message-signatures-directory`, origin-resolved), and `markdown-twins` +
  `markdown-negotiation` (evaluated against the given page URL itself, not the origin, since
  a page's markdown twin is a per-page concern).
- `test/scan/sources/wellKnown.test.ts` + `contentSignal.test.ts` — RED-first, fake `fetch`
  (route-by-URL mock) and mocked `node:dns/promises`; 22 assertions covering pass/fail/warn/
  unknown per signal family plus a crosswalk-category-mapping check, all green.

## Tests (strict RED-first; modules only)

- `test/types.test.ts` — done this arc, see Source map above.
- Every future `src/scan/sources/*.ts` module ships with its own `test/scan/sources/*.test.ts`
  written RED-first (fake `fetch`/subprocess, real parsing logic asserted).
- `src/scan/orchestrator.ts` and `src/remediation/issue.ts` are the two other modules with
  real logic worth unit-testing (fan-out/aggregation; dedup search-then-update-or-create).
  Everything else (CLI wiring in `main.ts`, the GHA workflow YAML, `worker/wrangler.jsonc`)
  is config/wiring — verify those by effect (`wrangler dev` + curl, a workflow run), not a
  unit test, per this estate's TDD convention.

## Remaining-work table (SINGLE source of open work)

| # | Item | Gate | Depends on | Done-when |
|---|------|------|------------|-----------|
| ~~1~~ | ~~`src/scan/sources/wellKnown.ts` + `contentSignal.ts` (robots.txt / `.well-known/*` / Content-Signal fetch)~~ | agent | — | **shipped 2026-09-16** |
| ~~2~~ | ~~`src/scan/sources/discoverSnapshot.ts` (polyfetch-scrape CLI env-borrow subprocess: `uv run --directory polyfetch-scrape polyfetch discover <url> --json`)~~ | agent | — | **shipped 2026-09-16** |
| 3 | `src/scan/sources/oraAi.ts` (two-phase `POST /api/scan` then `GET /api/score/<url>` ~45s later) | agent | — | await/poll implemented per architecture.md, unit test with mocked `fetch`; API-key and per-check-data questions (Watch-outs) resolved |
| 4 | `src/scan/sources/cloudflareUrlScanner.ts` (async result poll) | agent | — | same poll pattern, unit test with mocked `fetch` |
| 5 | `src/scan/sources/cloudflareMcp.ts` + `mcpA2aProbe.ts` (agent-card.json / mcp server-card / A2A probes) | agent | — | probes presence + shape, `Finding[]` per signal |
| 6 | `src/scan/orchestrator.ts` (runs all sources for one property, assembles a `ScanRun`) | agent | 1, 2, 3, 4, 5 | orchestrator test with fake sources produces a valid `ScanRun` |
| ~~7~~ | ~~`src/checkpoint.ts` (read/write `data/scans/<id>.json`) + `src/playbook.ts` (remediation text per Finding)~~ | agent | — | **shipped 2026-09-16** |
| 8 | `src/remediation/issue.ts` (dedup-safe issue create/update per architecture.md's dedup section) + `src/remediation/github.ts` | agent | — | dedup test: existing-issue-found -> update-body-+-changelog-comment path; not-found -> create path |
| 9 | `src/main.ts` (CLI entrypoint: orchestrator -> checkpoint -> remediation, over all of `PROPERTIES`) | agent | 1–8 | `node dist/main.js` runs end-to-end against one property locally |
| ~~10~~ | ~~`.github/workflows/ci.yml` (typecheck + test on PR)~~ | agent | — | **shipped 2026-09-16** |
| 11 | `.github/workflows/scan.yml` (scheduled scan job) | owner | 9 | owner provisions ora.ai / Cloudflare API token secrets; workflow runs green on schedule |
| 12 | `worker/` MCP layer (`wrangler.jsonc`, `src/index.ts`, `src/mcp/tools.ts`, `src/wellknown/agent-card.ts`, tests) mirroring `agenthud-agui-a2ui/worker/` | agent | — | `get_latest_score`/`get_playbook`/`list_properties` verified live via `wrangler dev` + curl |
| 13 | First real scan run seeding `data/scans/{qte77-github-io,agenthud-agui-a2ui,sortmy-london}.json` | agent | 1–7, 9, 11 | 3 files committed with real findings, not placeholders |

## Verification (this arc's commits)

- `cd agent-readiness-kit && npm install && npx vitest run` → all green (13/13 as of the
  scaffold commit; grows as each row lands).
- `npx tsc --noEmit` → clean.
- `.github/workflows/ci.yml` runs both on every push/PR from 2026-09-16 onward — treat a red CI
  run as blocking, not advisory.

## At arc close

Tick the remaining-work table against what merged, update this Status section, note any
deviations from the locked decisions, and migrate any still-open rows to the next `NNNN` pair.
