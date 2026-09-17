# AGENTS.md

Working agreement for AI agents in `agent-readiness-kit` — a GitHub-Actions-only scanner that
checks qte77-owned properties for agent-native readiness and produces concrete remediation, not
just a score. This file is self-contained and tracked; treat it as the source of truth.

## Principles

- **KISS / DRY / YAGNI** — simplest solution that works; single source of truth (link, don't
  duplicate); build only what's asked, no speculative features.
- **Concise & focused** — minimal change for the task; touch only task-related code; reuse
  existing patterns instead of rebuilding. Resolve ambiguity before acting.

## Tests

- RED-first TDD for every `src/scan/sources/*.ts` module (fake `fetch`/subprocess, real parsing
  logic asserted) — see
  [docs/plans/0001-scan-engine.md](docs/plans/0001-scan-engine.md#tests).
- **Test what matters:** module logic (`orchestrator.ts`'s fan-out/aggregation,
  `remediation/issue.ts`'s dedup search-then-update-or-create). Skip trivial scripts and pure
  wiring.
- CLI wiring (`main.ts`), the GHA workflow YAML, and `worker/wrangler.jsonc` are config/wiring —
  verify those by effect (a workflow run, `wrangler dev` + curl), not a unit test.

## Commits & PRs

- Conventional-commit prefixes (`feat`/`fix`/`chore`/`docs`/`test`); one topic per branch; open
  a PR; merge when CI is green.

## Where things live

- [docs/architecture.md](docs/architecture.md) — locked architecture decisions.
- [docs/plans/0002-readiness-dashboard.md](docs/plans/0002-readiness-dashboard.md) — the
  current arc's single remaining-work table, opening with a `## Status` section for
  session-to-session onboarding (this project keeps one file per arc — no separate handoff
  file). [docs/plans/0001-scan-engine.md](docs/plans/0001-scan-engine.md) is the closed prior
  arc (scan engine + MCP worker scaffold).
- [src/scan/crosswalk.ts](src/scan/crosswalk.ts) — signal → category lookup, seeded from
  `agenthud-agui-a2ui/docs/agent-readiness.md`; never forked/duplicated locally.
- Contributor dev setup + PR workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

Keep this file behavioral — no infrastructure, sandbox, or CI-token recipes.
