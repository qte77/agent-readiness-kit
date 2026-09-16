import { afterEach, describe, expect, it, vi } from "vitest";
import { runGetLatestScore, runGetPlaybook, runListProperties } from "../src/mcp/tools";
import { PROPERTIES } from "../../config/properties";

const KNOWN_ID = PROPERTIES[0]!.id;
const OTHER_ID = PROPERTIES[1]!.id;

const SAMPLE_SCAN = {
  propertyId: KNOWN_ID,
  url: PROPERTIES[0]!.url,
  scannedAt: "2026-09-15T00:00:00.000Z",
  score: 72,
  grade: "B",
  findings: [
    {
      id: "wellKnown.agent-card-json",
      category: "Discovery",
      source: "wellKnown",
      status: "fail",
      summary: "No /.well-known/agent-card.json found.",
      remediation: "Publish a static agent-card.json describing this site's capabilities.",
    },
    {
      id: "wellKnown.robots-txt",
      category: "Discovery",
      source: "wellKnown",
      status: "pass",
      summary: "robots.txt is present.",
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runGetLatestScore", () => {
  it("returns score/grade/scannedAt and finding counts when scan data exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(SAMPLE_SCAN)),
    );

    const res = await runGetLatestScore({ propertyId: KNOWN_ID });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      propertyId: KNOWN_ID,
      status: "ok",
      score: 72,
      grade: "B",
      scannedAt: "2026-09-15T00:00:00.000Z",
      findingCounts: { pass: 1, fail: 1, warn: 0, unknown: 0 },
    });
  });

  it("reports no-scan-data (not an error) when the scan file 404s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );

    const res = await runGetLatestScore({ propertyId: OTHER_ID });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      propertyId: OTHER_ID,
      status: "no-scan-data",
    });
  });

  it("flags an unknown propertyId as a tool error without ever calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await runGetLatestScore({ propertyId: "does-not-exist" });

    expect(res.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a fetch/network failure as a fetch-error status, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const res = await runGetLatestScore({ propertyId: KNOWN_ID });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      propertyId: KNOWN_ID,
      status: "fetch-error",
      message: "network down",
    });
  });
});

describe("runGetPlaybook", () => {
  it("returns only findings that carry remediation text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(SAMPLE_SCAN)),
    );

    const res = await runGetPlaybook({ propertyId: KNOWN_ID });

    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe("wellKnown.agent-card-json");
  });

  it("returns an empty checklist with a message when no scan has run yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );

    const res = await runGetPlaybook({ propertyId: KNOWN_ID });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ status: "no-scan-data", items: [] });
  });

  it("flags an unknown propertyId as a tool error", async () => {
    const res = await runGetPlaybook({ propertyId: "does-not-exist" });
    expect(res.isError).toBe(true);
  });
});

describe("runListProperties", () => {
  it("reports hasScanData per property based on which fetches 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith(`${KNOWN_ID}.json`)
          ? jsonResponse(SAMPLE_SCAN)
          : new Response("Not Found", { status: 404 });
      }),
    );

    const res = await runListProperties();

    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as {
      properties: Array<{ id: string; hasScanData: boolean; score?: number }>;
    };
    expect(body.properties).toHaveLength(PROPERTIES.length);
    const known = body.properties.find((p) => p.id === KNOWN_ID);
    expect(known?.hasScanData).toBe(true);
    expect(known?.score).toBe(72);
    const other = body.properties.find((p) => p.id === OTHER_ID);
    expect(other?.hasScanData).toBe(false);
  });
});
