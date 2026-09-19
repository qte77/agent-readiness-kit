/**
 * Content/Trust signals derived from robots.txt and page-level content negotiation — see
 * `docs/plans/0001-scan-engine.md` row 1 for the fixed signal-id ownership this module
 * implements. Zero runtime dependencies: native `fetch` only (`docs/architecture.md`'s
 * dependency policy).
 */
import type { Finding, Status } from "../../types.js";
import { assignCategory } from "../crosswalk.js";

/**
 * Well-known AI-crawler user-agent tokens checked for explicit robots.txt rules. Not
 * exhaustive — covers the crawlers most commonly referenced in AI-crawler-policy discussion
 * as of 2026-09 (GPTBot/OpenAI, Google-Extended, CCBot/Common Crawl, ClaudeBot/Anthropic,
 * PerplexityBot, Applebot-Extended, Bytespider/ByteDance, Amazonbot, Meta-ExternalAgent).
 */
const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "Google-Extended",
  "CCBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Applebot-Extended",
  "Bytespider",
  "Amazonbot",
  "Meta-ExternalAgent",
];

interface ProbeResult {
  /** True if the fetch itself completed (no network-level error), regardless of HTTP status. */
  ok: boolean;
  status?: number;
  body?: string;
  contentType?: string | null;
  error?: string;
}

