import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverSnapshot } from "../../../src/scan/sources/discoverSnapshot.js";

/** Builds a fake `runCommand` that resolves with the given `discover --json` stdout. */
function fakeRunCommand(discoverJson: Record<string, unknown>) {
  return async (_command: string, _args: string[]) => ({
    stdout: JSON.stringify(discoverJson),
    stderr: "",
  });
}

const emptyDiscoverJson = {
  url: "https://example.com",
  sitemaps: [],
  event_sitemaps: [],
  feeds: [],
  llms_txt: [],
  json_ld_types: [],
};

describe("discoverSnapshot", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("invokes the polyfetch CLI env-borrow subprocess with --directory and --json", async () => {
    let capturedCommand: string | undefined;
    let capturedArgs: string[] | undefined;
    const runCommand = async (command: string, args: string[]) => {
      capturedCommand = command;
      capturedArgs = args;
      return { stdout: JSON.stringify(emptyDiscoverJson), stderr: "" };
    };

    await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    expect(capturedCommand).toBe("uv");
    expect(capturedArgs).toEqual([
      "run",
      "--directory",
      "/abs/polyfetch-scrape",
      "polyfetch",
      "discover",
      "https://example.com",
      "--json",
    ]);
  });

  it("scores broad schema-type breadth as pass and attaches auxiliary raw fields as evidence", async () => {
    const runCommand = fakeRunCommand({
      url: "https://example.com",
      sitemaps: ["https://example.com/sitemap.xml"],
      event_sitemaps: [],
      feeds: ["https://example.com/feed.xml"],
      llms_txt: ["https://example.com/llms.txt"],
      json_ld_types: ["SoftwareApplication", "Organization", "FAQPage"],
    });

    const findings = await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.id).toBe("discoverSnapshot.schema-type-breadth");
    expect(finding.category).toBe("Content");
    expect(finding.source).toBe("discoverSnapshot");
    expect(finding.status).toBe("pass");
    expect(finding.evidence?.json_ld_types).toEqual([
      "SoftwareApplication",
      "Organization",
      "FAQPage",
    ]);
    // Auxiliary fields for a future orchestrator cross-check against wellKnown.ts —
    // this module does not itself assess them.
    expect(finding.evidence?.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(finding.evidence?.feeds).toEqual(["https://example.com/feed.xml"]);
    expect(finding.evidence?.llms_txt).toEqual(["https://example.com/llms.txt"]);
  });

  it("scores zero @type values as fail with remediation", async () => {
    const runCommand = fakeRunCommand(emptyDiscoverJson);

    const findings = await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    expect(findings[0]!.status).toBe("fail");
    expect(findings[0]!.remediation).toBeDefined();
  });

  it("scores exactly one @type value as warn with remediation", async () => {
    const runCommand = fakeRunCommand({ ...emptyDiscoverJson, json_ld_types: ["WebPage"] });

    const findings = await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    expect(findings[0]!.status).toBe("warn");
    expect(findings[0]!.remediation).toBeDefined();
  });

  it("does not emit a competing Finding for the agent-instruction (llms.txt) signal", async () => {
    const runCommand = fakeRunCommand({
      ...emptyDiscoverJson,
      llms_txt: ["https://example.com/llms.txt"],
      json_ld_types: ["Organization"],
    });

    const findings = await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    // Exactly one Finding, and it's not an agent-instruction one — that signal belongs to
    // wellKnown.ts, built in parallel.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).not.toContain("agent-instruction");
  });

  it("falls back to POLYFETCH_SCRAPE_DIR env var when no polyfetchScrapeDir option is passed", async () => {
    vi.stubEnv("POLYFETCH_SCRAPE_DIR", "/env/polyfetch-scrape");
    let capturedArgs: string[] | undefined;
    const runCommand = async (_command: string, args: string[]) => {
      capturedArgs = args;
      return { stdout: JSON.stringify(emptyDiscoverJson), stderr: "" };
    };

    await discoverSnapshot("https://example.com", { runCommand });

    expect(capturedArgs).toContain("/env/polyfetch-scrape");
  });

  it("returns an unknown-status finding when no polyfetch-scrape directory is configured", async () => {
    vi.stubEnv("POLYFETCH_SCRAPE_DIR", undefined);

    const findings = await discoverSnapshot("https://example.com", {});

    expect(findings).toHaveLength(1);
    expect(findings[0]!.status).toBe("unknown");
  });

  it("returns an unknown-status finding when the subprocess rejects", async () => {
    const runCommand = async () => {
      throw new Error("uv: command not found");
    };

    const findings = await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    expect(findings[0]!.status).toBe("unknown");
    expect(findings[0]!.evidence?.error).toContain("uv: command not found");
  });

  it("returns an unknown-status finding when the CLI output is not valid JSON", async () => {
    const runCommand = async () => ({ stdout: "not json", stderr: "" });

    const findings = await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    expect(findings[0]!.status).toBe("unknown");
  });

  it("returns an unknown-status finding when json_ld_types is not an array (unexpected shape)", async () => {
    const runCommand = fakeRunCommand({ ...emptyDiscoverJson, json_ld_types: "not-an-array" });

    const findings = await discoverSnapshot("https://example.com", {
      polyfetchScrapeDir: "/abs/polyfetch-scrape",
      runCommand,
    });

    expect(findings[0]!.status).toBe("unknown");
  });
});
