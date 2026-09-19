/**
 * Maps a Finding to concrete, actionable remediation text — "the point of this tool is not
 * just a score" (see README.md / src/types.ts's `Finding.remediation` doc comment).
 *
 * This module works generically off `Finding`'s public shape (id/category/source/status/
 * summary/remediation?/evidence?) only — it never depends on any one
 * `src/scan/sources/*.ts` module's actual output, since five of those are being built in
 * parallel (see docs/plans/0001-scan-engine.md row 7). `Finding.id` is documented as a
 * "stable identifier" but each source module picks its own convention (e.g.
 * `"wellKnown.agent-card-json"`, `"oraAi.openapi-spec"` — see test/types.test.ts), so the
 * signal match below is a best-effort substring check, not a strict `<source>.<signal>` parse.
 *
 * Precedence:
 *   1. `finding.remediation`, when the source module supplied one — it saw the actual
 *      response and always has more context than a generic template.
 *   2. `status: "pass"` with no `remediation` given -> a short no-action-needed message.
 *   3. A signal-specific template from REMEDIATION_BY_SIGNAL, matched by checking whether
 *      `finding.id` contains one of the crosswalk's known signal ids as a substring.
 *   4. A generic, honest fallback naming the category/id/source/status — never fabricates
 *      specificity we don't have.
 */
import type { Finding } from "./types.js";

/**
 * Concrete remediation text per known crosswalk signal id (src/scan/crosswalk.ts). Grounded
 * in the upstream crosswalk table (`agenthud-agui-a2ui/docs/agent-readiness.md`'s "Crosswalk"
 * and "Next steps" sections, read at source) and issue #4's worked examples for
 * markdown-negotiation/content-signal/api-catalog/openapi-spec, plus verified specs for the
 * rest (RFC 9727 api-catalog, RFC 9728 oauth-protected-resource, RFC 9421 + the IETF
 * webbotauth working group's draft-ietf-webbotauth-httpsig-protocol, the AID DNS spec,
 * Cloudflare's Content Signals policy, OpenID Connect Discovery). Where the upstream doc
 * itself flags a schema as "emerging" /
 * "verify at source" (ai-catalog.json, agent-skills/index.json, mcp/server-card.json), this
 * table carries that caveat forward rather than presenting it as settled.
 *
 * Keep this in sync with `SIGNAL_TO_CATEGORY` in src/scan/crosswalk.ts — the coverage test in
 * test/playbook.test.ts fails if a crosswalk signal has no entry here.
 */
