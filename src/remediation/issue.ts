/**
 * Dedup-safe remediation issue create/update, per docs/architecture.md's
 * "Dedup-safe issue creation": before ever creating an issue, search by a fixed
 * per-property title marker; if found, update its body in place plus a changelog
 * comment; if not found, create one. Never silently create a duplicate, and never
 * silently reuse a stale/mismatched issue (title equality in github.ts is exact,
 * not fuzzy). This mirrors, and tightens, the
 * `2026-08-26-AgentNativeHack-FT-CF-SF/src/execute.ts:37-55` `findOpenIdleDiscoveryIssue`
 * pattern that prevented a 35-duplicate-issue bug class elsewhere in this estate.
 */
import type { Finding, ScanRun } from "../types.js";
import {
  addIssueComment,
  createIssue,
  findOpenIssueByTitle,
  updateIssueBody,
  type GitHubRepoRef,
} from "./github.js";

/**
 * Fixed per-property title marker used as the dedup search key. Deterministic —
 * never include dynamic content (score, timestamp) here; that belongs in the body
 * and changelog comment only, so the exact-match search in github.ts always finds
 * the same issue across every run for this property.
 */
export function remediationIssueTitle(propertyId: string): string {
  return `[agent-readiness] ${propertyId} remediation`;
}

function actionableFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.status === "fail" || finding.status === "warn");
}

function formatFinding(finding: Finding): string {
  const remediation = finding.remediation ? `\n  Remediation: ${finding.remediation}` : "";
  return (
    `- **[${finding.category}] ${finding.id}** (${finding.status}, source: ${finding.source})` +
    ` — ${finding.summary}${remediation}`
  );
}

/** Full issue body — always rebuilt from the latest ScanRun and written in place. */
export function buildIssueBody(scanRun: ScanRun, propertyLabel: string): string {
  const actionable = actionableFindings(scanRun.findings);
  const scoreLine =
    scanRun.score !== undefined
      ? `Score: ${scanRun.score}${scanRun.grade ? ` (${scanRun.grade})` : ""}`
      : "Score: n/a";
  const findingsSection =
    actionable.length > 0
      ? actionable.map(formatFinding).join("\n")
      : "_No outstanding findings from the latest scan._";

  return [
    `## Agent-readiness remediation — ${propertyLabel}`,
    "",
    `Property: \`${scanRun.propertyId}\` (${scanRun.url})`,
    `Last scanned: ${scanRun.scannedAt}`,
    scoreLine,
    "",
    "### Findings needing attention",
    "",
    findingsSection,
  ].join("\n");
}

/** Changelog comment appended on every run that updates an existing issue. */
export function buildChangelogComment(scanRun: ScanRun): string {
  const actionable = actionableFindings(scanRun.findings);
  return [
    `### Scan update — ${scanRun.scannedAt}`,
    "",
    `Outstanding findings: ${actionable.length}`,
    actionable.length > 0
      ? actionable.map((finding) => `- ${finding.id} (${finding.status})`).join("\n")
      : "_All clear on this run._",
  ].join("\n");
}

export type RemediationAction = "created" | "updated";

export interface RemediationResult {
  action: RemediationAction;
  issueNumber: number;
  url: string;
}

/**
 * Dedup-safe create-or-update for one property's remediation issue.
 *
 * ALWAYS searches for the fixed title marker among open issues first — this call
 * order is the entire point of this module and must never be reordered or
 * skipped. If a match is found, its body is replaced in place and a changelog
 * comment is appended (never a second issue). If no match is found, a new issue
 * is created.
 */
export async function upsertRemediationIssue(
  ref: GitHubRepoRef,
  scanRun: ScanRun,
  propertyLabel: string,
  token?: string,
): Promise<RemediationResult> {
  const title = remediationIssueTitle(scanRun.propertyId);
  const body = buildIssueBody(scanRun, propertyLabel);

  // Dedup gate — must run before any create/update call.
  const existing = await findOpenIssueByTitle(ref, title, token);

  if (existing) {
    const updated = await updateIssueBody(ref, existing.number, body, token);
    await addIssueComment(ref, existing.number, buildChangelogComment(scanRun), token);
    return { action: "updated", issueNumber: updated.number, url: updated.html_url };
  }

  const created = await createIssue(ref, title, body, token);
  return { action: "created", issueNumber: created.number, url: created.html_url };
}
