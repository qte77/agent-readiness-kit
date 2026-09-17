import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/scan/sources/wellKnown.js", () => ({ scanWellKnown: vi.fn() }));
vi.mock("../../src/scan/sources/contentSignal.js", () => ({ scanContentSignal: vi.fn() }));
vi.mock("../../src/scan/sources/discoverSnapshot.js", () => ({ discoverSnapshot: vi.fn() }));
vi.mock("../../src/scan/sources/oraAi.js", () => ({ scanOraAi: vi.fn() }));
vi.mock("../../src/scan/sources/isitAgentReady.js", () => ({ scanIsitAgentReady: vi.fn() }));
vi.mock("../../src/scan/sources/cloudflareMcp.js", () => ({ scanCloudflareMcp: vi.fn() }));
vi.mock("../../src/scan/sources/mcpA2aProbe.js", () => ({ scanMcpA2aProbe: vi.fn() }));

import { scanWellKnown } from "../../src/scan/sources/wellKnown.js";
import { scanContentSignal } from "../../src/scan/sources/contentSignal.js";
import { discoverSnapshot } from "../../src/scan/sources/discoverSnapshot.js";
import { scanOraAi } from "../../src/scan/sources/oraAi.js";
import { scanIsitAgentReady } from "../../src/scan/sources/isitAgentReady.js";
import { scanCloudflareMcp } from "../../src/scan/sources/cloudflareMcp.js";
import { scanMcpA2aProbe } from "../../src/scan/sources/mcpA2aProbe.js";
import { scanProperty } from "../../src/scan/orchestrator.js";
import type { Finding } from "../../src/types.js";
import type { PropertyConfig } from "../../config/properties.js";

const PROPERTY: PropertyConfig = {
  id: "test-property",
  url: "https://example.com",
  label: "Example",
};

function makeFinding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    category: "Discovery",
    source: "wellKnown",
    status: "pass",
    summary: `finding ${id}`,
    ...overrides,
  };
}

