---
title: Agent-Readiness Kit — scan engine + MCP worker scaffold
description: Build the estate's agent-native-readiness scanner — a GHA-only scan engine over 3 qte77 properties, one committed JSON per property as the trend record, dedup-safe remediation issues, and a read-only MCP worker exposing results. This arc ships the repo scaffold, core types, and the category crosswalk.
date: 2026-09-01
status: open
issues: [1]
predecessor: null
handoff: docs/handoffs/0001-scan-engine.md
---

# Arc 0001 — Scan Engine + MCP Worker Scaffold

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
  docs/plans/0001-scan-engine.md  docs/handoffs/0001-scan-engine.md  docs/architecture.md
  config/properties.ts
  src/{main.ts, types.ts, checkpoint.ts, playbook.ts, mcpClient.ts}
  src/scan/{orchestrator.ts, crosswalk.ts}
  src/scan/sources/{cloudflareMcp.ts, cloudflareUrlScanner.ts, oraAi.ts, wellKnown.ts, contentSignal.ts, mcpA2aProbe.ts, discoverSnapshot.ts}
  src/remediation/{github.ts, issue.ts}
  test/  (mirrors src/, plain vitest)
  worker/{wrangler.jsonc, package.json, src/index.ts, src/mcp/tools.ts, src/wellknown/agent-card.ts, test/}
  .github/workflows/{ci.yml, scan.yml}
  data/scans/{qte77-github-io,agenthud-agui-a2ui,sortmy-london}.json
```

## Source map (what exists after this arc's first commit — next session should not need to re-map)

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

## Tests (strict RED-first; modules only)

- `test/types.test.ts` — done this arc, see Source map above.
- Every future `src/scan/sources/*.ts` module ships with its own `test/scan/sources/*.test.ts`
  written RED-first (fake `fetch`/subprocess, real parsing logic asserted).
- `src/scan/orchestrator.ts` and `src/remediation/issue.ts` are the two other modules with
  real logic worth unit-testing (fan-out/aggregation; dedup search-then-update-or-create).
  Everything else (CLI wiring in `main.ts`, the GHA workflow YAML, `worker/wrangler.jsonc`)
  is config/wiring — verify those by effect (`wrangler dev` + curl, a workflow run), not a
  unit test, per this estate's TDD convention.

## Shipped (this arc, commit 1)

Repo created (public), tracking Issue #1 opened, scaffold committed to `main`: `package.json`
(zero runtime deps, `vitest`+`typescript` dev deps), `tsconfig.json` (strict, NodeNext),
`.gitignore`, `src/types.ts`, `src/scan/crosswalk.ts`, `config/properties.ts`,
`test/types.test.ts` (13 passing tests), `docs/architecture.md`, this plan, and its paired
handoff.

## Remaining-work table (SINGLE source of open work)

| # | Item | Gate | Done-when |
|---|------|------|-----------|
| 1 | `src/scan/sources/wellKnown.ts` + `contentSignal.ts` (robots.txt / `.well-known/*` / Content-Signal fetch) | agent | typed source module, RED-first test, returns `Finding[]` |
| 2 | `src/scan/sources/discoverSnapshot.ts` (polyfetch-scrape CLI env-borrow subprocess: `uv run --directory polyfetch-scrape polyfetch discover <url> --json`) | agent | subprocess wrapped, parses `discover --json` output into `Finding[]`, never imports `easter_hunt` |
| 3 | `src/scan/sources/oraAi.ts` (two-phase `POST /api/scan` then `GET /api/score/<url>` ~45s later) | agent | await/poll implemented per architecture.md, unit test with mocked `fetch` |
| 4 | `src/scan/sources/cloudflareUrlScanner.ts` (async result poll) | agent | same poll pattern, unit test with mocked `fetch` |
| 5 | `src/scan/sources/cloudflareMcp.ts` + `mcpA2aProbe.ts` (agent-card.json / mcp server-card / A2A probes) | agent | probes presence + shape, `Finding[]` per signal |
| 6 | `src/scan/orchestrator.ts` (runs all sources for one property, assembles a `ScanRun`) | agent | orchestrator test with fake sources produces a valid `ScanRun` |
| 7 | `src/checkpoint.ts` (read/write `data/scans/<id>.json`) + `src/playbook.ts` (remediation text per Finding) | agent | round-trips a `ScanRun` to/from `data/scans/*.json` |
| 8 | `src/remediation/issue.ts` (dedup-safe issue create/update per architecture.md's dedup section) + `src/remediation/github.ts` | agent | dedup test: existing-issue-found -> update-body-+-changelog-comment path; not-found -> create path |
| 9 | `src/main.ts` (CLI entrypoint: orchestrator -> checkpoint -> remediation, over all of `PROPERTIES`) | agent | `node dist/main.js` runs end-to-end against one property locally |
| 10 | `.github/workflows/ci.yml` (typecheck + test on PR) | agent | green on the PR that adds it |
| 11 | `.github/workflows/scan.yml` (scheduled scan job) | owner | owner provisions ora.ai / Cloudflare API token secrets; workflow runs green on schedule |
| 12 | `worker/` MCP layer (`wrangler.jsonc`, `src/index.ts`, `src/mcp/tools.ts`, `src/wellknown/agent-card.ts`, tests) mirroring `agenthud-agui-a2ui/worker/` | agent | `get_latest_score`/`get_playbook`/`list_properties` verified live via `wrangler dev` + curl |
| 13 | First real scan run seeding `data/scans/{qte77-github-io,agenthud-agui-a2ui,sortmy-london}.json` | agent | 3 files committed with real findings, not placeholders (depends on 1-7) |

## Verification (this arc's commit)

- `cd agent-readiness-kit && npm install && npx vitest run` → all green (13/13).
- `npx tsc --noEmit` → clean.
- **Gotchas:** `env -u GH_TOKEN -u GITHUB_TOKEN` on every git/gh call; `-c
  commit.gpgsign=false` on commits (no GPG key in this environment); this repo is brand new
  with no collaborators/CI to disrupt, so the first scaffold commit went direct to `main` —
  every commit after this one should branch + PR per this estate's normal convention once CI
  exists (row 10 above).
