# Contributing

Thanks for considering a contribution to **agent-readiness-kit** — a GitHub-Actions-only scanner
that checks qte77-owned properties for agent-native readiness and produces concrete remediation,
not just a score.

## Before you start

- Check open issues to avoid duplication; for non-trivial changes, open an issue first.
- See [AGENTS.md](../AGENTS.md) for the working conventions (principles, tests, commits).
- Read [docs/architecture.md](../docs/architecture.md) and
  [docs/plans/0001-scan-engine.md](../docs/plans/0001-scan-engine.md) before touching scan-engine
  code — several decisions there are locked and verified at source, not to be re-derived.

## Documentation hierarchy

One audience per file — reference, don't duplicate
([doc-structure.md](https://github.com/qte77/qte77/blob/main/docs/doc-structure.md)):

| File | Audience | Owns |
| --- | --- | --- |
| [README.md](../README.md) | users / evaluators | what this is, why, how — the front door |
| CONTRIBUTING.md (this file) | contributors | workflow, commands, conventions |
| [AGENTS.md](../AGENTS.md) | AI agents | behavioural rules (`CLAUDE.md` loads the same) |
| [CHANGELOG.md](../CHANGELOG.md) | everyone | notable changes by version |
| [docs/architecture.md](../docs/architecture.md) | contributors / agents | locked architecture decisions |
| [docs/plans/](../docs/plans/) | contributors / agents | per-arc plan + the single remaining-work table |

## Development

Requires Node.js 22+.

```bash
npm install         # dependencies
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run build        # tsc
npm run scan         # node dist/src/main.js — run a real scan locally (needs `npm run build`
                      # first); files/updates a remediation issue per property, which needs
                      # GITHUB_TOKEN set — without it, that step fails gracefully with a clear
                      # message and the loop moves on to the next property (an accepted
                      # local-run gap, not a bug)
```

Run `npm run typecheck && npm test` before opening a PR (CI enforces both; no linter is
configured yet — see the plan's remaining-work table).

`worker/` (the read-only MCP layer) is a separate package with its own lockfile — run its
own gate too when you touch it (CI enforces both jobs):

```bash
cd worker
npm install
npm run typecheck
npm test
npm run dev          # wrangler dev — GET /.well-known/agent-card.json, POST /mcp
```

`src/scan/sources/discoverSnapshot.ts` needs a polyfetch-scrape checkout to run for real
(unit tests fake the subprocess): pass `polyfetchScrapeDir`, or set `POLYFETCH_SCRAPE_DIR`.

## Pull requests

- One concern per PR, one topic per branch; reference issues (`Closes #123`).
- Ensure CI is green before merge.

## Branches

- `feat/TOPIC`, `fix/TOPIC`, `docs/TOPIC`, `chore/TOPIC`
- Squash-merge is default; delete the branch (remote + local) after merge.

## CHANGELOG

Add an entry under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) for any consumer-visible
change; lead with the file path. Keep a Changelog format.

## Releasing

No version has been cut yet (this repo is a pre-v1 scaffold — see [README.md](../README.md)'s
Status section), but the automation is pre-staged and dormant:

1. **Bump — one PR off `main`.** Run `npm version <patch|minor|major> --no-git-tag-version` to
   set the version in `package.json`/`package-lock.json`; in `CHANGELOG.md` rename
   `## [Unreleased]` to `## [X.Y.Z] - <YYYY-MM-DD>`, adding a fresh `## [Unreleased]` above.
   Commit as `chore(release): vX.Y.Z` and merge on green CI.
2. **Tag — automatic.** The merge changes `package.json` on `main`, so
   [`tag-release`](workflows/tag-release.yaml) tags `vX.Y.Z` on the squash-merge commit.
3. **Release — one click.** Run [`publish-release`](workflows/publish-release.yaml) (Actions
   tab, or `gh workflow run publish-release.yaml -f tag=vX.Y.Z`) to publish a GitHub Release
   with notes from the matching `CHANGELOG.md` block. Tag-only is fine.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) — enable the template once with
`git config commit.template .gitmessage` (it lists the accepted types).

## Questions

Open an issue with the `question` label.
