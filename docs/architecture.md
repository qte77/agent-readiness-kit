---
title: Architecture
description: Locked architecture decisions for agent-readiness-kit — runtime, state, scoring, dedup, scope boundary, dependency policy, and the read-only MCP worker.
date: 2026-09-01
status: living
---

# Architecture

This is the durable reference for how the tool is put together. Decisions here were verified
at source before being locked (see `docs/plans/0001-scan-engine.md` for the arc that
established them); treat this file as evergreen and update it only on a real topology change,
not per-scan-result.

## Runtime

**GitHub Actions only — no Cloudflare Worker for the scan engine itself.** The scan needs a
real OS subprocess for the `polyfetch-scrape` `discover()` env-borrow call
(`uv run --directory polyfetch-scrape polyfetch discover <url> --json`). A Cloudflare Worker
has no `child_process` and no filesystem, so it cannot run this. GHA's Ubuntu runner can.

## State / trend history

One committed JSON file per property: `data/scans/<propertyId>.json`, overwritten each run.
Git history *is* the trend record — no KV store, no database, no separate history file.

## polyfetch-scrape dependency policy

- **Never** import `polyfetch_scrape.contrib.easter_hunt` — its own docs mark it "optional,
  unsupported", and it's Python where this repo is TypeScript. Reimplement the `Finding`
  shape locally instead (see `src/types.ts`).
- **Never** `uv add git+...` polyfetch-scrape — this poisons the lockfile with heavy deps per
  its own `USING.md`. Only the CLI env-borrow pattern (`uv run --directory polyfetch-scrape
  polyfetch discover <url> --json`) is used, invoked as a subprocess from the GHA job.
- The polyfetch-scrape checkout's directory is never hardcoded: `src/scan/sources/discoverSnapshot.ts`
  takes it as a `polyfetchScrapeDir` option, falling back to the `POLYFETCH_SCRAPE_DIR` env var.
  Whichever job invokes it (a GHA workflow, a local run) must set one of the two.

## Category crosswalk

The six-category crosswalk (Discovery / Content / Trust / Execution / Agent-to-Agent /
Identity & Auth, mapped to ora.ai signals and Cloudflare `isitagentready.com` signals) is
owned by `agenthud-agui-a2ui/docs/agent-readiness.md` — link to it, never fork/duplicate the
table. `src/scan/crosswalk.ts` encodes it as a lookup (`assignCategory(signal)`) for scan
sources to call; if the upstream table changes, update the lookup to match.

## Async scoring sources

Both ora.ai's two-phase scoring (`POST /api/scan` echoes a stale cached score; `GET
/api/score/<url>` ~45s later has the fresh one) and Cloudflare URL Scanner's async result
resolve via a plain synchronous `await`/poll inside the one GHA job. No persisted
pending-state is needed — GHA jobs have no Worker-style CPU-time limit, unlike a Worker.

## Dedup-safe issue creation

Before creating a remediation issue, search by a fixed title marker (mirroring, and
improving on, `2026-08-26-AgentNativeHack-FT-CF-SF/src/execute.ts:37-55`'s
`findOpenIdleDiscoveryIssue` pattern). If found, update the existing issue's body in place
plus a changelog comment — never silently reuse a stale issue. This is the exact pattern
that prevented (and, when absent elsewhere in this estate, caused) a 35-duplicate-issue bug
class; do not skip the dedup check when implementing `src/remediation/issue.ts`.

## Scope boundary (v1)

PR-generation (auto-writing missing `.well-known/*` files to remediation repos) is
explicitly **out of scope for v1**. The tool produces a checklist, not auto-PRs. Revisit only
as a deliberate, separately-scoped follow-on arc.

## Dependency policy (runtime)

Zero runtime dependencies. Native `fetch` only — no HTTP client library, no JSON-schema
validator at runtime. Dev dependencies (TypeScript, vitest) are fine; they don't ship.

## Read-only MCP worker

A separate thin, stateless, read-only Cloudflare Worker in `worker/` exposes the
already-computed scan results over MCP, using `createMcpHandler` (**not** the deprecated
`McpAgent` — no Durable Object needed), mirroring `agenthud-agui-a2ui/worker/`'s exact
pattern:

- `GET /.well-known/agent-card.json`
- `POST /mcp` with tools `get_latest_score`, `get_playbook`, `list_properties`

Each tool just `fetch()`s the committed `data/scans/<id>.json` off
`raw.githubusercontent.com` — there is no scanning logic inside this Worker at all. Built,
unit-tested, and verified live via `wrangler dev` (2026-09-16). It has its own
`package.json`/lockfile/`tsconfig.json`, exempt from this repo's zero-runtime-dependency
policy (that policy governs the scan engine, not this subproject). **Deliberately not
deployed to a live Cloudflare URL** — owner decision; no `wrangler deploy`, no Cloudflare
account/token provisioned. Don't assume it's reachable at a real URL.
