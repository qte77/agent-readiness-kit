/**
 * isitagentready.com's own scan API — a plain, unauthenticated, synchronous JSON endpoint
 * (see docs/plans/0001-scan-engine.md's "External API contracts" and "Design decisions"
 * sections, live-verified against a real property this arc). This row was originally
 * planned around Cloudflare URL Scanner's authenticated `agentReadiness` feature
 * (`cloudflareUrlScanner.ts`); that plan was dropped before any code existed in favor of
 * this simpler, key-less path to the same signal.
 *
 * `POST https://isitagentready.com/api/scan` with `{ url }` returns the full result inline
 * in one call — no submit-then-poll, no API key, no account id, no auth of any kind. This
 * module stays deliberately conservative on categorization (Design decision 2): it emits
 * exactly ONE Finding for the aggregate `level`/`levelName`, with the response's full
 * per-check `checks` object attached as evidence verbatim. It does NOT fan the sub-checks
 * (`robotsTxt`, `sitemap`, etc.) out into per-signal Findings — their camelCase ids don't
 * string-match `src/scan/crosswalk.ts`'s kebab-case signal ids, and inventing that mapping
 * locally is out of scope for this row (issue #5 tracks folding a real mapping in later,
 * once row 13 produces real responses across all 3 properties).
 *
 * `category: "Trust"` is a documented pragmatic placement for this cross-cutting external
 * score, not a crosswalk-verified signal mapping — deliberately not routed through
 * `assignCategory()`, which is reserved for real crosswalk signal ids.
 *
 * No credential-presence branch exists here at all (unlike discoverSnapshot.ts's
 * `POLYFETCH_SCRAPE_DIR` check) — this endpoint needs no credentials. The only failure mode
 * is an ordinary network/parse failure, handled by returning a single "unknown"-status
 * Finding — never throws.
 */
import type { Finding, Status } from "../../types.js";

const ENDPOINT = "https://isitagentready.com/api/scan";
const FINDING_ID = "isitAgentReady.agent-readiness-scan";
const CATEGORY = "Trust" as const;
const SOURCE = "isitAgentReady" as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unknownFinding(message: string): Finding {
  return {
    id: FINDING_ID,
    category: CATEGORY,
    source: SOURCE,
    status: "unknown",
    summary: `Could not determine isitagentready.com agent-readiness score: ${message}`,
    evidence: { error: message },
  };
}

/** Maps the response's overall `level` (0-5) to this Finding's Status, per Design decision 2. */
function statusForLevel(level: number): Status {
  if (level >= 4) return "pass";
  if (level === 2 || level === 3) return "warn";
  return "fail";
}

function isValidLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5;
}

function buildFinding(propertyUrl: string, body: unknown): Finding {
  if (typeof body !== "object" || body === null) {
    return unknownFinding("response body is not a JSON object");
  }

  const { level, levelName, scannedAt, checks } = body as Record<string, unknown>;
  if (!isValidLevel(level)) {
    return unknownFinding(`response has an unexpected "level" value: ${JSON.stringify(level)}`);
  }
  if (typeof checks !== "object" || checks === null) {
    return unknownFinding('response is missing a "checks" object');
  }

  const status = statusForLevel(level);
  const levelLabel = typeof levelName === "string" ? levelName : String(level);
  const summary = `isitagentready.com scored ${propertyUrl} at level ${level} (${levelLabel})`;

  const finding: Finding = {
    id: FINDING_ID,
    category: CATEGORY,
    source: SOURCE,
    status,
    summary,
    evidence: { level, levelName, scannedAt, checks },
  };

  if (status !== "pass") {
    finding.remediation =
      `Review isitagentready.com's per-check breakdown (this Finding's evidence.checks) for ` +
      `${propertyUrl} and address the failing/warning checks to raise the level above ${level}.`;
  }

  return finding;
}

/**
 * Calls `POST https://isitagentready.com/api/scan` with `{ url }` and returns exactly one
 * Finding derived from the response's aggregate `level`. Never throws — a fetch failure,
 * non-200 response, or unparseable/unexpected-shape body all resolve to a single
 * `"unknown"`-status Finding instead.
 */
export async function scanIsitAgentReady(url: string): Promise<Finding[]> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (cause) {
    return [unknownFinding(`POST ${ENDPOINT} failed: ${errorMessage(cause)}`)];
  }

  if (!response.ok) {
    return [unknownFinding(`POST ${ENDPOINT} returned ${response.status}`)];
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return [
      unknownFinding(
        `POST ${ENDPOINT} returned ${response.status} but the body is not valid JSON: ${errorMessage(cause)}`,
      ),
    ];
  }

  return [buildFinding(url, body)];
}
