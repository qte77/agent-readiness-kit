import { afterEach, describe, expect, it, vi } from "vitest";
import { scanContentSignal } from "../../../src/scan/sources/contentSignal.js";

const ORIGIN = "https://example.qte77.test";
const BASE_URL = `${ORIGIN}/section/`;

const OWNED_SIGNAL_IDS = [
  "content-signal",
  "bot-rules",
  "web-bot-auth",
  "markdown-twins",
  "markdown-negotiation",
];

interface Route {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

type RouteOrFn = Route | ((init?: RequestInit) => Route);

function mockFetch(routes: Record<string, RouteOrFn>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const route = routes[String(input)];
      if (!route) return new Response("", { status: 404 });
      const resolved = typeof route === "function" ? route(init) : route;
      return new Response(resolved.body ?? "", { status: resolved.status, headers: resolved.headers });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanContentSignal", () => {
  it("returns exactly one Finding per owned signal id, each attributed to contentSignal", async () => {
    mockFetch({});
    const findings = await scanContentSignal(BASE_URL);
    const ids = findings.map((f) => f.id).sort();

    expect(ids).toEqual(OWNED_SIGNAL_IDS.map((s) => `contentSignal.${s}`).sort());
    findings.forEach((f) => expect(f.source).toBe("contentSignal"));
  });

  it("passes content-signal when robots.txt declares a Content-Signal directive", async () => {
    mockFetch({
      [`${ORIGIN}/robots.txt`]: {
        status: 200,
        body: "User-agent: *\nDisallow:\nContent-Signal: search=yes, ai-train=no",
      },
    });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.content-signal")?.status).toBe("pass");
  });

  it("fails content-signal when robots.txt exists without the directive", async () => {
    mockFetch({ [`${ORIGIN}/robots.txt`]: { status: 200, body: "User-agent: *\nDisallow:" } });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.content-signal")?.status).toBe("fail");
  });

  it("fails content-signal and bot-rules when robots.txt is missing entirely", async () => {
    mockFetch({});
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.content-signal")?.status).toBe("fail");
    expect(findings.find((f) => f.id === "contentSignal.bot-rules")?.status).toBe("fail");
  });

  it("passes bot-rules when a known AI crawler user-agent is declared", async () => {
    mockFetch({ [`${ORIGIN}/robots.txt`]: { status: 200, body: "User-agent: GPTBot\nDisallow: /" } });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.bot-rules")?.status).toBe("pass");
  });

  it("warns bot-rules when robots.txt exists but names no known AI crawler", async () => {
    mockFetch({ [`${ORIGIN}/robots.txt`]: { status: 200, body: "User-agent: *\nDisallow:" } });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.bot-rules")?.status).toBe("warn");
  });

  it("passes web-bot-auth when the http-message-signatures-directory is JWKS-shaped", async () => {
    mockFetch({
      [`${ORIGIN}/.well-known/http-message-signatures-directory`]: {
        status: 200,
        body: JSON.stringify({ keys: [{ kty: "OKP" }] }),
      },
    });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.web-bot-auth")?.status).toBe("pass");
  });

  it("fails web-bot-auth when the directory is not published", async () => {
    mockFetch({});
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.web-bot-auth")?.status).toBe("fail");
  });

  it("passes markdown-twins when <head> declares a text/markdown alternate link", async () => {
    mockFetch({
      [BASE_URL]: {
        status: 200,
        body: `<html><head><link rel="alternate" type="text/markdown" href="index.md"></head></html>`,
      },
    });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.markdown-twins")?.status).toBe("pass");
  });

  it("passes markdown-twins when a root-level README.md twin exists", async () => {
    mockFetch({
      [BASE_URL]: { status: 200, body: "<html><head></head></html>" },
      [new URL("README.md", BASE_URL).toString()]: { status: 200, body: "# Section\n\nContent." },
    });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.markdown-twins")?.status).toBe("pass");
  });

  it("fails markdown-twins when neither the link tag nor a twin file is present", async () => {
    mockFetch({ [BASE_URL]: { status: 200, body: "<html><head></head></html>" } });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.markdown-twins")?.status).toBe("fail");
  });

  it("passes markdown-negotiation when Accept: text/markdown returns a markdown Content-Type", async () => {
    mockFetch({
      [BASE_URL]: (init) => {
        const accept = new Headers(init?.headers).get("accept") ?? "";
        return accept.includes("text/markdown")
          ? { status: 200, body: "# Section", headers: { "content-type": "text/markdown; charset=utf-8" } }
          : { status: 200, body: "<html></html>", headers: { "content-type": "text/html" } };
      },
    });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.markdown-negotiation")?.status).toBe("pass");
  });

  it("fails markdown-negotiation when Accept: text/markdown still returns html", async () => {
    mockFetch({
      [BASE_URL]: { status: 200, body: "<html></html>", headers: { "content-type": "text/html" } },
    });
    const findings = await scanContentSignal(BASE_URL);
    expect(findings.find((f) => f.id === "contentSignal.markdown-negotiation")?.status).toBe("fail");
  });

  it("maps every returned Finding to its crosswalk category", async () => {
    mockFetch({});
    const findings = await scanContentSignal(BASE_URL);
    const byId = Object.fromEntries(findings.map((f) => [f.id, f.category]));

    expect(byId["contentSignal.content-signal"]).toBe("Trust");
    expect(byId["contentSignal.bot-rules"]).toBe("Trust");
    expect(byId["contentSignal.web-bot-auth"]).toBe("Trust");
    expect(byId["contentSignal.markdown-twins"]).toBe("Content");
    expect(byId["contentSignal.markdown-negotiation"]).toBe("Content");
  });
});
