/*
 * agent-readiness-kit MCP Worker entrypoint. Thin, stateless, read-only:
 *   - GET  /.well-known/agent-card.json  — static discovery document
 *   - POST /mcp                          — Streamable HTTP via @modelcontextprotocol/server's
 *                                           createMcpHandler (NOT the deprecated McpAgent — no
 *                                           Durable Object needed; every tool is single-shot).
 * The handler is built per request so a future stateful tool could still capture request-scoped
 * env; today none of the three tools need it. Mirrors
 * `agenthud-agui-a2ui/worker/src/mcp/server.ts` + `src/worker.ts`'s route dispatch, trimmed to
 * this Worker's two routes (no A2A, no proxy, no bindings — see docs/architecture.md).
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { agentCardResponse } from "./wellknown/agent-card";
import {
  runGetLatestScore,
  runGetPlaybook,
  runListProperties,
  propertyIdInputSchema,
  listPropertiesInputSchema,
} from "./mcp/tools";

const SERVER_INFO = { name: "agent-readiness-kit", version: "0.1.0" };

/** Build a fresh stateless McpServer with the three read-only tools registered. */
function buildMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO);
  server.registerTool(
    "get_latest_score",
    {
      title: "Get latest score",
      description:
        "Latest scan score/grade and per-status finding counts for one property, read from " +
        "the committed data/scans/<id>.json. Returns { status: 'no-scan-data', ... } if the " +
        "property is known but hasn't been scanned yet.",
      inputSchema: propertyIdInputSchema,
    },
    runGetLatestScore,
  );
  server.registerTool(
    "get_playbook",
    {
      title: "Get remediation playbook",
      description:
        "Concrete remediation checklist (findings with remediation text) for one property's " +
        "latest committed scan.",
      inputSchema: propertyIdInputSchema,
    },
    runGetPlaybook,
  );
  server.registerTool(
    "list_properties",
    {
      title: "List scanned properties",
      description:
        "Every configured property and whether it has scan data committed yet (with its " +
        "latest score/grade when it does).",
      inputSchema: listPropertiesInputSchema,
    },
    runListProperties,
  );
  return server;
}

// Wildcard CORS: agents may call this read-only, unauthenticated endpoint from any origin.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};

/** Stamp wildcard CORS onto a handler's (possibly streamed) response. */
async function withCors(res: Response | Promise<Response>): Promise<Response> {
  const r = await res;
  const headers = new Headers(r.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/.well-known/agent-card.json") {
      return agentCardResponse(request);
    }

    if (pathname === "/mcp") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (request.method === "POST") {
        return withCors(createMcpHandler(() => buildMcpServer()).fetch(request));
      }
      return Response.json(
        { error: "method_not_allowed", message: "Use POST (JSON-RPC) or OPTIONS." },
        { status: 405, headers: { ...CORS_HEADERS, allow: "POST, OPTIONS" } },
      );
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
};
