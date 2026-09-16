# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Changed

- `docs/plans/0001-scan-engine.md`: restructured with a `## Status` opening section (what
  shipped, what's next, the loop, owner-gates, commands, watch-outs) and a `Depends on` column
  on the remaining-work table identifying which rows are parallel-worktree-safe
- `.gitignore`: added `MEMORY.md` (a Claude Code meta-artifact, not project content)

### Removed

- `docs/handoffs/0001-scan-engine.md` and the `docs/handoffs/` pattern — this project keeps one
  file per arc; onboarding content now lives in the plan's own `## Status` section
