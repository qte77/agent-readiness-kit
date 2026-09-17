import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanOraAi } from "../../../src/scan/sources/oraAi.js";

const URL_UNDER_TEST = "https://qte77.github.io";
const SCAN_ENDPOINT = "https://ora.ai/api/scan";
const SCORE_ENDPOINT = `https://ora.ai/api/score/${encodeURIComponent(URL_UNDER_TEST)}`;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Trimmed, realistic fixture — a subset of an actual `GET /api/score/<url>` response
 * captured live against https://qte77.github.io while implementing this module
 * (2026-09-17, GET-only, doesn't consume the scan-family rate limit). Real field shape:
 * layers[].checks[] carries {id, name, description, status, score, maxScore, details,
 * recommendation, bonus, maturity, tier, estScoreGain?}; status vocabulary observed live
 * is "pass" | "fail" | "warning" | "na" | "error" (not "warn" — this module normalizes
 * that). Of the 7 crosswalk-registered ids, the real response had pass/fail/pass/fail/
 * fail/fail/pass — this fixture adds one synthetic "warning" status (commented below) to
 * exercise the mapping branch the live snapshot didn't happen to produce.
 */
const REALISTIC_SCORE_RESPONSE = {
  domain: "qte77.github.io",
  url: URL_UNDER_TEST,
  urlKind: "domain",
  finalUrl: "https://qte77.github.io/",
  score: 60,
  maxScore: 100,
  grade: "C",
  scannedAt: "2026-08-26T00:07:56.105+00:00",
  durationMs: 5238,
  analysisStatus: "complete",
  pendingChecks: [],
  layers: [
    {
      id: "discovery",
      name: "Discovery",
      score: 6,
      maxScore: 13,
      checks: [
        {
          id: "ard-catalog",
          name: "ARD discovery",
          status: "fail",
          score: 0,
          maxScore: 1,
          details: "No /.well-known/ai-catalog.json",
          maturity: "verified",
          tier: "required",
        },
        {
          id: "brand-search-accuracy",
          name: "Brand name discoverability",
          status: "fail",
          score: 0,
          maxScore: 3,
          maturity: "verified",
          tier: "required",
        },
        {
          id: "wikipedia-presence",
          name: "Wikipedia / Wikidata entity presence",
          status: "error",
          score: 0,
          maxScore: 4,
          details: "Wikipedia and Wikidata presence could not be verified - try rescanning",
          maturity: "verified",
          tier: "recommended",
        },
      ],
    },
    {
      id: "accessibility",
      name: "Access",
      score: 44,
      maxScore: 61,
      checks: [
        {
          id: "agent-instruction",
          name: "Agent instruction / when-to-use",
          status: "pass",
          score: 3,
          maxScore: 3,
          details: "When-to-use guidance found in llms.txt",
          maturity: "verified",
          tier: "required",
        },
        {
          id: "schema-type-breadth",
          name: "Schema type breadth",
          status: "fail",
          score: 0,
          maxScore: 2,
          estScoreGain: 1.1,
          maturity: "verified",
          tier: "recommended",
        },
        {
          id: "a2a-agent-card",
          name: "A2A / agent-card",
          status: "pass",
          score: 2,
          maxScore: 2,
          details: 'A2A Agent Card found: "agenthud"',
          maturity: "verified",
          tier: "recommended",
        },
        {
          id: "openapi-spec",
          name: "OpenAPI spec published",
          status: "pass",
          score: 7,
          maxScore: 7,
          details: "OpenAPI spec found at https://qte77.github.io/openapi.json (version: 3.1.0)",
          maturity: "verified",
          tier: "required",
        },
        {
          id: "markdown-negotiation",
          name: "Markdown agent docs",
          status: "fail",
          score: 0,
          maxScore: 1,
          maturity: "emerging",
          tier: "emerging",
        },
        {
          id: "ard-entries-valid",
          name: "ARD entry validity",
          status: "na",
          score: 0,
          maxScore: 2,
          details: "No /.well-known/ai-catalog.json - entry validity applies only to published catalogs",
          maturity: "verified",
          tier: "recommended",
        },
      ],
    },
    {
      id: "usability",
      name: "Usability",
      score: 37,
      maxScore: 65,
      checks: [
        {
          id: "oauth-protected-resource",
          name: "OAuth Protected Resource metadata (RFC 9728)",
          status: "fail",
          score: 0,
          maxScore: 2,
          estScoreGain: 0.6,
          maturity: "verified",
          tier: "required",
        },
        {
          // Real id, real check — status changed from the live "fail" to "warning" so this
          // fixture exercises the warn-mapping branch (see fixture docstring above).
          id: "mcp-server-card",
          name: "MCP server / manifest",
          status: "warning",
          score: 1,
          maxScore: 2,
          estScoreGain: 0.6,
          maturity: "verified",
          tier: "required",
        },
        {
          id: "skills-sh-quality",
          name: "Skills.sh skill quality",
          status: "warning",
          score: 1,
          maxScore: 2,
          maturity: "emerging",
          tier: "emerging",
        },
      ],
    },
  ],
};

describe("scanOraAi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const noopSleep = async () => {};

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns {findings, score, grade} from the two-phase POST-then-GET pattern", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({ score: 55, grade: "C" });
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });

    expect(result.score).toBe(60);
    expect(result.grade).toBe("C");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [scanCall, scoreCall] = fetchMock.mock.calls;
    expect(scanCall?.[0]).toBe(SCAN_ENDPOINT);
    expect(scanCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(scanCall?.[1]?.body))).toEqual({ url: URL_UNDER_TEST });
    expect(scoreCall?.[0]).toBe(SCORE_ENDPOINT);
  });

  it("emits a Finding only for crosswalk-registered check ids, skipping the rest", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { findings } = await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });

    const totalChecks = REALISTIC_SCORE_RESPONSE.layers.reduce(
      (sum, layer) => sum + layer.checks.length,
      0,
    );
    const registeredIds = [
      "agent-instruction",
      "schema-type-breadth",
      "a2a-agent-card",
      "openapi-spec",
      "markdown-negotiation",
      "oauth-protected-resource",
      "mcp-server-card",
    ];
    expect(totalChecks).toBe(12);
    expect(findings).toHaveLength(registeredIds.length);
    expect(findings.map((f) => f.id).sort()).toEqual(
      registeredIds.map((id) => `oraAi.${id}`).sort(),
    );
    for (const finding of findings) {
      expect(finding.source).toBe("oraAi");
    }
  });

  it("maps each finding to its crosswalk category via assignCategory, not ora.ai's own layer grouping", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { findings } = await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));

    // agent-instruction/schema-type-breadth/a2a-agent-card/openapi-spec/markdown-negotiation
    // all live under ora.ai's "accessibility" layer in the real response, but our crosswalk
    // assigns them to different categories — proving the module uses assignCategory(check.id),
    // never ora.ai's own layer id/name.
    expect(byId["oraAi.agent-instruction"]?.category).toBe("Discovery");
    expect(byId["oraAi.schema-type-breadth"]?.category).toBe("Content");
    expect(byId["oraAi.markdown-negotiation"]?.category).toBe("Content");
    expect(byId["oraAi.a2a-agent-card"]?.category).toBe("Agent-to-Agent");
    expect(byId["oraAi.openapi-spec"]?.category).toBe("Execution");
    expect(byId["oraAi.oauth-protected-resource"]?.category).toBe("Identity & Auth");
    expect(byId["oraAi.mcp-server-card"]?.category).toBe("Execution");
  });

  it("maps ora.ai's pass/fail/warning/na/error statuses onto our Status union", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { findings } = await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));

    expect(byId["oraAi.agent-instruction"]?.status).toBe("pass"); // real "pass"
    expect(byId["oraAi.schema-type-breadth"]?.status).toBe("fail"); // real "fail"
    expect(byId["oraAi.mcp-server-card"]?.status).toBe("warn"); // real "warning"
  });

  it("carries ora.ai's own score/maxScore as evidence on each check-level finding", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { findings } = await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });
    const openapi = findings.find((f) => f.id === "oraAi.openapi-spec");

    expect(openapi?.evidence?.score).toBe(7);
    expect(openapi?.evidence?.maxScore).toBe(7);
  });

  it("maps a registered check's 'na' status to unknown rather than inventing pass/fail", async () => {
    const naFixture = {
      ...REALISTIC_SCORE_RESPONSE,
      layers: [
        {
          id: "accessibility",
          name: "Access",
          checks: [
            { id: "openapi-spec", name: "OpenAPI spec published", status: "na", score: 0, maxScore: 7 },
          ],
        },
      ],
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(naFixture);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { findings } = await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });
    expect(findings[0]?.status).toBe("unknown");
  });

  it("never throws on an unregistered check id — it is silently skipped, not defaulted", async () => {
    const unknownIdFixture = {
      ...REALISTIC_SCORE_RESPONSE,
      layers: [
        {
          id: "discovery",
          name: "Discovery",
          checks: [{ id: "totally-unregistered-signal", name: "Made up", status: "pass" }],
        },
      ],
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(unknownIdFixture);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { findings } = await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });
    expect(findings).toHaveLength(0);
  });

  it("waits settleDelayMs between POST and GET, per architecture.md's ~45s async window", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const sleep = vi.fn(async () => {});

    await scanOraAi(URL_UNDER_TEST, { sleep, settleDelayMs: 45000 });

    expect(sleep).toHaveBeenCalledWith(45000);
  });

  it("sends the optional partner key as a Bearer token on both calls, never elsewhere", async () => {
    const capturedHeaders: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      capturedHeaders.push((init?.headers as Record<string, unknown>) ?? {});
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, {
      sleep: noopSleep,
      oraAiApiKey: "secret-partner-key",
    });

    expect(capturedHeaders).toHaveLength(2);
    for (const headers of capturedHeaders) {
      expect(headers["Authorization"]).toBe("Bearer secret-partner-key");
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-partner-key");
  });

  it("does not send an Authorization header when no partner key is supplied", async () => {
    const capturedHeaders: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      capturedHeaders.push((init?.headers as Record<string, unknown>) ?? {});
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse(REALISTIC_SCORE_RESPONSE);
      throw new Error(`unexpected fetch: ${url}`);
    });

    await scanOraAi(URL_UNDER_TEST, { sleep: noopSleep });

    for (const headers of capturedHeaders) {
      expect(headers["Authorization"]).toBeUndefined();
    }
  });

  it("returns a single unknown Finding on a 429 from POST /api/scan, without ever calling GET", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) {
        return jsonResponse({ message: "rate limited" }, 429, { "retry-after": "120" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: async () => {} });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.status).toBe("unknown");
    expect(result.findings[0]?.source).toBe("oraAi");
    expect(result.findings[0]?.evidence?.retryAfterSeconds).toBe("120");
    expect(result.score).toBeUndefined();
    expect(result.grade).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a single unknown Finding on a 429 from GET /api/score", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) {
        return jsonResponse({ message: "rate limited" }, 429, { "retry-after": "30" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: async () => {} });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.status).toBe("unknown");
    expect(result.findings[0]?.evidence?.retryAfterSeconds).toBe("30");
  });

  it("returns a single unknown Finding when POST /api/scan network-fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) throw new Error("connection refused");
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: async () => {} });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.status).toBe("unknown");
    expect(result.findings[0]?.summary).toMatch(/connection refused/);
  });

  it("returns a single unknown Finding when GET /api/score network-fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) throw new Error("dns failure");
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: async () => {} });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.status).toBe("unknown");
  });

  it("returns a single unknown Finding on a non-429 error status from either call", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse({}, 500);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: async () => {} });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.status).toBe("unknown");
  });

  it("returns a single unknown Finding when the score response body is not valid JSON", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) {
        return new Response("not json", { status: 200, headers: { "content-type": "text/plain" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: async () => {} });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.status).toBe("unknown");
  });

  it("never throws even when the score response has no layers at all", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SCAN_ENDPOINT) return jsonResponse({});
      if (url === SCORE_ENDPOINT) return jsonResponse({ score: 10, grade: "F" });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await scanOraAi(URL_UNDER_TEST, { sleep: async () => {} });

    expect(result.findings).toEqual([]);
    expect(result.score).toBe(10);
    expect(result.grade).toBe("F");
  });
});
