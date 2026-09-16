/*
 * MCP tool handlers for the agent-readiness-kit Worker (POST /mcp). There is NO scanning logic
 * here — each handler just `fetch()`s the already-committed `data/scans/<propertyId>.json` off
 * raw.githubusercontent.com and shapes it into the tool's response. Handlers are exported as pure
 * functions so they can be unit-tested with a faked `fetch`, without standing up the MCP
 * transport (src/index.ts wires them via createMcpHandler). Mirrors the shape of
 * `agenthud-agui-a2ui/worker/src/mcp/tools.ts`.
 *
 * `ScanRun`/`Finding` are the exact shape persisted to data/scans/<id>.json — imported as
 * types-only from the scan engine's src/types.ts (erased at build time, so this stays a
 * type-only coupling, not a runtime dependency) rather than re-forked here. `PROPERTIES` is
 * imported the same way (as a value) from config/properties.ts, the repo's single source of
 * truth for which properties exist — see docs/architecture.md "DRY" / core-principles.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Finding, ScanRun } from "../../../src/types";
import { PROPERTIES } from "../../../config/properties";

const RAW_BASE = "https://raw.githubusercontent.com/qte77/agent-readiness-kit/main/data/scans";

const asText = (t: string): { type: "text"; text: string }[] => [{ type: "text", text: t }];

function findProperty(propertyId: string) {
  return PROPERTIES.find((p) => p.id === propertyId);
}

function unknownPropertyResult(propertyId: string): CallToolResult {
  const known = PROPERTIES.map((p) => p.id).join(", ");
  return {
    content: asText(`Unknown property: "${propertyId}". Known ids: ${known}.`),
    isError: true,
  };
}

type ScanFetchResult =
  | { status: "ok"; scanRun: ScanRun }
  | { status: "no-scan-data" }
  | { status: "fetch-error"; detail: string };

/**
 * Fetch `data/scans/<propertyId>.json` off raw.githubusercontent.com. A 404 (scan hasn't run
 * yet, or property removed) and any other fetch/parse failure both resolve to a structured
 * result instead of throwing — this Worker never crashes on missing data.
 */
async function fetchScanRun(propertyId: string): Promise<ScanFetchResult> {
  try {
    const res = await fetch(`${RAW_BASE}/${propertyId}.json`);
    if (res.status === 404) return { status: "no-scan-data" };
    if (!res.ok) return { status: "fetch-error", detail: `upstream returned ${res.status}` };
    const scanRun = (await res.json()) as ScanRun;
    return { status: "ok", scanRun };
  } catch (err) {
    return { status: "fetch-error", detail: err instanceof Error ? err.message : String(err) };
  }
}

function countByStatus(findings: readonly Finding[]): Record<Finding["status"], number> {
  const counts: Record<Finding["status"], number> = { pass: 0, fail: 0, warn: 0, unknown: 0 };
  for (const f of findings) counts[f.status] += 1;
  return counts;
}

/** Shared input: which property to look up (matches a `config/properties.ts` id). */
export const propertyIdInputSchema = z.object({
  propertyId: z
    .string()
    .min(1)
    .describe('Property id, e.g. "qte77-github-io" — matches data/scans/<id>.json.'),
});

export type PropertyIdInput = z.infer<typeof propertyIdInputSchema>;

/**
 * `get_latest_score`: the latest scan's score/grade/scannedAt and a per-status finding count
 * for one property. A malformed (unknown) propertyId is a tool error; a known property with no
 * scan committed yet is a successful, informative response, not an error.
 */
export async function runGetLatestScore(args: PropertyIdInput): Promise<CallToolResult> {
  if (!findProperty(args.propertyId)) return unknownPropertyResult(args.propertyId);

  const result = await fetchScanRun(args.propertyId);
  if (result.status === "ok") {
    const { scanRun } = result;
    const body = {
      propertyId: scanRun.propertyId,
      status: "ok" as const,
      url: scanRun.url,
      scannedAt: scanRun.scannedAt,
      score: scanRun.score,
      grade: scanRun.grade,
      findingCounts: countByStatus(scanRun.findings),
    };
    return { content: asText(JSON.stringify(body)), structuredContent: body };
  }

  const body = {
    propertyId: args.propertyId,
    status: result.status,
    message:
      result.status === "no-scan-data"
        ? "No scan has run yet for this property."
        : result.detail,
  };
  return { content: asText(JSON.stringify(body)), structuredContent: body };
}

/**
 * `get_playbook`: the concrete remediation checklist for one property — every finding that
 * carries `remediation` text, from the latest committed scan. Same unknown-property /
 * no-scan-data handling as `get_latest_score`.
 */
export async function runGetPlaybook(args: PropertyIdInput): Promise<CallToolResult> {
  if (!findProperty(args.propertyId)) return unknownPropertyResult(args.propertyId);

  const result = await fetchScanRun(args.propertyId);
  if (result.status === "ok") {
    const items = result.scanRun.findings
      .filter((f) => f.remediation)
      .map((f) => ({
        id: f.id,
        category: f.category,
        status: f.status,
        summary: f.summary,
        remediation: f.remediation,
      }));
    const body = { propertyId: args.propertyId, status: "ok" as const, items };
    return { content: asText(JSON.stringify(body)), structuredContent: body };
  }

  const body = {
    propertyId: args.propertyId,
    status: result.status,
    message:
      result.status === "no-scan-data"
        ? "No scan has run yet for this property."
        : result.detail,
    items: [] as unknown[],
  };
  return { content: asText(JSON.stringify(body)), structuredContent: body };
}

/** `list_properties` takes no input. */
export const listPropertiesInputSchema = z.object({});

/**
 * `list_properties`: every configured property (from `config/properties.ts`) plus whether it
 * has scan data committed yet (and its latest score/grade when it does).
 */
export async function runListProperties(): Promise<CallToolResult> {
  const properties = await Promise.all(
    PROPERTIES.map(async (p) => {
      const result = await fetchScanRun(p.id);
      if (result.status === "ok") {
        return {
          id: p.id,
          url: p.url,
          label: p.label,
          hasScanData: true,
          scannedAt: result.scanRun.scannedAt,
          score: result.scanRun.score,
          grade: result.scanRun.grade,
        };
      }
      return { id: p.id, url: p.url, label: p.label, hasScanData: false };
    }),
  );
  const body = { properties };
  return { content: asText(JSON.stringify(body)), structuredContent: body };
}
