/**
 * Two-phase ora.ai scan: `POST /api/scan` to (re)trigger a scan, then `GET
 * /api/score/<url>` for the graded per-check breakdown — the exact pattern verified at
 * source 2026-09-17 (see docs/plans/0001-scan-engine.md's "External API contracts" +
 * "Design decisions" sections; do not re-derive this design, follow it).
 *
 * ora.ai is the only source producing `ScanRun`-level `score`/`grade` (see `src/types.ts`'s
 * own docstring), so this module returns `{ findings, score?, grade? }` instead of a bare
 * `Finding[]` like every other `src/scan/sources/*.ts` module — the orchestrator (row 6)
 * must special-case this one source's return value.
 *
 * No API key is required for either endpoint. An optional, manually-issued ora.ai partner
 * key exempts a caller from ora.ai's scan-family rate limits (10 req/min burst, 30
 * scans/rolling-24h) when supplied — sent as `Authorization: Bearer <key>` on both calls,
 * never logged or echoed into any Finding field.
 *
 * Never throws: a 429 (rate limited) or any other fetch/parse failure on either call
 * collapses to a single "unknown"-status Finding explaining what happened, so one
 * misbehaving/rate-limited source never crashes the orchestrator's fan-out across sources.
 *
 * Freshness (architecture.md's "Async scoring sources"): `POST /api/scan` echoes a stale
 * cached score, and the fresh one is only available from `GET /api/score/<url>` "~45s
 * later" (verified at source in an earlier session). This module waits `settleDelayMs`
 * (default 45000, matching that observed figure) between the two calls before reading the
 * score. If the response still isn't `analysisStatus: "complete"` after that single wait,
 * this module does not loop/re-poll (no repeated-polling behavior was verified at source) —
 * it uses whatever the one GET returned, which is still real per-check data, just possibly
 * from an analysis still finishing in the background.
 *
 * Real response shape (GET-verified live against https://qte77.github.io while
 * implementing this module — not guessed): top-level `{ score, grade, scannedAt,
 * analysisStatus, pendingChecks, layers: [{ id, name, score, maxScore, checks: [{ id, name,
 * status, score, maxScore, details, recommendation, estScoreGain? }] }] }`. Live-observed
 * `status` vocabulary is "pass" | "fail" | "warning" | "na" | "error" (not "warn" — see
 * mapCheckStatus below). ora.ai's own `layers[].id`/`name` grouping is NOT used for this
 * module's Finding.category — every Finding is categorized via this repo's own
 * `assignCategory(check.id)` per Design decision 1, independent of how ora.ai groups it.
 */
import { SIGNAL_TO_CATEGORY, assignCategory } from "../crosswalk.js";
import type { Category, Finding, Status } from "../../types.js";

const SCAN_ENDPOINT = "https://ora.ai/api/scan";
const SCORE_ENDPOINT_PREFIX = "https://ora.ai/api/score/";
const SOURCE = "oraAi";

/** Matches architecture.md's observed "~45s later" window for the fresh score to land. */
const DEFAULT_SETTLE_DELAY_MS = 45000;

/**
 * Pragmatic placeholder category for the one Finding emitted when the whole ora.ai call
 * fails outright (429 / network / parse failure) — there is no per-check breakdown to
 * assign a real category to at that point. Mirrors isitAgentReady.ts's Design decision 2
 * precedent of documenting a pragmatic, non-crosswalk-verified placement instead of
 * inventing a new category or leaving Finding.category unset.
 */
const FALLBACK_CATEGORY: Category = "Trust";

export interface OraAiOptions {
  /**
   * Optional ora.ai partner key (manually issued by ora.ai — "contact ora"; out of scope
   * to actually obtain for v1). Exempts the caller from ora.ai's scan-family rate limits
   * when supplied. Never required — every call below works with no key at all.
   */
  oraAiApiKey?: string;
  /** Injectable delay so tests don't wait for real time. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Delay between POST and GET. Default matches architecture.md's observed ~45s window. */
  settleDelayMs?: number;
}

export interface OraAiScanResult {
  findings: Finding[];
  score?: number;
  grade?: string;
}

