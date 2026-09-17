import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanIsitAgentReady } from "../../../src/scan/sources/isitAgentReady.js";
import type { Finding } from "../../../src/types.js";

const ENDPOINT = "https://isitagentready.com/api/scan";
const PROPERTY_URL = "https://qte77.github.io";

/** `noUncheckedIndexedAccess` makes `findings[0]` possibly-undefined; this asserts the
 * single-Finding contract every case in this suite relies on, instead of `!`-asserting
 * at every call site. */
function onlyFinding(findings: Finding[]): Finding {
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  if (!finding) throw new Error("expected exactly one finding");
  return finding;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function realisticChecks() {
  return {
    discoverability: {
      robotsTxt: {
        status: "pass",
        message: "robots.txt found and permissive",
        evidence: [{ action: "fetch", label: "GET /robots.txt", request: {}, response: {}, finding: "ok" }],
        durationMs: 42,
      },
      sitemap: { status: "pass", message: "sitemap.xml found", evidence: [], durationMs: 10 },
    },
    content: { markdown: { status: "warn", message: "no markdown twin", evidence: [], durationMs: 5 } },
    botAccessControl: { userAgent: { status: "pass", message: "no bot blocking", evidence: [], durationMs: 3 } },
    discovery: { agentCard: { status: "fail", message: "no agent card", evidence: [], durationMs: 2 } },
    commerce: {},
  };
}

function realisticBody(level: number, levelName: string) {
  return {
    url: PROPERTY_URL,
    targetUrl: PROPERTY_URL,
    scannedAt: "2026-09-17T00:00:00.000Z",
    level,
    levelName,
    checks: realisticChecks(),
  };
}

describe("scanIsitAgentReady", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls POST /api/scan with a JSON { url } body and no auth headers", async () => {
    fetchMock.mockResolvedValue(jsonResponse(realisticBody(5, "Agent-Integrated")));

    await scanIsitAgentReady(PROPERTY_URL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ url: PROPERTY_URL });
  });

  it("returns exactly one Finding", async () => {
    fetchMock.mockResolvedValue(jsonResponse(realisticBody(5, "Agent-Integrated")));

    const findings = await scanIsitAgentReady(PROPERTY_URL);

    expect(findings).toHaveLength(1);
  });

  describe("status derived from level", () => {
    it.each([
      [5, "Agent-Integrated", "pass"],
      [4, "Bot-Aware", "pass"],
      [3, "Bot-Aware", "warn"],
      [2, "Discoverable", "warn"],
      [1, "Minimal", "fail"],
      [0, "None", "fail"],
    ] as const)("level %i (%s) -> %s", async (level, levelName, expectedStatus) => {
      fetchMock.mockResolvedValue(jsonResponse(realisticBody(level, levelName)));

      const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

      expect(finding.status).toBe(expectedStatus);
    });
  });

  it("emits the correct id, source, and category", async () => {
    fetchMock.mockResolvedValue(jsonResponse(realisticBody(5, "Agent-Integrated")));

    const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

    expect(finding.id).toBe("isitAgentReady.agent-readiness-scan");
    expect(finding.source).toBe("isitAgentReady");
    expect(finding.category).toBe("Trust");
  });

  it("summary mentions the level, levelName, and property url", async () => {
    fetchMock.mockResolvedValue(jsonResponse(realisticBody(3, "Bot-Aware")));

    const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

    expect(finding.summary).toContain("3");
    expect(finding.summary).toContain("Bot-Aware");
    expect(finding.summary).toContain(PROPERTY_URL);
  });

  it("attaches the full checks object plus level/levelName/scannedAt as evidence verbatim", async () => {
    const body = realisticBody(2, "Discoverable");
    fetchMock.mockResolvedValue(jsonResponse(body));

    const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

    expect(finding.evidence?.["checks"]).toEqual(body.checks);
    expect(finding.evidence?.["level"]).toBe(2);
    expect(finding.evidence?.["levelName"]).toBe("Discoverable");
    expect(finding.evidence?.["scannedAt"]).toBe(body.scannedAt);
  });

  it("does not fan sub-checks out into separate Findings", async () => {
    fetchMock.mockResolvedValue(jsonResponse(realisticBody(1, "Minimal")));

    const findings = await scanIsitAgentReady(PROPERTY_URL);

    expect(findings.map((f) => f.id)).toEqual(["isitAgentReady.agent-readiness-scan"]);
  });

  it("returns an unknown-status Finding on a network failure, never throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

    expect(finding.status).toBe("unknown");
    expect(finding.source).toBe("isitAgentReady");
    expect(finding.summary.length).toBeGreaterThan(0);
  });

  it("returns an unknown-status Finding on a non-200 response", async () => {
    fetchMock.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

    expect(finding.status).toBe("unknown");
  });

  it("returns an unknown-status Finding when the response body is not valid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));

    const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

    expect(finding.status).toBe("unknown");
  });

  it("returns an unknown-status Finding when the response has an unexpected shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ url: PROPERTY_URL, level: "not-a-number" }));

    const finding = onlyFinding(await scanIsitAgentReady(PROPERTY_URL));

    expect(finding.status).toBe("unknown");
  });
});
