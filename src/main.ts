/**
 * CLI entrypoint (plan row 9): for every property in `config/properties.ts`'s `PROPERTIES`,
 * run the row-6 orchestrator (`scanProperty`), write the resulting `ScanRun` to
 * `data/scans/<propertyId>.json` (`src/checkpoint.ts`), then file/update a dedup-safe
 * remediation issue from it (`src/remediation/issue.ts`).
 *
 * This is config/wiring, not module logic — per `AGENTS.md`'s "Tests" section and
 * `docs/plans/0001-scan-engine.md`'s Quality gates, it's verified by effect (a real
 * `node dist/main.js` run), not a RED-first unit test.
 *
 * `src/remediation/github.ts` requires `process.env.GITHUB_TOKEN`, which GHA does not inject
 * automatically (the workflow YAML — plan row 11 — must map it explicitly). Locally, with no
 * `GITHUB_TOKEN` set, the issue-upsert step fails with a clear message and this loop moves on
 * to the next property instead of crashing the whole run — this is an accepted local-run gap
 * (see the plan's Design decision 2 / row 9's Verification note), not a bug to work around.
 */
import { PROPERTIES, type PropertyConfig } from "../config/properties.js";
import { checkpointPath, writeCheckpoint } from "./checkpoint.js";
import type { GitHubRepoRef } from "./remediation/github.js";
import { upsertRemediationIssue } from "./remediation/issue.js";
import { scanProperty } from "./scan/orchestrator.js";
import type { Finding, ScanRun } from "./types.js";

/** This kit scans qte77's own properties and files remediation issues against this repo. */
const REPO: GitHubRepoRef = { owner: "qte77", repo: "agent-readiness-kit" };

function summarizeStatuses(findings: Finding[]): string {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.status, (counts.get(finding.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => `${status}: ${count}`).join(", ") || "none";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function scanOneProperty(property: PropertyConfig): Promise<void> {
  console.log(`\n=== ${property.label} (${property.id}) — ${property.url} ===`);

  let run: ScanRun;
  try {
    run = await scanProperty(property);
  } catch (error) {
    console.error(`Scan FAILED for ${property.id}: ${errorMessage(error)}`);
    return;
  }

  const scoreLine =
    run.score !== undefined ? `${run.score}${run.grade ? ` (${run.grade})` : ""}` : "n/a";
  console.log(`Scanned at ${run.scannedAt} — score: ${scoreLine}`);
  console.log(`Findings: ${run.findings.length} (${summarizeStatuses(run.findings)})`);

  try {
    await writeCheckpoint(run);
    console.log(`Checkpoint written: ${checkpointPath(run.propertyId)}`);
  } catch (error) {
    console.error(`Checkpoint write FAILED for ${property.id}: ${errorMessage(error)}`);
    return;
  }

  try {
    const result = await upsertRemediationIssue(REPO, run, property.label);
    console.log(`Remediation issue ${result.action}: ${result.url}`);
  } catch (error) {
    console.warn(
      `Remediation issue upsert skipped for ${property.id} ` +
        `(expected locally without GITHUB_TOKEN set — see AGENTS.md/CONTRIBUTING.md): ${errorMessage(error)}`,
    );
  }
}

async function main(): Promise<void> {
  for (const property of PROPERTIES) {
    await scanOneProperty(property);
  }
}

main().catch((error) => {
  console.error(`agent-readiness-kit scan run failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
