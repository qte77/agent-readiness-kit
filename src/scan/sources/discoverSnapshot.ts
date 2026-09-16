/**
 * Subprocess wrapper around `polyfetch discover <url> --json` (the polyfetch-scrape CLI
 * env-borrow pattern — see docs/architecture.md's "polyfetch-scrape dependency policy").
 *
 * Owns exactly one signal: `schema-type-breadth` (Content category), scored from the
 * breadth of schema.org JSON-LD `@type` values in `discover --json`'s `json_ld_types`
 * field. It does NOT assess `llms_txt` (that's `wellKnown.ts`'s `agent-instruction`
 * signal) or `sitemaps`/`feeds` (not a signal owned by any module yet) — those raw fields
 * are attached to this module's one Finding as auxiliary `evidence` only, so a future
 * orchestrator pass can cross-check them against `wellKnown.ts`'s own finding.
 *
 * Never imports `polyfetch_scrape.contrib.easter_hunt` and never `uv add`s
 * polyfetch-scrape — only the CLI env-borrow subprocess call below, per the locked
 * decision in docs/architecture.md.
 */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { assignCategory } from "../crosswalk.js";
import type { Finding, Status } from "../../types.js";

const SIGNAL_ID = "schema-type-breadth";
const FINDING_ID = "discoverSnapshot.schema-type-breadth";

/** Result shape a `runCommand` implementation must resolve with. */
export interface CommandResult {
  stdout: string;
  stderr: string;
}

/** Injectable subprocess runner — defaults to `node:child_process`'s `execFile`. */
export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

export interface DiscoverSnapshotOptions {
  /**
   * Absolute path to a polyfetch-scrape checkout, passed as `uv run --directory`'s target.
   * Falls back to `process.env.POLYFETCH_SCRAPE_DIR` when omitted. Deliberately not
   * hardcoded — this module runs from different working directories (repo root in CI, a
   * git worktree during development), where a relative guess wouldn't resolve.
   */
  polyfetchScrapeDir?: string;
  /** Injectable for tests, to avoid spawning a real subprocess. */
  runCommand?: RunCommand;
}

/** The subset of `discover --json`'s output schema this module reads. */
interface DiscoverJson {
  sitemaps?: unknown;
  feeds?: unknown;
  llms_txt?: unknown;
  json_ld_types?: unknown;
}

const defaultRunCommand: RunCommand = promisify(execFileCallback);

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // node:child_process rejections carry the CLI's own stdout/stderr on the error object;
    // surface stdout too since polyfetch's `--json` error schema (USING.md) lands there.
    const stdout = (error as NodeJS.ErrnoException & { stdout?: string }).stdout;
    return stdout ? `${error.message} | stdout: ${stdout}` : error.message;
  }
  return String(error);
}

function unknownFinding(message: string): Finding {
  return {
    id: FINDING_ID,
    category: assignCategory(SIGNAL_ID),
    source: "discoverSnapshot",
    status: "unknown",
    summary: `Could not determine schema.org @type breadth: ${message}`,
    evidence: { error: message },
  };
}

/** Type-safe read of a `discover --json` array field; `undefined` on an unexpected shape. */
function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? value : undefined;
}

function buildFinding(parsed: DiscoverJson): Finding {
  const jsonLdTypes = readStringArray(parsed.json_ld_types);
  const sitemaps = readStringArray(parsed.sitemaps);
  const feeds = readStringArray(parsed.feeds);
  const llmsTxt = readStringArray(parsed.llms_txt);
  if (!jsonLdTypes || !sitemaps || !feeds || !llmsTxt) {
    return unknownFinding("discover --json returned an unexpected shape for one or more fields");
  }

  const distinctTypes = Array.from(new Set(jsonLdTypes));
  const breadth = distinctTypes.length;
  const status: Status = breadth === 0 ? "fail" : breadth === 1 ? "warn" : "pass";
  const summary =
    breadth === 0
      ? "No schema.org JSON-LD @type values found — no structured-data breadth for agents to read"
      : breadth === 1
        ? `Only one schema.org @type found (${distinctTypes[0]}) — narrow structured-data breadth`
        : `${breadth} distinct schema.org @type values found (${distinctTypes.join(", ")}) — broad structured-data coverage`;

  const finding: Finding = {
    id: FINDING_ID,
    category: assignCategory(SIGNAL_ID),
    source: "discoverSnapshot",
    status,
    summary,
    evidence: {
      json_ld_types: distinctTypes,
      // Auxiliary raw discover() fields, not this module's signal — kept only for a
      // future orchestrator cross-check against wellKnown.ts's agent-instruction finding.
      sitemaps,
      feeds,
      llms_txt: llmsTxt,
    },
  };
  if (status !== "pass") {
    finding.remediation =
      "Add or broaden schema.org JSON-LD structured data (e.g. SoftwareApplication, " +
      "Organization, FAQPage) so agents/LLMs can identify more of what this page is about.";
  }
  return finding;
}

/**
 * Runs `uv run --directory <polyfetchScrapeDir> polyfetch discover <url> --json` and
 * parses its output into this module's one owned Finding (`schema-type-breadth`).
 *
 * Returns an `unknown`-status Finding (never throws) on missing configuration, a failed
 * subprocess, or unparseable/unexpected-shape JSON — a single misconfigured/unreachable
 * source should not crash the orchestrator's fan-out across all sources.
 */
export async function discoverSnapshot(
  url: string,
  options: DiscoverSnapshotOptions = {},
): Promise<Finding[]> {
  const polyfetchScrapeDir = options.polyfetchScrapeDir ?? process.env.POLYFETCH_SCRAPE_DIR;
  if (!polyfetchScrapeDir) {
    return [
      unknownFinding(
        "no polyfetch-scrape directory configured — pass polyfetchScrapeDir or set POLYFETCH_SCRAPE_DIR",
      ),
    ];
  }

  const runCommand = options.runCommand ?? defaultRunCommand;
  let stdout: string;
  try {
    const result = await runCommand("uv", [
      "run",
      "--directory",
      polyfetchScrapeDir,
      "polyfetch",
      "discover",
      url,
      "--json",
    ]);
    stdout = result.stdout;
  } catch (error) {
    return [unknownFinding(`polyfetch discover subprocess failed: ${errorMessage(error)}`)];
  }

  let parsed: DiscoverJson;
  try {
    parsed = JSON.parse(stdout) as DiscoverJson;
  } catch (error) {
    return [
      unknownFinding(`polyfetch discover --json returned invalid JSON: ${errorMessage(error)}`),
    ];
  }

  return [buildFinding(parsed)];
}