interface OraAiCheck {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  score?: unknown;
  maxScore?: unknown;
  estScoreGain?: unknown;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function retryAfterEvidence(response: Response): Record<string, unknown> {
  const retryAfter = response.headers.get("retry-after");
  return retryAfter ? { retryAfterSeconds: retryAfter } : {};
}

function unavailableResult(
  summary: string,
  evidence: Record<string, unknown> = {},
): OraAiScanResult {
  return {
    findings: [
      {
        id: "oraAi.scan-unavailable",
        category: FALLBACK_CATEGORY,
        source: SOURCE,
        status: "unknown",
        summary,
        evidence,
      },
    ],
  };
}

/**
 * Maps ora.ai's own check `status` string onto this repo's `Status` union. Live-verified
 * vocabulary: "pass" -> pass, "fail" -> fail, "warning" -> warn. "error" means ora.ai
 * itself couldn't determine the check (e.g. "could not be verified - try rescanning") and
 * "na" means the check doesn't apply to this property (e.g. no paid surface) — neither is
 * a graded pass/fail/warn verdict, so both map to "unknown" rather than guessing a grade
 * ora.ai never actually gave. Any unrecognized future value also falls back to "unknown".
 */
function mapCheckStatus(raw: unknown): Status {
  if (typeof raw !== "string") return "unknown";
  switch (raw.trim().toLowerCase()) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "warning":
      return "warn";
    default:
      return "unknown";
  }
}

function checksFromLayers(layers: unknown): OraAiCheck[] {
  if (!Array.isArray(layers)) return [];
  const checks: OraAiCheck[] = [];
  for (const layer of layers) {
    if (typeof layer !== "object" || layer === null) continue;
    const layerChecks = (layer as { checks?: unknown }).checks;
    if (!Array.isArray(layerChecks)) continue;
    for (const check of layerChecks) {
      if (typeof check === "object" && check !== null) checks.push(check as OraAiCheck);
    }
  }
  return checks;
}

/** Builds a Finding for one check, or `undefined` when its id isn't a registered signal. */
function findingFromCheck(check: OraAiCheck): Finding | undefined {
  if (typeof check.id !== "string" || check.id.length === 0) return undefined;
  if (!(check.id in SIGNAL_TO_CATEGORY)) return undefined;

  const category = assignCategory(check.id);
  const status = mapCheckStatus(check.status);
  const name = typeof check.name === "string" ? check.name : check.id;

  return {
    id: `oraAi.${check.id}`,
    category,
    source: SOURCE,
    status,
    summary: `ora.ai check "${name}" (${check.id}) reported status "${String(check.status)}"`,
    evidence: {
      score: check.score,
      maxScore: check.maxScore,
      ...(check.estScoreGain !== undefined ? { estScoreGain: check.estScoreGain } : {}),
    },
  };
}

export async function scanOraAi(
  url: string,
  options: OraAiOptions = {},
): Promise<OraAiScanResult> {
  const sleep = options.sleep ?? defaultSleep;
  const settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
  const headers = authHeaders(options.oraAiApiKey);

  let scanResponse: Response;
  try {
    scanResponse = await fetch(SCAN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ url }),
    });
  } catch (cause) {
    return unavailableResult(`POST ${SCAN_ENDPOINT} failed: ${errorMessage(cause)}`);
  }

  if (scanResponse.status === 429) {
    return unavailableResult(
      `POST ${SCAN_ENDPOINT} was rate-limited (429) by ora.ai`,
      retryAfterEvidence(scanResponse),
    );
  }
  if (!scanResponse.ok) {
    return unavailableResult(`POST ${SCAN_ENDPOINT} returned ${scanResponse.status}`, {
      httpStatus: scanResponse.status,
    });
  }

  await sleep(settleDelayMs);

  const scoreUrl = `${SCORE_ENDPOINT_PREFIX}${encodeURIComponent(url)}`;
  let scoreResponse: Response;
  try {
    scoreResponse = await fetch(scoreUrl, { headers });
  } catch (cause) {
    return unavailableResult(`GET ${scoreUrl} failed: ${errorMessage(cause)}`);
  }

  if (scoreResponse.status === 429) {
    return unavailableResult(
      `GET ${scoreUrl} was rate-limited (429) by ora.ai`,
      retryAfterEvidence(scoreResponse),
    );
  }
  if (!scoreResponse.ok) {
    return unavailableResult(`GET ${scoreUrl} returned ${scoreResponse.status}`, {
      httpStatus: scoreResponse.status,
    });
  }

  let body: { score?: unknown; grade?: unknown; layers?: unknown };
  try {
    body = (await scoreResponse.json()) as { score?: unknown; grade?: unknown; layers?: unknown };
  } catch (cause) {
    return unavailableResult(`GET ${scoreUrl} returned a non-JSON body: ${errorMessage(cause)}`);
  }

  const findings: Finding[] = [];
  for (const check of checksFromLayers(body.layers)) {
    const finding = findingFromCheck(check);
    if (finding) findings.push(finding);
  }

  const result: OraAiScanResult = { findings };
  if (typeof body.score === "number") result.score = body.score;
  if (typeof body.grade === "string") result.grade = body.grade;
  return result;
}
