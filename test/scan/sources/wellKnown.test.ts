import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolveTxt: vi.fn(),
}));

import { resolveTxt } from "node:dns/promises";
import { scanWellKnown } from "../../../src/scan/sources/wellKnown.js";

const BASE_URL = "https://example.qte77.test";

const OWNED_SIGNAL_IDS = [
  "agent-instruction",
  "ai-catalog",
  "agent-skills-index",
  "api-catalog",
  "auth-md",
  "oauth-protected-resource",
  "oauth-oidc-discovery",
  "openapi-spec",
  "dev-resource-discovery",
  "dns-aid",
];

interface Route {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

function mockFetch(routes: Record<string, Route>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const route = routes[String(input)];
      if (!route) return new Response("", { status: 404 });
      return new Response(route.body ?? "", { status: route.status, headers: route.headers });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(resolveTxt).mockReset();
});

describe("scanWellKnown", () => {
  it("returns exactly one Finding per owned signal id, each attributed to wellKnown", async () => {
    mockFetch({});
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    const ids = findings.map((f) => f.id).sort();

    expect(ids).toEqual(OWNED_SIGNAL_IDS.map((s) => `wellKnown.${s}`).sort());
    findings.forEach((f) => expect(f.source).toBe("wellKnown"));
  });

  it("passes agent-instruction when /llms.txt has non-trivial content", async () => {
    mockFetch({
      [`${BASE_URL}/llms.txt`]: {
        status: 200,
        body: "# Example\n\nThis site is agent-readable. See /docs for more detail.",
      },
    });
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    expect(findings.find((f) => f.id === "wellKnown.agent-instruction")?.status).toBe("pass");
  });

  it("fails agent-instruction on a 404 and warns on a trivial/empty file", async () => {
    mockFetch({ [`${BASE_URL}/llms.txt`]: { status: 200, body: "  \n" } });
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const trivial = await scanWellKnown(BASE_URL);
    expect(trivial.find((f) => f.id === "wellKnown.agent-instruction")?.status).toBe("warn");

    mockFetch({});
    const missing = await scanWellKnown(BASE_URL);
    expect(missing.find((f) => f.id === "wellKnown.agent-instruction")?.status).toBe("fail");
  });

  it("marks agent-instruction unknown on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    expect(findings.find((f) => f.id === "wellKnown.agent-instruction")?.status).toBe("unknown");
  });

  it("passes ai-catalog when the current ARD path (/.well-known/ard.json) is valid JSON", async () => {
    mockFetch({
      [`${BASE_URL}/.well-known/ard.json`]: { status: 200, body: JSON.stringify({ entries: [] }) },
    });
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    const finding = findings.find((f) => f.id === "wellKnown.ai-catalog");
    expect(finding?.status).toBe("pass");
    expect(finding?.summary).toMatch(/\/\.well-known\/ard\.json/);
  });

  it("falls back to the legacy /.well-known/ai-catalog.json path when ard.json 404s", async () => {
    mockFetch({
      [`${BASE_URL}/.well-known/ai-catalog.json`]: { status: 200, body: JSON.stringify({}) },
    });
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    const finding = findings.find((f) => f.id === "wellKnown.ai-catalog");
    expect(finding?.status).toBe("pass");
    expect(finding?.summary).toMatch(/\/\.well-known\/ai-catalog\.json/);
  });

  it("fails ai-catalog when neither ard.json nor the legacy ai-catalog.json path exists", async () => {
    mockFetch({});
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    expect(findings.find((f) => f.id === "wellKnown.ai-catalog")?.status).toBe("fail");
  });

  it("passes api-catalog when the RFC 9727 well-known file is valid JSON", async () => {
    mockFetch({
      [`${BASE_URL}/.well-known/api-catalog`]: { status: 200, body: JSON.stringify({ apis: [] }) },
    });
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    expect(findings.find((f) => f.id === "wellKnown.api-catalog")?.status).toBe("pass");
  });

  it("warns when a well-known JSON endpoint returns HTTP 200 but invalid JSON", async () => {
    mockFetch({
      [`${BASE_URL}/.well-known/openid-configuration`]: { status: 200, body: "not json" },
    });
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    expect(findings.find((f) => f.id === "wellKnown.oauth-oidc-discovery")?.status).toBe("warn");
  });

  it("marks dns-aid unknown with an explanatory note, regardless of the TXT lookup outcome", async () => {
    mockFetch({});
    vi.mocked(resolveTxt).mockResolvedValue([["v=aid1;uri=https://example.qte77.test/agent"]]);

    const resolved = await scanWellKnown(BASE_URL);
    expect(resolved.find((f) => f.id === "wellKnown.dns-aid")?.status).toBe("unknown");
    expect(resolved.find((f) => f.id === "wellKnown.dns-aid")?.evidence?.note).toMatch(
      /no single settled/i,
    );

    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));
    const failed = await scanWellKnown(BASE_URL);
    expect(failed.find((f) => f.id === "wellKnown.dns-aid")?.status).toBe("unknown");
  });

  it("maps every returned Finding to its crosswalk category", async () => {
    mockFetch({});
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const findings = await scanWellKnown(BASE_URL);
    const byId = Object.fromEntries(findings.map((f) => [f.id, f.category]));

    expect(byId["wellKnown.auth-md"]).toBe("Identity & Auth");
    expect(byId["wellKnown.oauth-protected-resource"]).toBe("Identity & Auth");
    expect(byId["wellKnown.openapi-spec"]).toBe("Execution");
    expect(byId["wellKnown.agent-instruction"]).toBe("Discovery");
    expect(byId["wellKnown.dns-aid"]).toBe("Discovery");
  });
});
