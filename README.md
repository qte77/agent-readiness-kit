# agent-readiness-kit

Scans qte77-owned properties (`qte77.github.io`, `agenthud-agui-a2ui`,
`sortmy.london`/`ldnmxx-hack`) for "agent-native readiness" against six categories
(Discovery / Content / Trust / Execution / Agent-to-Agent / Identity & Auth) and produces
concrete remediation — not just a score.

The six-category crosswalk (category to ora.ai signal to Cloudflare signal) is owned by
[`agenthud-agui-a2ui/docs/agent-readiness.md`](https://github.com/qte77/agenthud-agui-a2ui/blob/main/docs/agent-readiness.md);
this repo links to it rather than duplicating the table.

## Status

Early scaffold. See [`docs/plans/0001-scan-engine.md`](docs/plans/0001-scan-engine.md) — its
opening `## Status` section onboards the next session (what shipped, what's next, commands,
watch-outs), followed by the locked architecture decisions and the single remaining-work table.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the durable reference: GitHub
Actions as the only runtime, one committed JSON file per property as the trend record,
dedup-safe remediation issues, zero runtime dependencies, and a read-only MCP worker
exposing the computed results.

## Development

```bash
npm install
npx vitest run    # tests
npx tsc --noEmit  # typecheck
```

The read-only MCP worker in [`worker/`](worker/) is a separate package (own lockfile,
own commands — `cd worker && npm install && npm test`); see
[`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) for the full command set.