async function probe(url: string, init?: RequestInit): Promise<ProbeResult> {
  try {
    const res = await fetch(url, init);
    const body = await res.text();
    return { ok: true, status: res.status, body, contentType: res.headers.get("content-type") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function finding(
  signal: string,
  status: Status,
  summary: string,
  remediation?: string,
  evidence?: Record<string, unknown>,
): Finding {
  return {
    id: `contentSignal.${signal}`,
    category: assignCategory(signal),
    source: "contentSignal",
    status,
    summary,
    ...(remediation ? { remediation } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/** `content-signal` — robots.txt's `Content-Signal` directive (Cloudflare's Content Signals Policy). */
function evaluateContentSignal(robots: ProbeResult): Finding {
  const remediation =
    'Publish a /robots.txt with a Content-Signal directive, e.g. "Content-Signal: search=yes, ' +
    'ai-input=yes, ai-train=no" (Cloudflare\'s Content Signals Policy).';
  if (!robots.ok) {
    return finding("content-signal", "unknown", `Could not fetch /robots.txt: ${robots.error}`, remediation);
  }
  if (robots.status === 404) {
    return finding(
      "content-signal",
      "fail",
      "/robots.txt not found, so no Content-Signal directive can be present",
      remediation,
    );
  }
  if (robots.status !== 200) {
    return finding("content-signal", "warn", `/robots.txt returned HTTP ${robots.status}`, remediation, {
      httpStatus: robots.status,
    });
  }
  const directiveLine = (robots.body ?? "")
    .split(/\r?\n/)
    .find((line) => /^\s*content-signal\s*:/i.test(line));
  if (!directiveLine) {
    return finding(
      "content-signal",
      "fail",
      "/robots.txt present but declares no Content-Signal directive",
      remediation,
    );
  }
  return finding(
    "content-signal",
    "pass",
    `/robots.txt declares a Content-Signal directive: ${directiveLine.trim()}`,
    undefined,
    { directive: directiveLine.trim() },
  );
}

/** `bot-rules` — robots.txt's AI-crawler allow/disallow policy. */
function evaluateBotRules(robots: ProbeResult): Finding {
  const remediation =
    "Add explicit User-agent blocks (Allow/Disallow) for known AI crawlers (e.g. GPTBot, " +
    "ClaudeBot, Google-Extended) in /robots.txt.";
  if (!robots.ok) {
    return finding("bot-rules", "unknown", `Could not fetch /robots.txt: ${robots.error}`, remediation);
  }
  if (robots.status === 404) {
    return finding(
      "bot-rules",
      "fail",
      "/robots.txt not found, so no AI-crawler policy is declared",
      remediation,
    );
  }
  if (robots.status !== 200) {
    return finding("bot-rules", "warn", `/robots.txt returned HTTP ${robots.status}`, remediation, {
      httpStatus: robots.status,
    });
  }
  const body = robots.body ?? "";
  const matchedAgents = AI_CRAWLER_USER_AGENTS.filter((agent) =>
    new RegExp(`^\\s*user-agent\\s*:\\s*${agent}\\s*$`, "im").test(body),
  );
  if (matchedAgents.length === 0) {
    return finding(
      "bot-rules",
      "warn",
      "/robots.txt present but declares no explicit rules for known AI crawlers",
      remediation,
    );
  }
  return finding(
    "bot-rules",
    "pass",
    `/robots.txt declares explicit rules for AI crawler(s): ${matchedAgents.join(", ")}`,
    undefined,
    { matchedAgents },
  );
}

/** `web-bot-auth` — IETF Web Bot Auth (draft-ietf-webbotauth-httpsig-protocol, WG-adopted). */
function evaluateWebBotAuth(directory: ProbeResult): Finding {
  const remediation =
    "Publish a /.well-known/http-message-signatures-directory (JWKS-style key directory) and " +
    "support the Signature-Agent header, per the IETF webbotauth working group's " +
    "draft-ietf-webbotauth-httpsig-protocol (the path and JWKS format are unchanged from its " +
    "expired individual-draft predecessors).";
  if (!directory.ok) {
    return finding(
      "web-bot-auth",
      "unknown",
      `Could not fetch /.well-known/http-message-signatures-directory: ${directory.error}`,
      remediation,
    );
  }
  if (directory.status === 404) {
    return finding(
      "web-bot-auth",
      "fail",
      "/.well-known/http-message-signatures-directory not found",
      remediation,
    );
  }
  if (directory.status !== 200) {
    return finding(
      "web-bot-auth",
      "warn",
      `/.well-known/http-message-signatures-directory returned HTTP ${directory.status}`,
      remediation,
      { httpStatus: directory.status },
    );
  }
  try {
    const parsed = JSON.parse(directory.body ?? "") as { keys?: unknown };
    if (Array.isArray(parsed.keys)) {
      return finding(
        "web-bot-auth",
        "pass",
        "/.well-known/http-message-signatures-directory present with a JWKS-style key directory",
        undefined,
        { keyCount: parsed.keys.length },
      );
    }
    return finding(
      "web-bot-auth",
      "warn",
      '/.well-known/http-message-signatures-directory present but missing a "keys" array',
      remediation,
      { httpStatus: 200 },
    );
  } catch {
    return finding(
      "web-bot-auth",
      "warn",
      "/.well-known/http-message-signatures-directory returned HTTP 200 but the body is not valid JSON",
      remediation,
      { httpStatus: 200 },
    );
  }
}

const MARKDOWN_LINK_TAG_RE = /<link[^>]+rel=["']alternate["'][^>]+type=["']text\/markdown["']/i;

/** `markdown-twins` — a `.md` twin and/or a `<link rel="alternate" type="text/markdown">`. */
function evaluateMarkdownTwins(
  homePage: ProbeResult,
  readmeTwin: ProbeResult,
  indexTwin: ProbeResult,
): Finding {
  const remediation =
    'Publish a markdown twin of the page (e.g. README.md) and/or declare it via ' +
    '<link rel="alternate" type="text/markdown"> in <head>.';
  const twinFound = [readmeTwin, indexTwin].find(
    (t) => t.ok && t.status === 200 && (t.body ?? "").trim().length > 0,
  );
  if (twinFound) {
    return finding(
      "markdown-twins",
      "pass",
      "A root-level markdown twin (README.md or index.md) is present",
      undefined,
      { twinFound: true },
    );
  }
  if (!homePage.ok) {
    return finding(
      "markdown-twins",
      "unknown",
      `Could not fetch the page to check for a markdown twin: ${homePage.error}`,
      remediation,
    );
  }
  if (homePage.status !== 200) {
    return finding(
      "markdown-twins",
      "unknown",
      `Page returned HTTP ${homePage.status}; cannot check for a markdown twin`,
      undefined,
      { httpStatus: homePage.status },
    );
  }
  if (MARKDOWN_LINK_TAG_RE.test(homePage.body ?? "")) {
    return finding(
      "markdown-twins",
      "pass",
      'Page <head> declares a <link rel="alternate" type="text/markdown"> markdown twin',
      undefined,
      { linkTagPresent: true },
    );
  }
  return finding(
    "markdown-twins",
    "fail",
    'No markdown twin found via <link rel="alternate" type="text/markdown"> or a root-level ' +
      "README.md/index.md",
    remediation,
  );
}

/** `markdown-negotiation` — `Accept`-header content negotiation returning markdown. */
function evaluateMarkdownNegotiation(negotiated: ProbeResult): Finding {
  const remediation =
    "Support Accept-header content negotiation that returns text/markdown for the same URL " +
    "when requested (and declare Vary: Accept).";
  if (!negotiated.ok) {
    return finding(
      "markdown-negotiation",
      "unknown",
      `Could not fetch the page with Accept: text/markdown: ${negotiated.error}`,
      remediation,
    );
  }
  const contentType = negotiated.contentType ?? "";
  if (/text\/markdown/i.test(contentType)) {
    return finding(
      "markdown-negotiation",
      "pass",
      `Requesting with Accept: text/markdown returns Content-Type: ${contentType}`,
      undefined,
      { contentType },
    );
  }
  return finding(
    "markdown-negotiation",
    "fail",
    `Requesting with Accept: text/markdown still returns Content-Type: ${contentType || "unknown"}`,
    remediation,
    { contentType },
  );
}

/**
 * Scan a property for the Content/Trust signals owned by this module (see module docstring).
 * `url` is the property's configured URL (may include a subpath). robots.txt and the Web Bot
 * Auth well-known directory are resolved against the origin (RFC-anchored, per RFC 9309 /
 * RFC 8615); the markdown-twin/negotiation checks operate on the given page URL itself.
 */
export async function scanContentSignal(url: string): Promise<Finding[]> {
  const { origin } = new URL(url);

  const [robots, webBotAuthDirectory, homePage, negotiated, readmeTwin, indexTwin] = await Promise.all([
    probe(`${origin}/robots.txt`),
    probe(`${origin}/.well-known/http-message-signatures-directory`),
    probe(url),
    probe(url, { headers: { Accept: "text/markdown" } }),
    probe(new URL("README.md", url).toString()),
    probe(new URL("index.md", url).toString()),
  ]);

  return [
    evaluateContentSignal(robots),
    evaluateBotRules(robots),
    evaluateWebBotAuth(webBotAuthDirectory),
    evaluateMarkdownTwins(homePage, readmeTwin, indexTwin),
    evaluateMarkdownNegotiation(negotiated),
  ];
}
