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
 * Only crosswalked check ids become Findings; every other check is returned as raw
 * evidence in `checks.unmapped` (persisted as `ScanRun.oraAiChecks`) instead of dropped.
 *
 * Fresh scans (#74, opt-in `fresh: true`): the cached pair above can return a result from
 * before a deploy. ora.ai's own rescan page instead reads an internal, undocumented event
 * stream (`GET /api/scan/stream?domain=<host>&fresh=1`, keyless). Its `scan_complete`
 * event carries a result in the same shape as `GET /api/score`, and `relevance_assessed`
 * the displayed, relevance-weighted score/grade plus the checks it judged not applicable
 * (read here as "na"). Shape verified against one live capture (2026-11-21, against
 * https://qte77.github.io). Findings from it are flagged in their evidence; any failure
 * (network, non-2xx, no `scan_complete`, timeout) falls back to the cached path.
 */
import { SIGNAL_TO_CATEGORY, assignCategory } from "../crosswalk.js";
import type {
  Category,
  Finding,
  OraAiCheckDigest,
  OraAiCheckEvidence,
  Status,
} from "../../types.js";

const SCAN_ENDPOINT = "https://ora.ai/api/scan";
const SCORE_ENDPOINT_PREFIX = "https://ora.ai/api/score/";
/**
 * ora.ai's own scan page opens this event stream for a rescan (`?rescan=1`), found in its JS
 * bundle (#74). Internal and undocumented, so it may change; every Finding read from it is
 * flagged with `evidence.oraAiEndpoint`, and any failure falls back to the cached path.
 */
const STREAM_ENDPOINT = "https://ora.ai/api/scan/stream";
const STREAM_EVIDENCE = { oraAiEndpoint: "internal:/api/scan/stream" } as const;
/** One live fresh scan took about 20 s (#74); this bounds a stream that never completes. */
const DEFAULT_FRESH_TIMEOUT_MS = 120000;
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
  /**
   * Force a fresh scan through ora.ai's internal event stream instead of the cached
   * `POST /api/scan` + `GET /api/score` pair, which can return a result from before a
   * deploy (#74). Off by default; on any stream failure the cached path runs instead.
   */
  fresh?: boolean;
  /** Upper bound for the whole fresh-scan stream. Default 120 s. */
  freshTimeoutMs?: number;
}

export interface OraAiScanResult {
  findings: Finding[];
  score?: number;
  grade?: string;
  /** Present whenever the score response was read; absent when ora.ai was unavailable. */
  checks?: OraAiCheckDigest;
}

interface OraAiCheck {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  score?: unknown;
  maxScore?: unknown;
  estScoreGain?: unknown;
  details?: unknown;
  recommendation?: unknown;
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
function findingFromCheck(
  check: OraAiCheck,
  extraEvidence: Record<string, unknown> = {},
): Finding | undefined {
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
      ...explanation(check),
      ...extraEvidence,
    },
  };
}

/** ora.ai's own `details`/`recommendation` text for a check, when it gave any. */
function explanation(check: OraAiCheck): Pick<OraAiCheckEvidence, "details" | "recommendation"> {
  return {
    ...(typeof check.details === "string" ? { details: check.details } : {}),
    ...(typeof check.recommendation === "string" ? { recommendation: check.recommendation } : {}),
  };
}

/** A check with no crosswalk signal, kept as raw evidence instead of being dropped (#75). */
function unmappedEvidence(check: OraAiCheck): OraAiCheckEvidence | undefined {
  if (typeof check.id !== "string" || check.id.length === 0) return undefined;
  return {
    id: check.id,
    status: String(check.status),
    ...(typeof check.score === "number" ? { score: check.score } : {}),
    ...(typeof check.maxScore === "number" ? { maxScore: check.maxScore } : {}),
    ...explanation(check),
  };
}

export async function scanOraAi(
  url: string,
  options: OraAiOptions = {},
): Promise<OraAiScanResult> {
  if (options.fresh) {
    const fresh = await scanFresh(url, options);
    if (fresh !== undefined) return fresh;
  }
  return scanCached(url, options);
}

