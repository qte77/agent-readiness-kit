/**
 * Signal -> Category crosswalk, seeded verbatim from the "Crosswalk — hackathon category x
 * ora.ai signal x Cloudflare signal" table in
 * `agenthud-agui-a2ui/docs/agent-readiness.md` (read at source, not invented here).
 *
 * That table is the single source of truth for the mapping; this module only encodes it
 * as lookups so scan sources can call `assignCategory(signal)` instead of hardcoding
 * category strings. If the upstream table changes, update SIGNAL_TO_CATEGORY to match —
 * do not fork/duplicate the table's prose elsewhere in this repo.
 */
import type { Category } from "../types.js";

/**
 * Known signal ids, normalized to kebab-case, keyed to the Category column of the
 * upstream crosswalk table. Only signals explicitly listed in that table are included;
 * ambiguous ones (e.g. bare "robots.txt" appears under both Discovery's Cloudflare
 * column and Trust's ora.ai column, depending on whether presence or AI-crawler-policy
 * content is being checked) are deliberately left out until a scan source disambiguates
 * them by its own more specific signal id.
 */
const SIGNAL_TO_CATEGORY: Record<string, Category> = {
  // Discovery
  "dev-resource-discovery": "Discovery",
  "agent-instruction": "Discovery",
  "ai-catalog": "Discovery",
  "agent-skills-index": "Discovery",
  "dns-aid": "Discovery",
  "api-catalog": "Discovery",

  // Content
  "schema-type-breadth": "Content",
  "markdown-twins": "Content",
  "markdown-negotiation": "Content",

  // Trust
  "content-signal": "Trust",
  "bot-rules": "Trust",
  "web-bot-auth": "Trust",

  // Execution
  "openapi-spec": "Execution",
  "mcp-server-card": "Execution",

  // Agent-to-Agent
  "a2a-agent-card": "Agent-to-Agent",

  // Identity & Auth
  "auth-md": "Identity & Auth",
  "oauth-protected-resource": "Identity & Auth",
  "oauth-oidc-discovery": "Identity & Auth",
};

/**
 * Resolve a signal id to its hackathon Category per the upstream crosswalk table.
 * Throws on an unregistered signal rather than guessing — add it to
 * SIGNAL_TO_CATEGORY (citing the upstream table) instead of silently defaulting.
 */
export function assignCategory(signal: string): Category {
  const category = SIGNAL_TO_CATEGORY[signal];
  if (!category) {
    throw new Error(
      `assignCategory: unknown signal "${signal}" — not in the agent-readiness crosswalk ` +
        `(agenthud-agui-a2ui/docs/agent-readiness.md). Add it there first, then here.`,
    );
  }
  return category;
}

export { SIGNAL_TO_CATEGORY };
