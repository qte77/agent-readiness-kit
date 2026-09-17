/**
 * CLI wiring (arc 0002, plan row 2) for the GitHub Pages readiness dashboard: reconstructs
 * per-property trend history by walking git log over each `data/scans/*.json` file, then
 * assembles `site-dist/` (the GitHub Pages deploy artifact) from the static `site/` source plus
 * the current scan snapshots and the reconstructed history.
 *
 * This is config/wiring (git subprocess + file I/O), not module logic — per AGENTS.md's "Tests"
 * section and docs/plans/0001-scan-engine.md's Quality gates, it's verified by effect (running
 * it for real and inspecting `site-dist/`), not a RED-first unit test, same precedent as
 * `src/main.ts`.
 *
 * Compiles to `dist/scripts/buildSiteCli.js` (this repo's tsconfig.json has `rootDir: "."`,
 * covering `scripts/**` alongside `src/**`/`config/**`/`test/**` — same reasoning `src/main.ts`
 * already documents for why it's `dist/src/main.js`, not `dist/main.js`). Run via
 * `npm run site:build` (`node dist/scripts/buildSiteCli.js`).
 *
 * Requires the workflow's checkout to use `fetch-depth: 0` — a shallow clone (the GHA default)
 * only sees the latest commit per file, which would silently produce single-point history
 * instead of loudly failing.
 *
 * Deviation from docs/plans/2026-09-17's arc-0002 plan (recorded here and in
 * docs/plans/0002-readiness-dashboard.md): the plan specified `git log --follow --reverse
 * --format=%H -- <path>`. Verified at source before implementing: `--follow`'s rename-detection
 * heuristic false-positives across this repo's `data/scans/*.json` files, because they're
 * structurally near-identical JSON (confirmed live — `git log --follow` for
 * `data/scans/redacted-property-com.json` returned commit `c97af99`, which `git show --stat` proves
 * never touched that path at all; a plain `git log` for the same path correctly returns only
 * the one real commit that added it). These files are always written in place by
 * `src/checkpoint.ts` and never renamed, so `--follow` is both unnecessary and actively wrong
 * here. Uses a plain `git log --reverse --format=%H -- <path>` instead.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SCANS_DIR } from "../src/checkpoint.js";
import { capHistory, summarizeScanRun, type RunSummary } from "./buildSite.js";
import type { ScanRun } from "../src/types.js";

const SITE_SRC_DIR = "site";
const SITE_DIST_DIR = "site-dist";
const HISTORY_MAX = 52;

/** Guards against any filename that isn't a plain `<propertyId>.json`, before it's used as a git pathspec. */
const SCAN_FILENAME_RE = /^[a-z0-9-]+\.json$/;

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

/** Property ids found under `data/scans/` at build time — never hardcoded to `config/properties.ts`. */
async function listPropertyIds(): Promise<string[]> {
  const entries = await readdir(SCANS_DIR);
  return entries
    .filter((name) => SCAN_FILENAME_RE.test(name))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

/**
 * Reconstruct one property's trend history from git log, oldest-to-newest, capped at
 * `HISTORY_MAX`. Never throws: a commit whose historical revision fails to parse (or, in
 * principle, doesn't exist at that path) is skipped with a warning rather than aborting the
 * whole build.
 */
function buildHistory(propertyId: string): RunSummary[] {
  const path = join(SCANS_DIR, `${propertyId}.json`);
  const shas = git(["log", "--reverse", "--format=%H", "--", path])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const summaries: RunSummary[] = [];
  for (const sha of shas) {
    try {
      const raw = git(["show", `${sha}:${path}`]);
      const run = JSON.parse(raw) as ScanRun;
      summaries.push(summarizeScanRun(run));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`site:build: skipping ${propertyId}@${sha} (${message})`);
    }
  }
  return capHistory(summaries, HISTORY_MAX);
}

async function copyStaticSite(): Promise<void> {
  const entries = await readdir(SITE_SRC_DIR);
  for (const entry of entries) {
    await copyFile(join(SITE_SRC_DIR, entry), join(SITE_DIST_DIR, entry));
  }
}

async function copyScanSnapshots(propertyIds: string[]): Promise<void> {
  const outDir = join(SITE_DIST_DIR, "data", "scans");
  await mkdir(outDir, { recursive: true });
  for (const id of propertyIds) {
    await copyFile(join(SCANS_DIR, `${id}.json`), join(outDir, `${id}.json`));
  }
}

async function writeHistoryFiles(propertyIds: string[]): Promise<void> {
  const outDir = join(SITE_DIST_DIR, "data", "history");
  await mkdir(outDir, { recursive: true });
  for (const id of propertyIds) {
    const history = buildHistory(id);
    await writeFile(join(outDir, `${id}.json`), `${JSON.stringify(history, null, 2)}\n`, "utf8");
    console.log(`site:build: ${id} — ${history.length} history point(s)`);
  }
}

/** A manifest of property ids, since a static page served over http(s) can't list a directory. */
async function writeManifest(propertyIds: string[]): Promise<void> {
  const outDir = join(SITE_DIST_DIR, "data");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.json"), `${JSON.stringify(propertyIds, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  await stat(join(SITE_SRC_DIR, "index.html")).catch(() => {
    throw new Error(`site:build: ${SITE_SRC_DIR}/index.html not found — is this running from the repo root?`);
  });

  const propertyIds = await listPropertyIds();
  console.log(`site:build: found ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}: ${propertyIds.join(", ")}`);

  await mkdir(SITE_DIST_DIR, { recursive: true });
  await copyStaticSite();
  await copyScanSnapshots(propertyIds);
  await writeHistoryFiles(propertyIds);
  await writeManifest(propertyIds);

  console.log(`site:build: wrote ${SITE_DIST_DIR}/`);
}

main().catch((error) => {
  console.error(`site:build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