/** The default two-phase path: `POST /api/scan`, wait, then `GET /api/score/<url>`. */
async function scanCached(url: string, options: OraAiOptions): Promise<OraAiScanResult> {
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

  let body: ScoreBody;
  try {
    body = (await scoreResponse.json()) as ScoreBody;
  } catch (cause) {
    return unavailableResult(`GET ${scoreUrl} returned a non-JSON body: ${errorMessage(cause)}`);
  }

  return resultFromScore(body);
}

interface ScoreBody {
  score?: unknown;
  grade?: unknown;
  layers?: unknown;
}

/**
 * Findings, unmapped evidence, score and grade from one `{score, grade, layers}` body: the
 * `GET /api/score` response, or the fresh stream's `scan_complete.result`, which has the
 * same shape. `naCheckIds` (the stream's `relevance_assessed`) are read as status "na".
 */
function resultFromScore(
  body: ScoreBody,
  naCheckIds: ReadonlySet<string> = new Set(),
  extraEvidence: Record<string, unknown> = {},
): OraAiScanResult {
  const findings: Finding[] = [];
  const unmapped: OraAiCheckEvidence[] = [];
  for (const raw of checksFromLayers(body.layers)) {
    const check =
      typeof raw.id === "string" && naCheckIds.has(raw.id) ? { ...raw, status: "na" } : raw;
    const finding = findingFromCheck(check, extraEvidence);
    if (finding) {
      findings.push(finding);
      continue;
    }
    const evidence = unmappedEvidence(check);
    if (evidence) unmapped.push(evidence);
  }

  const result: OraAiScanResult = { findings, checks: { mapped: findings.length, unmapped } };
  if (typeof body.score === "number") result.score = body.score;
  if (typeof body.grade === "string") result.grade = body.grade;
  return result;
}

interface StreamEvent {
  type?: unknown;
  result?: unknown;
  naCheckIds?: unknown;
  score?: unknown;
  grade?: unknown;
}

/** Parses complete `data:` events out of `buffer`; returns them and the unparsed rest. */
function takeEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: StreamEvent[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === "object" && parsed !== null) events.push(parsed as StreamEvent);
    } catch {
      // A malformed event is skipped; the scan_complete check below still guards the result.
    }
  }
  return { events, rest };
}

/** Reads the stream until `relevance_assessed` or its end; `undefined` means "use cached". */
async function readFreshStream(
  response: Response,
): Promise<{ result: ScoreBody; relevance?: StreamEvent } | undefined> {
  if (!response.ok || response.body === null) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ScoreBody | undefined;
  let relevance: StreamEvent | undefined;
  try {
    while (relevance === undefined) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      const taken = takeEvents(buffer + chunk);
      buffer = taken.rest;
      for (const event of taken.events) {
        if (event.type === "scan_complete" && typeof event.result === "object" && event.result) {
          result = event.result as ScoreBody;
        } else if (event.type === "relevance_assessed") {
          relevance = event;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return result === undefined ? undefined : { result, relevance };
}

async function scanFresh(url: string, options: OraAiOptions): Promise<OraAiScanResult | undefined> {
  const streamUrl = `${STREAM_ENDPOINT}?domain=${encodeURIComponent(new URL(url).hostname)}&fresh=1`;
  try {
    const response = await fetch(streamUrl, {
      headers: { accept: "text/event-stream", ...authHeaders(options.oraAiApiKey) },
      signal: AbortSignal.timeout(options.freshTimeoutMs ?? DEFAULT_FRESH_TIMEOUT_MS),
    });
    const stream = await readFreshStream(response);
    if (stream === undefined) return undefined;
    const naCheckIds = new Set(
      Array.isArray(stream.relevance?.naCheckIds)
        ? stream.relevance.naCheckIds.filter((id): id is string => typeof id === "string")
        : [],
    );
    const result = resultFromScore(stream.result, naCheckIds, STREAM_EVIDENCE);
    // relevance_assessed carries the relevance-weighted score ora.ai displays.
    if (typeof stream.relevance?.score === "number") result.score = stream.relevance.score;
    if (typeof stream.relevance?.grade === "string") result.grade = stream.relevance.grade;
    return result;
  } catch {
    return undefined;
  }
}
