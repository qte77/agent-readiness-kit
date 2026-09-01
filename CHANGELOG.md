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
- `docs/plans/0001-scan-engine.md` + `docs/handoffs/0001-scan-engine.md`: the arc's plan and
  handoff, carrying the remaining-work table for scan sources, the GHA workflow, and the
  `worker/` MCP layer
- `README.md`: project overview, status, and development commands
