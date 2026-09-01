import { describe, expect, it } from "vitest";
import { assignCategory } from "../src/scan/crosswalk.js";
import { CATEGORIES } from "../src/types.js";
import type { Finding, ScanRun } from "../src/types.js";

describe("Finding", () => {
  it("constructs with required fields and optional remediation/evidence", () => {
    const finding: Finding = {
      id: "wellKnown.agent-card-json",
      category: "Discovery",
      source: "wellKnown",
      status: "fail",
      summary: "GET /.well-known/agent-card.json returned 404",
      remediation: "Publish an A2A agent card at /.well-known/agent-card.json",
      evidence: { httpStatus: 404 },
    };

    expect(finding.status).toBe("fail");
    expect(finding.category).toBe("Discovery");
    expect(CATEGORIES).toContain(finding.category);
  });
});

describe("ScanRun", () => {
  it("aggregates findings for one property with an ISO timestamp", () => {
    const findings: Finding[] = [
      {
        id: "oraAi.openapi-spec",
        category: "Execution",
        source: "oraAi",
        status: "pass",
        summary: "/openapi.json resolves and is valid OpenAPI 3.1",
      },
    ];
    const run: ScanRun = {
      propertyId: "qte77-github-io",
      url: "https://qte77.github.io",
      scannedAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
      findings,
      score: 56,
      grade: "C",
    };

    expect(run.findings).toHaveLength(1);
    expect(run.scannedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(run.findings[0]?.category).toBe("Execution");
  });
});

describe("assignCategory", () => {
  it.each([
    ["dev-resource-discovery", "Discovery"],
    ["agent-instruction", "Discovery"],
    ["schema-type-breadth", "Content"],
    ["markdown-twins", "Content"],
    ["content-signal", "Trust"],
    ["openapi-spec", "Execution"],
    ["mcp-server-card", "Execution"],
    ["a2a-agent-card", "Agent-to-Agent"],
    ["auth-md", "Identity & Auth"],
    ["oauth-protected-resource", "Identity & Auth"],
  ] as const)("maps %s -> %s per the upstream crosswalk table", (signal, category) => {
    expect(assignCategory(signal)).toBe(category);
  });

  it("throws on an unregistered signal instead of guessing", () => {
    expect(() => assignCategory("not-a-real-signal")).toThrow(/unknown signal/);
  });
});
