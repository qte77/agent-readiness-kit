# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `.github/workflows/scan.yml` (plan row 11): weekly-cron + `workflow_dispatch` scheduled
  scan job — checks out `qte77/polyfetch-scrape` and installs `uv` so `discoverSnapshot.ts`
  has something to call, builds, runs `npm run scan`, and commits any changed
  `data/scans/*.json` via a branch + PR + auto-merge (see Fixed below — a direct push doesn't
  clear the repo's ruleset). No new API secrets required (both ora.ai and isitagentready.com
  are key-less); `GITHUB_TOKEN` is wired via `env:`/`permissions:` only
- `src/main.ts` (plan row 9): CLI entrypoint — for every property in
  `config/properties.ts`'s `PROPERTIES`, runs the row-6 orchestrator, writes the resulting
  `ScanRun` to `data/scans/<propertyId>.json`, then files/updates a dedup-safe remediation
  issue against this repo (`{owner: "qte77", repo: "agent-readiness-kit"}`); per-property
  console output (score/grade, finding counts by status, checkpoint path, issue action); a
  missing `GITHUB_TOKEN` (or any other issue-upsert failure) logs a clear warning and moves
  on to the next property instead of crashing the run — an accepted local-run gap, not a
  bug. Added an `npm run scan` alias (`node dist/src/main.js`) and documented it in
  README.md/`.github/CONTRIBUTING.md`'s Development sections. Config/wiring — verified by
  effect: a real `npm run build && node dist/src/main.js` run against all 3 real
  `PROPERTIES` and real external APIs completed for every property, produced real ora.ai
  scores/grades and 27 findings per property across all 7 sources, and wrote real,
  non-placeholder `data/scans/*.json` content (not committed — seeding that data for real is
  row 13's job).
- `src/scan/orchestrator.ts` (plan row 6): `scanProperty(property): Promise<ScanRun>` runs
  all 7 `src/scan/sources/*.ts` modules concurrently (`Promise.all`) for one property,
  concatenates every source's `Finding[]` into `ScanRun.findings` with no cross-source dedup
  (`Finding.id` is already unique per source — see the plan's Design decision 3), and
  special-cases `scanOraAi`'s `{findings, score?, grade?}` return shape by also assigning its
  `score`/`grade` onto the assembled `ScanRun` (Design decision 1). Sets `propertyId`/`url`
  from the property config and `scannedAt` from `new Date().toISOString()`.
  `test/scan/orchestrator.test.ts` (8 new, 136 total passing), RED-first, all 7 sources
  mocked via `vi.mock` — no real network in this test.
- `src/scan/sources/isitAgentReady.ts`: row 4 of the plan — a single unauthenticated call to
  `POST https://isitagentready.com/api/scan` (`{ url }`, synchronous, no submit-then-poll,
  no API key/account/auth of any kind), superseding the originally-planned Cloudflare URL
  Scanner API before any code existed for it; emits exactly one `Trust`-category Finding
  (`isitAgentReady.agent-readiness-scan`) with status derived from the response's overall
  `level` (0-5: `pass` at 4-5, `warn` at 2-3, `fail` at 0-1) and the full `checks`/`level`/
  `levelName`/`scannedAt` response attached as evidence verbatim, without fanning the
  camelCase sub-checks out into per-signal Findings (see the plan's Design decision 2);
  returns a single `"unknown"`-status Finding on any network/parse failure, never throws.
  Also renames `src/types.ts`'s `SourceId` union member `"cloudflareUrlScanner"` to
  `"isitAgentReady"` (a free rename — nothing referenced the old literal yet).
  RED-first test suite (`test/scan/sources/isitAgentReady.test.ts`, 16 new assertions,
  111 total passing)
- `src/scan/sources/oraAi.ts` (plan row 3): two-phase `POST https://ora.ai/api/scan` then
  `GET https://ora.ai/api/score/<url>` scan source — the only source returning
  `{findings, score?, grade?}` instead of a bare `Finding[]`, since ora.ai is the sole
  producer of `ScanRun`-level score/grade. Registered check ids (7 of ora.ai's ~124 checks
  overlap the crosswalk) resolve via `assignCategory`; unregistered ids are silently
  skipped. ora.ai's live-verified `status` vocabulary (`pass`/`fail`/`warning`/`na`/`error`)
  maps onto this repo's `Status` union, with `na`/`error` treated as `unknown` rather than a
  guessed grade. A single injectable `sleep(settleDelayMs)` (default 45000ms) between the
  two calls matches architecture.md's observed "~45s" freshness window. Never throws: a 429
  or any other fetch/parse failure on either call collapses to one `unknown`-status Finding
  carrying `Retry-After` in evidence. Optional `oraAiApiKey` sent only as
  `Authorization: Bearer <key>`, never required. `test/scan/sources/oraAi.test.ts` (17 new,
  112 total passing), using a trimmed real response captured live against
  `https://qte77.github.io` as its main fixture
- `src/checkpoint.ts`: read/write `data/scans/<propertyId>.json`, round-tripping a `ScanRun`
  verbatim (`baseDir`-parameterized so tests never touch the real `data/scans/` directory)
- `src/playbook.ts`: `remediationFor(finding)` maps any `Finding` to concrete remediation text
  — source-supplied `remediation` wins, then a pass short-circuit, then a per-signal template
  table covering all 18 `src/scan/crosswalk.ts` signal ids (grounded in
  `agenthud-agui-a2ui/docs/agent-readiness.md` and verified specs: RFC 9727, RFC 9728, RFC
  9421 + web-bot-auth, DNS-AID, Cloudflare Content Signals, OIDC Discovery), then an honest
  generic fallback for unmatched ids
- `test/checkpoint.test.ts`, `test/playbook.test.ts`: RED-first TDD, 17 new assertions
  (30/30 total)
- `@types/node` devDependency + `"types": ["node"]` in `tsconfig.json`, needed once any module
  imports a `node:*` builtin
- `src/types.ts`, `src/scan/crosswalk.ts`: core domain types (`Finding`/`ScanRun`/`Category`/
  `Status`/`SourceId`) and the six-category crosswalk seeded from
  `agenthud-agui-a2ui/docs/agent-readiness.md`, plus `config/properties.ts` for the 3 target
  properties (`qte77.github.io`, `agenthud-agui-a2ui`, `sortmy.london`/`ldnmxx-hack`) — one
  passing TDD test suite (`test/types.test.ts`)
- `docs/architecture.md`: durable reference for the locked architecture decisions — GHA-only
  runtime, one committed JSON file per property as the trend record, the polyfetch-scrape
  dependency policy, dedup-safe remediation issue creation, the v1 scope boundary, and the
  read-only MCP worker design
- `docs/plans/0001-scan-engine.md`: the arc's plan, carrying the remaining-work table for scan
  sources, the GHA workflow, and the `worker/` MCP layer
- `README.md`: project overview, status, and development commands
- `.github/workflows/ci.yml`: row 10 of the plan — typecheck + test on every push to `main`,
  every PR, and manual dispatch
- `.github/workflows/tag-release.yaml` + `publish-release.yaml`: dormant bump→tag→release
  automation, adapted from `agenthud-agui-a2ui`'s pattern for this repo's root `package.json`
- `AGENTS.md`, `CLAUDE.md` (pointer to `AGENTS.md`), `.github/CONTRIBUTING.md`: behavioral
  rules, dev commands, and contributor workflow, modeled on `agenthud-agui-a2ui`'s conventions
- `src/scan/sources/discoverSnapshot.ts`: row 2 of the plan — polyfetch-scrape CLI env-borrow
  subprocess wrapper (`uv run --directory <dir> polyfetch discover <url> --json`, directory
  configurable via `POLYFETCH_SCRAPE_DIR`/option, never hardcoded); owns the `schema-type-breadth`
  Content signal scored from `json_ld_types` breadth, with `sitemaps`/`feeds`/`llms_txt` attached
  as auxiliary evidence for a future orchestrator cross-check — RED-first test suite
  (`test/scan/sources/discoverSnapshot.test.ts`)
- `src/scan/sources/wellKnown.ts` + `contentSignal.ts` (plan row 1): well-known-URI and
  robots.txt/content-negotiation scan sources covering all 15 signal ids the row owns
  (`agent-instruction`, `ai-catalog`, `agent-skills-index`, `api-catalog`, `auth-md`,
  `oauth-protected-resource`, `oauth-oidc-discovery`, `openapi-spec`,
  `dev-resource-discovery`, `dns-aid`, `content-signal`, `bot-rules`, `web-bot-auth`,
  `markdown-twins`, `markdown-negotiation`); `dns-aid` is always reported `"unknown"` with an
  explanatory note (no settled DNS agent-identity record format exists yet — see the module
  docstring); `test/scan/sources/wellKnown.test.ts` + `contentSignal.test.ts` (22 passing,
  RED-first, fake `fetch`/`node:dns/promises`)
- `src/remediation/github.ts`, `src/remediation/issue.ts`: row 8 of the plan — a minimal,
  zero-dependency GitHub REST client (native `fetch`, `process.env.GITHUB_TOKEN`) and the
  dedup-safe remediation-issue create/update logic it backs: search open issues by a fixed
  per-property title marker first, update the existing issue's body plus a changelog comment
  when found, create a new issue only when not found — never a silent duplicate or a stale
  reuse (see `docs/architecture.md`'s "Dedup-safe issue creation") — with unit tests covering
  both the found and not-found paths (`test/remediation/github.test.ts`,
  `test/remediation/issue.test.ts`)
- `src/scan/sources/cloudflareMcp.ts` + `mcpA2aProbe.ts`: row 5 of the plan — static
  presence/shape checks for `/.well-known/mcp/server-card.json` (`mcp-server-card` signal) and
  `/.well-known/agent-card.json` (`a2a-agent-card` signal), plus a live JSON-RPC 2.0
  `message/send` protocol probe against the agent card's declared endpoint that can upgrade or
  downgrade the static verdict — RED-first tests with a faked `fetch`, zero runtime dependencies
- `worker/` (row 12): a separate, thin, stateless, read-only Cloudflare Worker exposing scan
  results over MCP — `GET /.well-known/agent-card.json` and `POST /mcp` (via
  `@modelcontextprotocol/server`'s `createMcpHandler`, no Durable Object) with
  `get_latest_score`/`get_playbook`/`list_properties` tools, each reading
  `data/scans/<id>.json` off `raw.githubusercontent.com` and degrading gracefully to a
  `no-scan-data` response when the file doesn't exist yet; mirrors
  `agenthud-agui-a2ui/worker/`'s pattern; own `package.json`/lockfile/tsconfig (the "zero
  runtime dependencies" rule applies to the scan engine, not this subproject); 13 passing
  tests (`worker/test/`); verified live with `wrangler dev` against the real
  `raw.githubusercontent.com`. Also extends `.github/workflows/ci.yml` with a `worker` job.
- `vitest.config.ts` (root): excludes `worker/**` from the root test run — without it, `vitest
  run` at the repo root auto-discovers `worker/test/*.test.ts` too (found while adding
  `worker/`), which would break the root CI job since it never `npm ci`s inside `worker/`
- `worker/vitest.config.ts`: an explicit (even empty) config so Vitest's upward config search
  stops at `worker/` instead of picking up the root's `vitest.config.ts` — found via a red CI
  run on PR #14 (the worker job's `npm ci` never installs the root's `node_modules`, so
  resolving `vitest/config` from the root config failed there)

### Changed

- `docs/plans/0001-scan-engine.md`: row 13 is now **owner-gated, not agent-gated** — the
  first real `scan.yml` run succeeded end-to-end (real ora.ai/isitagentready.com scores for
  all 3 properties) and opened PR #27 with auto-merge armed, but the active ruleset's
  `require_extra_approval_for_unattributed_changes` requires a human "Approve" click on
  bot-authored PRs regardless of passing checks or `--admin`/`--auto` — this recurs on every
  future scheduled run, not just this one. PR #27 is left open, unmerged, for the repo owner.

### Fixed

- `.github/workflows/scan.yml`: the "Commit scan results" step pushed directly to `main`,
  which a repository ruleset (added 2026-09-16, discovered via a live failed
  `workflow_dispatch` run on 2026-09-17) rejects outright (`GH013`: PR-only changes, a
  required `CodeFactor` status check, verified commit signatures — no bypass actors). Rewrote
  the step to branch, push, open a PR, and merge it (`gh pr merge --squash --auto
  --delete-branch`) instead; added `pull-requests: write` to the job's `permissions` and
  enabled `allow_auto_merge` on the repo
- `vitest.config.ts`: excludes `dist/**` (vitest v4's own `configDefaults.exclude` is just
  `node_modules`/`.git`, not `dist`). Found while verifying row 9's `npm run build && node
  dist/src/main.js`: this repo's `tsconfig.json` also compiles `test/**/*.ts` (needed for
  `tsc --noEmit` to typecheck the test suite), so a local `npm run build` left compiled test
  files at `dist/test/**/*.test.js` that a subsequent `npx vitest run` silently
  double-discovered and double-ran (136 tests became 272). Never surfaced in CI (the `check`
  job never runs `npm run build` before `npm test`), but pollutes any local run after a build.

### Changed

- `docs/plans/0001-scan-engine.md`: added `## External API contracts` and `## Design
  decisions` (rows 3/4/6) so rows 3 and 4 can dispatch in parallel again; resolved both of row
  3's prior open questions (ora.ai needs no API key; per-check data is available, 7 of 18
  crosswalk signals overlap exactly); pivoted row 4 off the originally-planned Cloudflare URL
  Scanner API onto isitagentready.com's own `POST /api/scan` (plain, unauthenticated,
  synchronous — live-verified against a real property), which drops row 11's Cloudflare
  secrets requirement entirely and makes rows 1–9 runnable end-to-end with zero secrets
  configured anywhere
- `docs/architecture.md`: worker section updated to reflect it's built/verified (was "not
  built yet"), plus the not-deployed decision and the `POLYFETCH_SCRAPE_DIR` env var
- `README.md`, `.github/CONTRIBUTING.md`: document `worker/`'s separate dev commands and
  `POLYFETCH_SCRAPE_DIR`, now that both exist
- `docs/plans/0001-scan-engine.md`: added a Watch-out recording the owner decision that
  `worker/` is not deployed to a live Cloudflare URL (no `wrangler deploy`) — built and
  verified locally only
- `docs/plans/0001-scan-engine.md`: restructured with a `## Status` opening section (what
  shipped, what's next, the loop, owner-gates, commands, watch-outs) and a `Depends on` column
  on the remaining-work table identifying which rows are parallel-worktree-safe
- `.gitignore`: added `MEMORY.md` (a Claude Code meta-artifact, not project content)
- `tsconfig.json`: added `"types": ["node"]` and `@types/node` devDependency so `fetch`, `URL`,
  `Response`/`Headers`/`RequestInit`, and `node:dns/promises` typecheck — needed by the first
  scan source modules (plan row 1); dev-only, no runtime dependency added
  (`docs/architecture.md`'s zero-runtime-dependency policy still holds)

### Removed

- `docs/handoffs/0001-scan-engine.md` and the `docs/handoffs/` pattern — this project keeps one
  file per arc; onboarding content now lives in the plan's own `## Status` section
