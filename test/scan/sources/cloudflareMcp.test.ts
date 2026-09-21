import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanCloudflareMcp } from "../../../src/scan/sources/cloudflareMcp.js";

const BASE_URL = "https://example.com";
const SERVER_CARD_URL = "https://example.com/.well-known/mcp/server-card.json";
const AGENT_CARD_URL = "https://example.com/.well-known/agent-card.json";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("scanCloudflareMcp", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("mcp-server-card", () => {
    it("passes when the card has all expected keys with plausible types", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === SERVER_CARD_URL) {
          return jsonResponse({
            name: "Example MCP Server",
            description: "An example MCP server",
            version: "1.0.0",
            serverUrl: "https://example.com/mcp",
            tools: [{ name: "search" }],
          });
        }
        if (url === AGENT_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.mcp-server-card");

      expect(finding).toBeDefined();
      expect(finding?.status).toBe("pass");
      expect(finding?.category).toBe("Execution");
      expect(finding?.source).toBe("cloudflareMcp");
      expect(finding?.remediation).toBeUndefined();
    });

    it("fails on a 404", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === SERVER_CARD_URL) return jsonResponse({}, 404);
        if (url === AGENT_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.mcp-server-card");

      expect(finding?.status).toBe("fail");
      expect(finding?.remediation).toMatch(/mcp\/server-card\.json/);
    });

    it("warns when required keys are missing", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === SERVER_CARD_URL) return jsonResponse({ name: "Example" });
        if (url === AGENT_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.mcp-server-card");

      expect(finding?.status).toBe("warn");
      expect(finding?.evidence?.["missingKeys"]).toEqual(
        expect.arrayContaining(["description", "version", "serverUrl", "tools"]),
      );
    });

    it("returns unknown on a network failure", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === SERVER_CARD_URL) throw new Error("network down");
        if (url === AGENT_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.mcp-server-card");

      expect(finding?.status).toBe("unknown");
    });

    it("fails when the body is not valid JSON", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === SERVER_CARD_URL) {
          return new Response("not json", { status: 200 });
        }
        if (url === AGENT_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.mcp-server-card");

      expect(finding?.status).toBe("fail");
    });
  });

  describe("a2a-agent-card (static shape)", () => {
    it("passes when the card has all expected keys with plausible types", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === AGENT_CARD_URL) {
          return jsonResponse({
            name: "Example Agent",
            description: "An example A2A agent",
            url: "https://example.com/a2a",
            version: "1.0.0",
            capabilities: {},
            skills: [],
          });
        }
        if (url === SERVER_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.a2a-agent-card");

      expect(finding?.status).toBe("pass");
      expect(finding?.category).toBe("Agent-to-Agent");
      expect(finding?.source).toBe("cloudflareMcp");
    });

    it("fails on a 404", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === AGENT_CARD_URL) return jsonResponse({}, 404);
        if (url === SERVER_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.a2a-agent-card");

      expect(finding?.status).toBe("fail");
      expect(finding?.remediation).toMatch(/agent-card\.json/);
    });

    it("warns when required keys are missing", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === AGENT_CARD_URL) return jsonResponse({ name: "Example" });
        if (url === SERVER_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.a2a-agent-card");

      expect(finding?.status).toBe("warn");
    });

    it("passes when the card uses supportedInterfaces instead of a flat url (v1.0.0 shape)", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === AGENT_CARD_URL) {
          return jsonResponse({
            name: "Example Agent",
            description: "An example A2A agent",
            version: "1.0.0",
            capabilities: {},
            skills: [],
            supportedInterfaces: [
              { url: "https://example.com/a2a/v1", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
            ],
          });
        }
        if (url === SERVER_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.a2a-agent-card");

      expect(finding?.status).toBe("pass");
    });

    it("warns when the card has all other keys but neither url nor supportedInterfaces", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === AGENT_CARD_URL) {
          return jsonResponse({
            name: "Example Agent",
            description: "An example A2A agent",
            version: "1.0.0",
            capabilities: {},
            skills: [],
          });
        }
        if (url === SERVER_CARD_URL) return jsonResponse({}, 404);
        throw new Error(`unexpected fetch: ${url}`);
      });

      const findings = await scanCloudflareMcp(BASE_URL);
      const finding = findings.find((f) => f.id === "cloudflareMcp.a2a-agent-card");

      expect(finding?.status).toBe("warn");
      expect(finding?.evidence?.["missingKeys"]).toEqual(
        expect.arrayContaining(["url-or-supportedInterfaces"]),
      );
    });
  });

  it("returns exactly the two owned Findings", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 404));
    const findings = await scanCloudflareMcp(BASE_URL);
    expect(findings.map((f) => f.id).sort()).toEqual(
      ["cloudflareMcp.a2a-agent-card", "cloudflareMcp.mcp-server-card"].sort(),
    );
  });
});
