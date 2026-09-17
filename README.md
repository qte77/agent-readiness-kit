# agent-readiness-kit

Scans qte77-owned properties for "agent-native readiness" across six categories (Discovery,
Content, Trust, Execution, Agent-to-Agent, Identity & Auth) and produces concrete remediation
— not just a score. Runs entirely on GitHub Actions; zero runtime dependencies.

Tracked properties (see [`config/properties.ts`](config/properties.ts)): `qte77.github.io`,
`agenthud-agui-a2ui`, `sortmy.london`/`ldnmxx-hack`, `sfclarity.com`.

The six-category crosswalk (category ↔ ora.ai signal ↔ Cloudflare signal) is owned by
[`agenthud-agui-a2ui/docs/agent-readiness.md`](https://github.com/qte77/agenthud-agui-a2ui/blob/main/docs/agent-readiness.md);
this repo links to it rather than duplicating the table.

## Dashboard

Scan results (score/grade, category breakdown, trend sparkline, a client-side pass/warn/fail
threshold you can set) are published to
**[qte77.github.io/agent-readiness-kit](https://qte77.github.io/agent-readiness-kit/)** — a
static GitHub Pages site rebuilt on every push touching `data/scans/**` or `site/**`
(`.github/workflows/pages.yml`).

## Status

**Live.** [`.github/workflows/scan.yml`](.github/workflows/scan.yml) scans every tracked
property weekly (Monday 06:00 UTC, or on demand via `workflow_dispatch`), commits results to
[`data/scans/`](data/scans/), and files/updates a dedup-safe remediation issue per property.
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) rebuilds the dashboard above on
every push touching `data/scans/**` or `site/**`. Arc 0001 (the scan engine) is complete — see
[`docs/plans/0001-scan-engine.md`](docs/plans/0001-scan-engine.md) for its full history. Arc
0002 (this dashboard) is the current work — see
[`docs/plans/0002-readiness-dashboard.md`](docs/plans/0002-readiness-dashboard.md)'s opening
`## Status` section for what shipped, what's next, commands, and watch-outs. Ongoing and future
work lives under [`docs/plans/`](docs/plans/), one file per arc.

## How it works

1. Seven independent scan sources (`src/scan/sources/*.ts`) check each property: well-known
   URIs, content/bot-access signals, an MCP/A2A agent-card probe, a polyfetch-scrape
   discovery snapshot, and two external scorers (ora.ai, isitagentready.com).
2. [`src/scan/orchestrator.ts`](src/scan/orchestrator.ts) fans them out concurrently into one
   `ScanRun` per property.
3. [`src/main.ts`](src/main.ts) writes it to `data/scans/<propertyId>.json` — each run
   overwrites the file; git history *is* the trend record — then files/updates a remediation
   issue via [`src/remediation/`](src/remediation/).
4. [`worker/`](worker/) — a separate, read-only Cloudflare Worker exposing the same results
   over MCP (`get_latest_score` / `get_playbook` / `list_properties`) — is built and tested
   but **not deployed** (standing owner decision; no Cloudflare account/token provisioned).

See [`docs/architecture.md`](docs/architecture.md) for the full, durable rationale behind each
of these decisions.

## Development

```bash
npm install
npx vitest run    # tests
npx tsc --noEmit  # typecheck
npm run build     # compiles to dist/
npm run scan      # node dist/src/main.js — a real scan over config/properties.ts's
                   # PROPERTIES; needs GITHUB_TOKEN for the issue step (fails gracefully,
                   # with a clear message, when unset — e.g. a local run)
npm run site:build # node dist/scripts/buildSiteCli.js — builds site-dist/ (the dashboard +
                   # its data) from data/scans/ and site/; needs `npm run build` first.
                   # Preview locally with `npx serve site-dist` (or any static file server,
                   # e.g. `python3 -m http.server --directory site-dist`) — dev-only, no new
                   # dependency is added for this.
```

`worker/` is a separate package (own lockfile) — `cd worker && npm install && npm test`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full command set, branch/PR conventions, and
release process.
