/*
 * Static Agent Card served at GET /.well-known/agent-card.json (public discovery document —
 * wildcard CORS, no auth). Skills map 1:1 to this Worker's three MCP tools; `url` points at the
 * live POST /mcp endpoint on this same Worker origin. Mirrors
 * `agenthud-agui-a2ui/worker/src/wellknown/agent-card.ts`'s shape, trimmed to this Worker's
 * MCP-only surface (no A2A endpoint here).
 */

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  url: string;
  preferredTransport: string;
  documentationUrl: string;
  provider: { organization: string; url: string };
  capabilities: { streaming: boolean; pushNotifications: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}

const REPO_URL = "https://github.com/qte77/agent-readiness-kit";

/** Build the agent card, pointing its MCP interface at `${selfOrigin}/mcp` (this Worker). */
export function buildAgentCard(selfOrigin: string): AgentCard {
  return {
    protocolVersion: "0.3.0",
    name: "agent-readiness-kit",
    description:
      "Read-only MCP projection of agent-native-readiness scan results for qte77-owned " +
      "properties. Every tool call reads the already-committed data/scans/<id>.json off " +
      "raw.githubusercontent.com — this Worker runs no scanning logic itself.",
    version: "0.1.0",
    url: `${selfOrigin}/mcp`,
    preferredTransport: "MCP",
    documentationUrl: REPO_URL,
    provider: { organization: "qte77", url: REPO_URL },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "get_latest_score",
        name: "Get latest score",
        description:
          "Return the latest scan score/grade and finding counts for one property, from the " +
          "committed data/scans/<id>.json.",
        tags: ["scan", "score", "readiness"],
      },
      {
        id: "get_playbook",
        name: "Get remediation playbook",
        description:
          "Return the concrete remediation checklist (findings with remediation text) for one " +
          "property's latest scan.",
        tags: ["scan", "remediation", "playbook"],
      },
      {
        id: "list_properties",
        name: "List scanned properties",
        description:
          "List the configured properties and whether each has scan data committed yet.",
        tags: ["scan", "properties"],
      },
    ],
  };
}

/** 200 JSON response for the well-known card route, derived from the request's own origin. */
export function agentCardResponse(request: Request): Response {
  const card = buildAgentCard(new URL(request.url).origin);
  return new Response(JSON.stringify(card, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  });
}
