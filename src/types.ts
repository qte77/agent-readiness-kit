/**
 * Core domain types for agent-readiness-kit.
 *
 * The six-category crosswalk (category <-> ora.ai signal <-> Cloudflare signal) is owned
 * by `agenthud-agui-a2ui/docs/agent-readiness.md` — this file only names the categories;
 * see `src/scan/crosswalk.ts` for the signal -> Category mapping seeded from that table.
 */

/** The six agent-native readiness categories (Agent Native Builders Hackathon). */
export type Category =
  | "Discovery"
  | "Content"
  | "Trust"
  | "Execution"
  | "Agent-to-Agent"
  | "Identity & Auth";

export const CATEGORIES: readonly Category[] = [
  "Discovery",
  "Content",
  "Trust",
  "Execution",
  "Agent-to-Agent",
  "Identity & Auth",
] as const;

/**
 * Which scan source module (src/scan/sources/*.ts) produced a given Finding.
 * One id per source module; kept in sync with the source file basenames.
 */
export type SourceId =
  | "cloudflareMcp"
  | "cloudflareUrlScanner"
  | "oraAi"
  | "wellKnown"
  | "contentSignal"
  | "mcpA2aProbe"
  | "discoverSnapshot";

/** Outcome of a single Finding. */
export type Status = "pass" | "fail" | "warn" | "unknown";

/**
 * One concrete, remediable observation about a property produced by a scan source.
 * This is a local reimplementation of the shape used informally by
 * `polyfetch_scrape.contrib.easter_hunt` — that module is explicitly "optional,
 * unsupported" upstream and is never imported here (see docs/plans/0001-scan-engine.md).
 */
export interface Finding {
  /** Stable identifier, e.g. "wellKnown.agent-card-json". Used for dedup across scans. */
  id: string;
  category: Category;
  source: SourceId;
  status: Status;
  /** One-line human-readable summary of what was observed. */
  summary: string;
  /** Concrete remediation text — the point of this tool is not just a score. */
  remediation?: string;
  /** Raw evidence captured for the finding (response snippets, headers, etc). */
  evidence?: Record<string, unknown>;
}

/**
 * One scan execution against one property. This is the unit persisted verbatim to
 * `data/scans/<propertyId>.json` (overwritten each run — git history is the trend record).
 */
export interface ScanRun {
  propertyId: string;
  url: string;
  /** ISO 8601 timestamp. */
  scannedAt: string;
  findings: Finding[];
  /** Optional aggregate score (e.g. from ora.ai), when the source provides one. */
  score?: number;
  grade?: string;
}