const REMEDIATION_BY_SIGNAL: Record<string, string> = {
  // Discovery
  "dev-resource-discovery":
    "Publish (or extend) llms.txt at the site root with a resources section linking to docs, " +
    "API references, and SDKs, so an agent can find them without guessing paths. Verify every " +
    "linked URL actually resolves — a dead link here is an active scoring penalty.",
  "agent-instruction":
    "Publish (or extend) llms.txt with a plain-language instructions section for autonomous " +
    "agents: what they may do on this site, any rate limits, and where to find deeper docs.",
  "ai-catalog":
    "Publish /.well-known/ard.json (the Agentic Resource Discovery manifest) listing the " +
    "site's agent-facing capabilities; /.well-known/ai-catalog.json is still accepted as a " +
    "legacy fallback. This schema is still emerging — verify its current shape at source " +
    "before publishing rather than copying an old example.",
  "agent-skills-index":
    "Publish /.well-known/agent-skills/index.json listing discrete, invocable skills the site " +
    "exposes to agents, each with a stable id and description. Verify the current schema at " +
    "source before publishing — it's an emerging convention, not a ratified spec.",
  "dns-aid":
    "Publish a DNS TXT record at _agent.<domain> per the AID (Agent Identity & Discovery) " +
    "spec, so agents can resolve the site's agent endpoint and protocol via DNS instead of " +
    "crawling for it.",
  "api-catalog":
    "Publish a /.well-known/api-catalog file per RFC 9727 listing the site's machine-readable " +
    "APIs (OpenAPI/AsyncAPI docs) so agents can discover them without guessing paths.",

  // Content
  "schema-type-breadth":
    "Widen JSON-LD coverage beyond what's already there — add FAQPage and Organization (with " +
    "contactPoint/address) alongside any existing types, so agents can extract structured " +
    "contact/organization facts, not just page-level metadata.",
  "markdown-twins":
    'Publish a markdown twin per page (e.g. /index.md for /) and add <link rel="alternate" ' +
    'type="text/markdown"> in <head>, so agents can discover the twin without guessing the URL.',
  "markdown-negotiation":
    "Add content negotiation that serves the markdown twin when the request's Accept header " +
    "or user agent indicates a non-browser/agent client, instead of requiring callers to " +
    "already know the separate .md URL.",

  // Trust
  "content-signal":
    "Add a Content-Signal directive line to robots.txt (e.g. `Content-Signal: search=yes, " +
    "ai-train=no`) declaring AI-training/search/inference usage preferences, per Cloudflare's " +
    "Content Signals policy.",
  "bot-rules":
    "Publish explicit per-user-agent allow/disallow rules in robots.txt for known agent " +
    "crawlers, instead of relying on a bare `User-agent: *` block.",
  "web-bot-auth":
    "Adopt Web Bot Auth (HTTP Message Signatures per RFC 9421, the IETF webbotauth working " +
    "group's draft-ietf-webbotauth-httpsig-protocol) so verified agent crawlers can " +
    "authenticate cryptographically instead of relying on spoofable user-agent strings.",

  // Execution
  "openapi-spec":
    "Publish a valid /openapi.json (OpenAPI 3.1) describing the site's callable endpoints, so " +
    "agents can generate typed calls instead of scraping HTML.",
  "mcp-server-card":
    "Publish /.well-known/mcp/server-card.json (name/description/version/serverUrl/tools[]) " +
    "describing the MCP server. Verify the current schema at source before publishing — it's " +
    "an emerging convention, not a ratified spec.",

  // Agent-to-Agent
  "a2a-agent-card":
    "Publish an A2A agent card at /.well-known/agent-card.json describing this property as an " +
    "addressable agent (name, skills, endpoint) per the Agent-to-Agent protocol.",

  // Identity & Auth
  "auth-md":
    "Publish /auth.md documenting how agents authenticate, structured as Discover -> Pick a " +
    "method -> Register -> Claim -> Use -> Errors -> Revocation.",
  "oauth-protected-resource":
    "Publish an OAuth 2.0 Protected Resource Metadata document at " +
    "/.well-known/oauth-protected-resource per RFC 9728 so agents can discover the " +
    "authorization server for this resource.",
  "oauth-oidc-discovery":
    "Publish OpenID Connect Discovery metadata at /.well-known/openid-configuration so agents " +
    "can auto-configure OAuth/OIDC flows instead of hardcoding endpoints.",
};

// Longest signal id first, so a signal id that's a substring of another stays resolvable to
// the more specific match if a future crosswalk addition introduces one (see crosswalk.ts's
// own note on ambiguous bare signal ids).
const REMEDIATION_ENTRIES = Object.entries(REMEDIATION_BY_SIGNAL).sort(
  (a, b) => b[0].length - a[0].length,
);

function matchSignal(findingId: string): string | undefined {
  return REMEDIATION_ENTRIES.find(([signal]) => findingId.includes(signal))?.[1];
}

/** Concrete remediation text for a single Finding. Never throws. */
export function remediationFor(finding: Finding): string {
  if (finding.remediation) {
    return finding.remediation;
  }
  if (finding.status === "pass") {
    return `No action needed — ${finding.summary}`;
  }
  const matched = matchSignal(finding.id);
  if (matched) {
    return matched;
  }
  return (
    `No remediation guidance available yet for "${finding.id}" (${finding.category}, via ` +
    `${finding.source}, status: ${finding.status}). ${finding.summary} See ` +
    "docs/architecture.md and the crosswalk in agenthud-agui-a2ui/docs/agent-readiness.md."
  );
}

export { REMEDIATION_BY_SIGNAL };
