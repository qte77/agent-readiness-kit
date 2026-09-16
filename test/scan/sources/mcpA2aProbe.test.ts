import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanMcpA2aProbe } from "../../../src/scan/sources/mcpA2aProbe.js";

const BASE_URL = "https://example.com";
const AGENT_CARD_URL = "https://example.com/.well-known/agent-card.json";
const ENDPOINT = "https://example.com/a2a";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("scanMcpA2aProbe", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let capturedRequestBody: string | undefined;

  beforeEach(() => {
    capturedRequestBody = undefined;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes with a strong verdict when message/send round-trips a result", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === AGENT_CARD_URL) {
        return jsonResponse({ name: "Example Agent", url: ENDPOINT });
      }
      if (url === ENDPOINT) {
        capturedRequestBody = init?.body ? String(init.body) : undefined;
        return jsonResponse({
          jsonrpc: "2.0",
          id: "agent-readiness-kit-probe",
          result: { kind: "message", role: "agent", parts: [], messageId: "reply-1" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("mcpA2aProbe.a2a-agent-card");
    expect(findings[0]?.category).toBe("Agent-to-Agent");
    expect(findings[0]?.source).toBe("mcpA2aProbe");
    expect(findings[0]?.status).toBe("pass");

    expect(capturedRequestBody).toBeDefined();
    const requestBody = JSON.parse(capturedRequestBody ?? "{}") as {
      jsonrpc: string;
      method: string;
      params: { message: { role: string; parts: unknown[]; messageId: string } };
    };
    expect(requestBody.jsonrpc).toBe("2.0");
    expect(requestBody.method).toBe("message/send");
    expect(requestBody.params.message.role).toBe("user");
    expect(requestBody.params.message.messageId).toEqual(expect.any(String));
  });

  it("warns when the endpoint speaks JSON-RPC but message/send errors", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) return jsonResponse({ url: ENDPOINT });
      if (url === ENDPOINT) {
        return jsonResponse({
          jsonrpc: "2.0",
          id: "x",
          error: { code: -32601, message: "Method not found" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("warn");
  });

  it("warns when an authenticated endpoint returns 401/403 to the unauthenticated probe", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) return jsonResponse({ url: ENDPOINT });
      if (url === ENDPOINT) return jsonResponse({}, 401);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("warn");
    expect(findings[0]?.summary).toMatch(/401/);
  });

  it("fails when the endpoint is unreachable", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) return jsonResponse({ url: ENDPOINT });
      if (url === ENDPOINT) throw new Error("connection refused");
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("fail");
  });

  it("fails when the endpoint returns a non-200, non-auth status", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) return jsonResponse({ url: ENDPOINT });
      if (url === ENDPOINT) return jsonResponse({}, 500);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("fail");
  });

  it("fails when the endpoint returns a non-JSON-RPC body", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) return jsonResponse({ url: ENDPOINT });
      if (url === ENDPOINT) return jsonResponse({ ok: true });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("fail");
  });

  it("returns unknown when there is no agent card to probe against", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) return jsonResponse({}, 404);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("unknown");
    expect(findings[0]?.id).toBe("mcpA2aProbe.a2a-agent-card");
  });

  it("returns unknown when the agent card has no usable url field", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) return jsonResponse({ name: "Example" });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("unknown");
  });

  it("returns unknown when the agent card fetch itself fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === AGENT_CARD_URL) throw new Error("dns failure");
      throw new Error(`unexpected fetch: ${url}`);
    });

    const findings = await scanMcpA2aProbe(BASE_URL);
    expect(findings[0]?.status).toBe("unknown");
  });
});
