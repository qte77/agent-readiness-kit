# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Changed

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
