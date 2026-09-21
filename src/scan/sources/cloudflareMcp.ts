/**
 * Cloudflare MCP + A2A static-shape checks.
 *
 * Owns two signal ids from the agent-readiness crosswalk (`src/scan/crosswalk.ts`):
 * - `mcp-server-card` (Execution): presence + basic shape of
 *   `/.well-known/mcp/server-card.json`. This mirrors Cloudflare's own `isitagentready.com`
 *   check set, not a shipped MCP spec: MCP's real capability-discovery mechanism is a live
 *   JSON-RPC exchange (`initialize`, or `server/discover` in the current 2026-07-28 spec),
 *   never a static well-known file. A proposal literally named "MCP Server Cards" (SEP-2127)
 *   exists but is still Draft, with its own discovery mechanism explicitly unresolved, as of
 *   2026-09-18 (verified at source — see docs/plans/0004-crosswalk-accuracy-and-gaps.md).
 *   Decide-by-default: keep grading pass/fail here anyway, since it mirrors an established
 *   external grader (Cloudflare's) rather than the unshipped spec — don't silently flip this
 *   to `unknown`-only without noting the change, same treatment `wellKnown.ts`'s `dns-aid`
 *   gets for an actually-unsettled signal.
 * - `a2a-agent-card` (Agent-to-Agent): presence + basic shape of
 *   `/.well-known/agent-card.json` — the *static* half of this signal only. The live
 *   protocol-level probe against the card's declared endpoint lives in `mcpA2aProbe.ts`,
 *   which contributes its own Finding at greater check depth (same signal id, distinct
 *   source-prefixed Finding id) that can upgrade or downgrade the readiness verdict.
 *
 * Both checks only verify presence + a handful of basic key/type checks — not a full
 * schema — per architecture.md's zero-runtime-dependency policy (no JSON-schema validator).
 */
import { assignCategory } from "../crosswalk.js";
import type { Finding } from "../../types.js";

const MCP_SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";
const AGENT_CARD_PATH = "/.well-known/agent-card.json";

type KeyKind = "string" | "array" | "object";
type KeySpec = readonly [key: string, kind: KeyKind];

/** Basic presence + type checks — not a schema, per architecture.md's dependency policy. */
const MCP_SERVER_CARD_KEYS: readonly KeySpec[] = [
  ["name", "string"],
  ["description", "string"],
  ["version", "string"],
  ["serverUrl", "string"],
  ["tools", "array"],
];

/**
 * Subset of the A2A protocol's AgentCard fields (a2a-protocol.org/v1.0.0/specification,
 * verified at source 2026-09-21) — enough to distinguish a real card from an empty/garbage
 * JSON file without reimplementing the full spec as a validator — see
 * docs/plans/0005-a2a-agentcard-v1-migration.md.
 */
const AGENT_CARD_KEYS: readonly KeySpec[] = [
  ["name", "string"],
  ["description", "string"],
  ["version", "string"],
  ["capabilities", "object"],
  ["skills", "array"],
];

/**
 * v1.0.0 replaced AgentCard's flat `url` with `supportedInterfaces[]`, but a real v0.3.0-era
 * card may still only have `url` — accept either shape rather than false-failing one of them.
 */
const AGENT_CARD_URL_CHECK: ExtraCheck = {
  label: "url-or-supportedInterfaces",
  passes: (body: Record<string, unknown>): boolean =>
    (typeof body["url"] === "string" && body["url"].length > 0) ||
    (Array.isArray(body["supportedInterfaces"]) && body["supportedInterfaces"].length > 0),
};

interface ShapeCheckResult {
  status: Finding["status"];
  summary: string;
  remediation?: string;
  evidence: Record<string, unknown>;
}

function hasKind(value: unknown, kind: KeyKind): boolean {
  if (kind === "array") return Array.isArray(value);
  if (kind === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === kind;
}

function missingKeys(body: Record<string, unknown>, keys: readonly KeySpec[]): string[] {
  return keys.filter(([key, kind]) => !hasKind(body[key], kind)).map(([key]) => key);
}

interface ExtraCheck {
  label: string;
  passes: (body: Record<string, unknown>) => boolean;
}

async function checkWellKnownJson(
  path: string,
  absoluteUrl: string,
  keys: readonly KeySpec[],
  whatLabel: string,
  extraCheck?: ExtraCheck,
): Promise<ShapeCheckResult> {
  let response: Response;
  try {
    response = await fetch(absoluteUrl);
  } catch (cause) {
    return {
      status: "unknown",
      summary: `GET ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      remediation: `Could not reach ${path} to check for ${whatLabel} — verify the property is online and retry the scan.`,
      evidence: {},
    };
  }

  if (!response.ok) {
    return {
      status: "fail",
      summary: `GET ${path} returned ${response.status}`,
      remediation: `Publish a well-formed ${whatLabel} at ${path}.`,
      evidence: { httpStatus: response.status },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: "fail",
      summary: `GET ${path} returned ${response.status} but the body is not valid JSON`,
      remediation: `Publish a well-formed ${whatLabel} at ${path}.`,
      evidence: { httpStatus: response.status },
    };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      status: "fail",
      summary: `GET ${path} returned ${response.status} but the body is not a JSON object`,
      remediation: `Publish a well-formed ${whatLabel} at ${path}.`,
      evidence: { httpStatus: response.status },
    };
  }

  const missing = missingKeys(body as Record<string, unknown>, keys);
  if (extraCheck && !extraCheck.passes(body as Record<string, unknown>)) {
    missing.push(extraCheck.label);
  }
  if (missing.length > 0) {
    return {
      status: "warn",
      summary: `GET ${path} returned ${response.status} but is missing/malformed keys: ${missing.join(", ")}`,
      remediation: `Complete the ${whatLabel} at ${path} — missing/malformed keys: ${missing.join(", ")}.`,
      evidence: { httpStatus: response.status, missingKeys: missing },
    };
  }

  return {
    status: "pass",
    summary: `GET ${path} returned ${response.status} with all expected keys present`,
    evidence: { httpStatus: response.status },
  };
}

function toFinding(id: string, signal: string, result: ShapeCheckResult): Finding {
  return {
    id,
    category: assignCategory(signal),
    source: "cloudflareMcp",
    status: result.status,
    summary: result.summary,
    ...(result.remediation !== undefined ? { remediation: result.remediation } : {}),
    evidence: result.evidence,
  };
}

export async function scanCloudflareMcp(baseUrl: string): Promise<Finding[]> {
  const serverCardUrl = new URL(MCP_SERVER_CARD_PATH, baseUrl).toString();
  const agentCardUrl = new URL(AGENT_CARD_PATH, baseUrl).toString();

  const [serverCard, agentCard] = await Promise.all([
    checkWellKnownJson(
      MCP_SERVER_CARD_PATH,
      serverCardUrl,
      MCP_SERVER_CARD_KEYS,
      "MCP server card (name/description/version/serverUrl/tools[])",
    ),
    checkWellKnownJson(
      AGENT_CARD_PATH,
      agentCardUrl,
      AGENT_CARD_KEYS,
      "A2A agent card (name/description/url-or-supportedInterfaces/version/capabilities/skills[])",
      AGENT_CARD_URL_CHECK,
    ),
  ]);

  return [
    toFinding("cloudflareMcp.mcp-server-card", "mcp-server-card", serverCard),
    toFinding("cloudflareMcp.a2a-agent-card", "a2a-agent-card", agentCard),
  ];
}
