import { describe, expect, it } from "vitest";
import { SIGNAL_TO_CATEGORY } from "../src/scan/crosswalk.js";
import { REMEDIATION_BY_SIGNAL, remediationFor } from "../src/playbook.js";
import type { Finding } from "../src/types.js";

describe("REMEDIATION_BY_SIGNAL coverage", () => {
  it("has an entry for every signal id in the crosswalk", () => {
    for (const id of Object.keys(SIGNAL_TO_CATEGORY)) {
      expect(REMEDIATION_BY_SIGNAL).toHaveProperty(id);
    }
  });
});

describe("remediationFor", () => {
  it("prefers the source module's own remediation over any template, regardless of status", () => {
    const finding: Finding = {
      id: "wellKnown.api-catalog",
      category: "Discovery",
      source: "wellKnown",
      status: "fail",
      summary: "no /.well-known/api-catalog found",
      remediation: "Custom text supplied by the source module itself",
    };
    expect(remediationFor(finding)).toBe("Custom text supplied by the source module itself");
  });

  it("returns a no-action-needed message for a pass with no remediation supplied", () => {
    const finding: Finding = {
      id: "wellKnown.robots-txt",
      category: "Trust",
      source: "wellKnown",
      status: "pass",
      summary: "robots.txt present and valid",
    };
    expect(remediationFor(finding)).toBe("No action needed — robots.txt present and valid");
  });

  it("falls back to an honest generic message for an unmatched id (no invented specificity)", () => {
    const finding: Finding = {
      id: "someFutureSource.totally-new-signal",
      category: "Discovery",
      source: "wellKnown",
      status: "warn",
      summary: "not yet classified",
    };
    const result = remediationFor(finding);
    expect(result).toContain("someFutureSource.totally-new-signal");
    expect(result).toContain("Discovery");
    expect(result).toContain("wellKnown");
    expect(result).toContain("warn");
    expect(Object.values(REMEDIATION_BY_SIGNAL)).not.toContain(result);
  });

  // One fixture per category, each with a differently-delimited id convention, proving the
  // match is a generic substring check rather than coupled to one source module's `id` shape.
  const PER_CATEGORY_FIXTURES: ReadonlyArray<{ finding: Finding; signal: string }> = [
    {
      finding: {
        id: "wellKnown.dev-resource-discovery",
        category: "Discovery",
        source: "wellKnown",
        status: "fail",
        summary: "dev-resource-discovery check failed",
      },
      signal: "dev-resource-discovery",
    },
    {
      finding: {
        id: "contentSignal:markdown-negotiation",
        category: "Content",
        source: "contentSignal",
        status: "fail",
        summary: "markdown-negotiation check failed",
      },
      signal: "markdown-negotiation",
    },
    {
      finding: {
        id: "wellKnown/content-signal",
        category: "Trust",
        source: "wellKnown",
        status: "fail",
        summary: "content-signal check failed",
      },
      signal: "content-signal",
    },
    {
      finding: {
        id: "oraAi.openapi-spec",
        category: "Execution",
        source: "oraAi",
        status: "fail",
        summary: "openapi-spec check failed",
      },
      signal: "openapi-spec",
    },
    {
      finding: {
        id: "mcpA2aProbe#a2a-agent-card",
        category: "Agent-to-Agent",
        source: "mcpA2aProbe",
        status: "fail",
        summary: "a2a-agent-card check failed",
      },
      signal: "a2a-agent-card",
    },
    {
      finding: {
        id: "cloudflareMcp.oauth-protected-resource",
        category: "Identity & Auth",
        source: "cloudflareMcp",
        status: "fail",
        summary: "oauth-protected-resource check failed",
      },
      signal: "oauth-protected-resource",
    },
  ];

  it.each(PER_CATEGORY_FIXTURES)(
    "matches a $finding.category finding ($finding.id) to its signal template regardless of id delimiter style",
    ({ finding, signal }) => {
      expect(remediationFor(finding)).toBe(REMEDIATION_BY_SIGNAL[signal]);
    },
  );
});