describe("scanProperty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scanWellKnown).mockResolvedValue([makeFinding("wellKnown.agent-instruction")]);
    vi.mocked(scanContentSignal).mockResolvedValue([
      makeFinding("contentSignal.content-signal", { source: "contentSignal", category: "Trust" }),
    ]);
    vi.mocked(discoverSnapshot).mockResolvedValue([
      makeFinding("discoverSnapshot.schema-type-breadth", {
        source: "discoverSnapshot",
        category: "Content",
      }),
    ]);
    vi.mocked(scanOraAi).mockResolvedValue({
      findings: [makeFinding("oraAi.openapi-spec", { source: "oraAi", category: "Execution" })],
      score: 72,
      grade: "B",
    });
    vi.mocked(scanIsitAgentReady).mockResolvedValue([
      makeFinding("isitAgentReady.agent-readiness-scan", { source: "isitAgentReady", category: "Trust" }),
    ]);
    vi.mocked(scanCloudflareMcp).mockResolvedValue([
      makeFinding("cloudflareMcp.mcp-server-card", { source: "cloudflareMcp", category: "Execution" }),
    ]);
    vi.mocked(scanMcpA2aProbe).mockResolvedValue([
      makeFinding("mcpA2aProbe.a2a-agent-card", { source: "mcpA2aProbe", category: "Agent-to-Agent" }),
    ]);
  });

  it("sets propertyId and url from the property config", async () => {
    const run = await scanProperty(PROPERTY);
    expect(run.propertyId).toBe(PROPERTY.id);
    expect(run.url).toBe(PROPERTY.url);
  });

  it("sets scannedAt to an ISO 8601 timestamp", async () => {
    const run = await scanProperty(PROPERTY);
    expect(new Date(run.scannedAt).toISOString()).toBe(run.scannedAt);
  });

  it("calls every one of the 7 sources exactly once with the property url", async () => {
    await scanProperty(PROPERTY);
    for (const fn of [
      scanWellKnown,
      scanContentSignal,
      discoverSnapshot,
      scanOraAi,
      scanIsitAgentReady,
      scanCloudflareMcp,
      scanMcpA2aProbe,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(PROPERTY.url);
    }
  });

  it("concatenates every source's findings into ScanRun.findings", async () => {
    const run = await scanProperty(PROPERTY);
    const ids = run.findings.map((f) => f.id).sort();
    expect(ids).toEqual(
      [
        "wellKnown.agent-instruction",
        "contentSignal.content-signal",
        "discoverSnapshot.schema-type-breadth",
        "oraAi.openapi-spec",
        "isitAgentReady.agent-readiness-scan",
        "cloudflareMcp.mcp-server-card",
        "mcpA2aProbe.a2a-agent-card",
      ].sort(),
    );
  });

  it("assigns ora.ai's score/grade onto the ScanRun (Design decision 1's special case)", async () => {
    const run = await scanProperty(PROPERTY);
    expect(run.score).toBe(72);
    expect(run.grade).toBe("B");
  });

  it("leaves score/grade undefined when ora.ai's result carries none", async () => {
    vi.mocked(scanOraAi).mockResolvedValue({ findings: [] });
    const run = await scanProperty(PROPERTY);
    expect(run.score).toBeUndefined();
    expect(run.grade).toBeUndefined();
  });

  it("keeps findings that share a signal-id suffix across sources — no cross-source dedup", async () => {
    // wellKnown and oraAi can both legitimately emit an "openapi-spec" finding (Design decision 3);
    // Finding.id (<source>.<signal>) is the uniqueness key, not the bare signal id.
    vi.mocked(scanWellKnown).mockResolvedValue([
      makeFinding("wellKnown.openapi-spec", { source: "wellKnown", category: "Execution" }),
    ]);
    vi.mocked(scanOraAi).mockResolvedValue({
      findings: [makeFinding("oraAi.openapi-spec", { source: "oraAi", category: "Execution" })],
      score: 72,
      grade: "B",
    });

    const run = await scanProperty(PROPERTY);
    const ids = run.findings.map((f) => f.id);
    expect(ids).toContain("wellKnown.openapi-spec");
    expect(ids).toContain("oraAi.openapi-spec");
    expect(ids.filter((id) => id.endsWith("openapi-spec"))).toHaveLength(2);
  });

  it("runs the 7 sources concurrently, not serially", async () => {
    const resolvers: Array<() => void> = [];
    const pendingFindings = (): Promise<Finding[]> =>
      new Promise((resolve) => resolvers.push(() => resolve([])));

    vi.mocked(scanWellKnown).mockImplementation(pendingFindings);
    vi.mocked(scanContentSignal).mockImplementation(pendingFindings);
    vi.mocked(discoverSnapshot).mockImplementation(pendingFindings);
    vi.mocked(scanOraAi).mockImplementation(
      () => new Promise((resolve) => resolvers.push(() => resolve({ findings: [] }))),
    );
    vi.mocked(scanIsitAgentReady).mockImplementation(pendingFindings);
    vi.mocked(scanCloudflareMcp).mockImplementation(pendingFindings);
    vi.mocked(scanMcpA2aProbe).mockImplementation(pendingFindings);

    const runPromise = scanProperty(PROPERTY);
    await Promise.resolve();
    await Promise.resolve();

    // A serial implementation (await one source, then the next) would only have invoked the
    // first source by now, since none of these mocks ever resolve on their own. A concurrent
    // (Promise.all-style) fan-out invokes all 7 before awaiting any of them.
    expect(scanWellKnown).toHaveBeenCalledTimes(1);
    expect(scanContentSignal).toHaveBeenCalledTimes(1);
    expect(discoverSnapshot).toHaveBeenCalledTimes(1);
    expect(scanOraAi).toHaveBeenCalledTimes(1);
    expect(scanIsitAgentReady).toHaveBeenCalledTimes(1);
    expect(scanCloudflareMcp).toHaveBeenCalledTimes(1);
    expect(scanMcpA2aProbe).toHaveBeenCalledTimes(1);

    resolvers.forEach((resolve) => resolve());
    await runPromise;
  });
});
