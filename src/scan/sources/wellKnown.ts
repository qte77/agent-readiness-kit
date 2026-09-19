/**
 * Discovery/Identity/Execution well-known-URI signals — see
 * `docs/plans/0001-scan-engine.md` row 1 for the fixed signal-id ownership this module
 * implements. Zero runtime dependencies: native `fetch` + `node:dns/promises` only
 * (`docs/architecture.md`'s dependency policy).
 */
import { resolveTxt } from "node:dns/promises";
import type { Finding, Status } from "../../types.js";
import { assignCategory } from "../crosswalk.js";

const NON_TRIVIAL_MIN_LENGTH = 20;

interface ProbeResult {
  /** True if the fetch itself completed (no network-level error), regardless of HTTP status. */
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
}

async function probe(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url);
    const body = await res.text();
    return { ok: true, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function finding(
  signal: string,
  status: Status,
  summary: string,
  remediation?: string,
  evidence?: Record<string, unknown>,
): Finding {
  return {
    id: `wellKnown.${signal}`,
    category: assignCategory(signal),
    source: "wellKnown",
    status,
    summary,
    ...(remediation ? { remediation } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/** Presence + non-trivial-content check for a plain-text well-known file. */
function evaluateTextPresence(
  signal: string,
  path: string,
  result: ProbeResult,
  remediation: string,
  minLength = NON_TRIVIAL_MIN_LENGTH,
): Finding {
  if (!result.ok) {
    return finding(signal, "unknown", `Could not fetch ${path}: ${result.error}`, remediation);
  }
  if (result.status === 404) {
    return finding(signal, "fail", `${path} returned 404 (not found)`, remediation);
  }
  if (result.status !== 200) {
    return finding(signal, "warn", `${path} returned HTTP ${result.status}`, remediation, {
      httpStatus: result.status,
    });
  }
  const trimmed = (result.body ?? "").trim();
  if (trimmed.length < minLength) {
    return finding(signal, "warn", `${path} exists but its content is trivial/empty`, remediation, {
      httpStatus: 200,
      bodyLength: trimmed.length,
    });
  }
  return finding(signal, "pass", `${path} present with non-trivial content`, undefined, {
    httpStatus: 200,
    bodyLength: trimmed.length,
  });
}

/** Presence + valid-JSON check for a well-known JSON endpoint. */
function evaluateJsonPresence(
  signal: string,
  path: string,
  result: ProbeResult,
  remediation: string,
): Finding {
  if (!result.ok) {
    return finding(signal, "unknown", `Could not fetch ${path}: ${result.error}`, remediation);
  }
  if (result.status === 404) {
    return finding(signal, "fail", `${path} returned 404 (not found)`, remediation);
  }
  if (result.status !== 200) {
    return finding(signal, "warn", `${path} returned HTTP ${result.status}`, remediation, {
      httpStatus: result.status,
    });
  }
  try {
    JSON.parse(result.body ?? "");
  } catch {
    return finding(signal, "warn", `${path} returned HTTP 200 but the body is not valid JSON`, remediation, {
      httpStatus: 200,
    });
  }
  return finding(signal, "pass", `${path} present and parses as valid JSON`, undefined, {
    httpStatus: 200,
  });
}

const AI_CATALOG_REMEDIATION =
  "Publish a /.well-known/ard.json per the Agentic Resource Discovery (ARD) v0.91 convention " +
  "(https://agenticresourcediscovery.org/spec/); the legacy /.well-known/ai-catalog.json path " +
  "is still accepted as a fallback but is no longer the spec's canonical name.";

/**
 * `ai-catalog` probes the current ARD spec's canonical `/.well-known/ard.json` path first,
 * falling back to the predecessor spec's `/.well-known/ai-catalog.json` only on a 404 — ARD
 * v0.91 (2026-08-26) still accepts the legacy path for backward compatibility, but no longer
 * treats it as canonical. Signal id is unchanged; only the probed path(s) differ.
 */
async function evaluateAiCatalog(origin: string): Promise<Finding> {
  const ard = await probe(`${origin}/.well-known/ard.json`);
  if (ard.status !== 404) {
    return evaluateJsonPresence("ai-catalog", "/.well-known/ard.json", ard, AI_CATALOG_REMEDIATION);
  }
  const legacy = await probe(`${origin}/.well-known/ai-catalog.json`);
  return evaluateJsonPresence("ai-catalog", "/.well-known/ai-catalog.json", legacy, AI_CATALOG_REMEDIATION);
}

/**
 * `dns-aid` is deliberately never scored pass/fail: as of this writing (2026-09) at least
 * three competing, non-RFC individual IETF drafts define incompatible DNS agent-identity
 * record formats — draft-mozleywilliams-dnsop-dnsaid (Infoblox's "DNS-AID", built on
 * SVCB/DNS-SD/DNSSEC/DANE, not a TXT record), draft-nemethi-aid-agent-identity-discovery
 * ("AID", a `_agent.<domain>` TXT record), and draft-ihsanullah-dnsid ("DNSid"). None has
 * reached RFC status or working-group consensus, so there is no settled/stable format to
 * grade a property against. Per the row-1 task instructions, this emits an `"unknown"`
 * Finding with this note rather than inventing or picking a winner. The `_agent.<domain>`
 * TXT lookup (the one candidate actually using a TXT record, checkable via
 * `node:dns/promises`) is still attempted, best-effort, purely as informational evidence.
 */
const DNS_AID_NOTE =
  "No single settled/stable DNS agent-identity record format exists as of 2026-09: at least " +
  'three competing, non-RFC individual IETF drafts define incompatible mechanisms — ' +
  'draft-mozleywilliams-dnsop-dnsaid (Infoblox\'s "DNS-AID", SVCB/DNS-SD/DNSSEC/DANE-based), ' +
  'draft-nemethi-aid-agent-identity-discovery ("AID", a _agent.<domain> TXT record), and ' +
  'draft-ihsanullah-dnsid ("DNSid"). Not scored pass/fail pending consensus; the ' +
  "_agent.<domain> TXT record (the one candidate using a TXT record) was probed best-effort " +
  "for informational evidence only.";

async function evaluateDnsAid(hostname: string): Promise<Finding> {
  const recordName = `_agent.${hostname}`;
  try {
    const records = await resolveTxt(recordName);
    return finding(
      "dns-aid",
      "unknown",
      `No settled DNS-AID record format to grade against; ${recordName} TXT lookup returned ` +
        `${records.length} record(s), reported informationally only`,
      undefined,
      { note: DNS_AID_NOTE, recordName, txtRecords: records },
    );
  } catch (err) {
    return finding(
      "dns-aid",
      "unknown",
      `No settled DNS-AID record format to grade against; ${recordName} TXT lookup also failed`,
      undefined,
      { note: DNS_AID_NOTE, recordName, lookupError: err instanceof Error ? err.message : String(err) },
    );
  }
}

/**
 * Scan a property for the well-known-URI signals owned by this module (see module docstring).
 * `url` is the property's configured URL (may include a subpath); all well-known/RFC-anchored
 * paths are resolved against its origin, per RFC 8615 / robots.txt convention.
 */
export async function scanWellKnown(url: string): Promise<Finding[]> {
  const { origin, hostname } = new URL(url);

  const [
    llmsTxt,
    agentSkillsIndex,
    apiCatalog,
    authMd,
    oauthProtectedResource,
    oidcDiscovery,
    openapiSpec,
    developersPortal,
  ] = await Promise.all([
    probe(`${origin}/llms.txt`),
    probe(`${origin}/.well-known/agent-skills/index.json`),
    probe(`${origin}/.well-known/api-catalog`),
    probe(`${origin}/auth.md`),
    probe(`${origin}/.well-known/oauth-protected-resource`),
    probe(`${origin}/.well-known/openid-configuration`),
    probe(`${origin}/openapi.json`),
    probe(`${origin}/developers`),
  ]);

  const [dnsAid, aiCatalog] = await Promise.all([evaluateDnsAid(hostname), evaluateAiCatalog(origin)]);

  return [
    evaluateTextPresence(
      "agent-instruction",
      "/llms.txt",
      llmsTxt,
      "Publish a non-trivial /llms.txt at site root describing the site for LLM agents.",
    ),
    aiCatalog,
    evaluateJsonPresence(
      "agent-skills-index",
      "/.well-known/agent-skills/index.json",
      agentSkillsIndex,
      "Publish a /.well-known/agent-skills/index.json listing the site's available agent skills.",
    ),
    evaluateJsonPresence(
      "api-catalog",
      "/.well-known/api-catalog",
      apiCatalog,
      "Publish a /.well-known/api-catalog per RFC 9727.",
    ),
    evaluateTextPresence(
      "auth-md",
      "/auth.md",
      authMd,
      "Publish a non-trivial /auth.md per the WorkOS auth.md convention (https://workos.com/auth-md).",
    ),
    evaluateJsonPresence(
      "oauth-protected-resource",
      "/.well-known/oauth-protected-resource",
      oauthProtectedResource,
      "Publish a /.well-known/oauth-protected-resource per RFC 9728.",
    ),
    evaluateJsonPresence(
      "oauth-oidc-discovery",
      "/.well-known/openid-configuration",
      oidcDiscovery,
      "Publish a /.well-known/openid-configuration per OpenID Connect Discovery 1.0 (a " +
        "related-but-distinct mechanism from RFC 8414's own default " +
        "/.well-known/oauth-authorization-server path).",
    ),
    evaluateJsonPresence(
      "openapi-spec",
      "/openapi.json",
      openapiSpec,
      "Publish a valid /openapi.json describing the site's API surface.",
    ),
    evaluateTextPresence(
      "dev-resource-discovery",
      "/developers",
      developersPortal,
      "Publish a /developers portal page or an equivalent developer-docs entrypoint " +
        "(this is a fuzzy presence/plausibility check, not a strict schema check).",
      100,
    ),
    dnsAid,
  ];
}
