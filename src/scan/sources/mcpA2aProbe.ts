/**
 * Live A2A protocol probe — the second half of the `a2a-agent-card` signal
 * (Agent-to-Agent category, `src/scan/crosswalk.ts`).
 *
 * `cloudflareMcp.ts` checks the static presence/shape of `/.well-known/agent-card.json`.
 * This module re-fetches that card (module independence — no cross-module Finding passing,
 * per architecture.md; the orchestrator merges each source's Finding[] independently),
 * reads its declared service endpoint (`url`, or `supportedInterfaces[]`'s JSONRPC-binding
 * entry), and attempts a minimal JSON-RPC 2.0 `SendMessage` round trip against it (A2A
 * protocol spec, a2a-protocol.org/v1.0.0/specification — verified at source 2026-09-21). A
 * live round trip that returns a well-formed `result` upgrades the static "file exists" pass to a
 * stronger pass; an unreachable/non-conformant endpoint downgrades to fail/warn. Both
 * Findings share the same crosswalk signal id (`a2a-agent-card`) but are distinct entries
 * (source-prefixed `id`) — see `cloudflareMcp.ts` for the static half.
 */
import { assignCategory } from "../crosswalk.js";
import type { Finding } from "../../types.js";

const AGENT_CARD_PATH = "/.well-known/agent-card.json";
const FINDING_ID = "mcpA2aProbe.a2a-agent-card";
const SIGNAL_ID = "a2a-agent-card";

function buildMessageSendRequest(): unknown {
  return {
    jsonrpc: "2.0",
    id: "agent-readiness-kit-probe",
    method: "SendMessage",
    params: {
      message: {
        role: "ROLE_USER",
        parts: [{ text: "agent-readiness-kit readiness probe" }],
        messageId: "agent-readiness-kit-probe-message",
      },
    },
  };
}

/**
 * v1.0.0 dropped AgentCard's flat `url` in favor of `supportedInterfaces[]` (each entry
 * naming a `protocolBinding` + its own `url`). Accept either shape: a real card may still
 * be the legacy v0.3.0 flat-`url` form, or the new interfaces array with a JSONRPC entry.
 */
function extractEndpoint(cardBody: unknown): string | undefined {
  if (typeof cardBody !== "object" || cardBody === null) return undefined;
  const record = cardBody as Record<string, unknown>;

  const url = record["url"];
  if (typeof url === "string" && url.length > 0) return url;

  const interfaces = record["supportedInterfaces"];
  if (Array.isArray(interfaces) && interfaces.length > 0) {
    const jsonRpcInterface = interfaces.find((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const binding = (entry as Record<string, unknown>)["protocolBinding"];
      return typeof binding === "string" && binding.toLowerCase() === "jsonrpc";
    }) as Record<string, unknown> | undefined;
    const jsonRpcUrl = jsonRpcInterface?.["url"];
    if (typeof jsonRpcUrl === "string" && jsonRpcUrl.length > 0) return jsonRpcUrl;
  }

  return undefined;
}

function isJsonRpcResult(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  return record["jsonrpc"] === "2.0" && "result" in record;
}

function isJsonRpcError(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  return record["jsonrpc"] === "2.0" && "error" in record;
}

function finding(
  status: Finding["status"],
  summary: string,
  remediation?: string,
  evidence: Record<string, unknown> = {},
): Finding {
  return {
    id: FINDING_ID,
    category: assignCategory(SIGNAL_ID),
    source: "mcpA2aProbe",
    status,
    summary,
    ...(remediation !== undefined ? { remediation } : {}),
    evidence,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function scanMcpA2aProbe(baseUrl: string): Promise<Finding[]> {
  const agentCardUrl = new URL(AGENT_CARD_PATH, baseUrl).toString();

  let cardBody: unknown;
  try {
    const cardResponse = await fetch(agentCardUrl);
    if (!cardResponse.ok) {
      return [
        finding(
          "unknown",
          `GET ${AGENT_CARD_PATH} returned ${cardResponse.status}; skipping live A2A probe`,
        ),
      ];
    }
    cardBody = await cardResponse.json();
  } catch (cause) {
    return [
      finding(
        "unknown",
        `Could not fetch ${AGENT_CARD_PATH}: ${errorMessage(cause)}; skipping live A2A probe`,
      ),
    ];
  }

  const endpoint = extractEndpoint(cardBody);

  if (endpoint === undefined) {
    return [
      finding(
        "unknown",
        `${AGENT_CARD_PATH} has no usable "url" or "supportedInterfaces" field; skipping live A2A probe`,
      ),
    ];
  }

  let probeResponse: Response;
  try {
    probeResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildMessageSendRequest()),
    });
  } catch (cause) {
    return [
      finding(
        "fail",
        `POST SendMessage to ${endpoint} failed: ${errorMessage(cause)}`,
        `Ensure the A2A endpoint declared in ${AGENT_CARD_PATH} (resolved to "${endpoint}") accepts a JSON-RPC 2.0 SendMessage request.`,
        { endpoint },
      ),
    ];
  }

  if (probeResponse.status === 401 || probeResponse.status === 403) {
    return [
      finding(
        "warn",
        `POST SendMessage to ${endpoint} returned ${probeResponse.status} — endpoint is reachable but requires auth this unauthenticated probe cannot provide`,
        `Confirm the auth flow declared in the agent card's securitySchemes lets a legitimate A2A client reach ${endpoint}; an unauthenticated probe cannot verify full protocol conformance behind auth.`,
        { endpoint, httpStatus: probeResponse.status },
      ),
    ];
  }

  if (!probeResponse.ok) {
    return [
      finding(
        "fail",
        `POST SendMessage to ${endpoint} returned ${probeResponse.status}`,
        `Ensure the A2A endpoint declared in ${AGENT_CARD_PATH} handles SendMessage and returns a successful JSON-RPC 2.0 response.`,
        { endpoint, httpStatus: probeResponse.status },
      ),
    ];
  }

  let probeBody: unknown;
  try {
    probeBody = await probeResponse.json();
  } catch {
    return [
      finding(
        "fail",
        `POST SendMessage to ${endpoint} returned ${probeResponse.status} but the body is not valid JSON`,
        `Ensure the A2A endpoint returns a valid JSON-RPC 2.0 response body.`,
        { endpoint, httpStatus: probeResponse.status },
      ),
    ];
  }

  if (isJsonRpcResult(probeBody)) {
    return [
      finding(
        "pass",
        `Live SendMessage round trip against ${endpoint} succeeded`,
        undefined,
        { endpoint, httpStatus: probeResponse.status },
      ),
    ];
  }

  if (isJsonRpcError(probeBody)) {
    return [
      finding(
        "warn",
        `${endpoint} speaks JSON-RPC 2.0 but SendMessage returned an error response`,
        `Investigate the SendMessage error at ${endpoint} — the endpoint responds correctly to JSON-RPC but this probe call did not succeed.`,
        { endpoint, httpStatus: probeResponse.status, body: probeBody },
      ),
    ];
  }

  return [
    finding(
      "fail",
      `${endpoint} returned ${probeResponse.status} but the body is not a recognizable JSON-RPC 2.0 SendMessage response`,
      `Ensure the endpoint declared in ${AGENT_CARD_PATH} implements A2A's SendMessage per the JSON-RPC 2.0 result/error shape.`,
      { endpoint, httpStatus: probeResponse.status, body: probeBody },
    ),
  ];
}
