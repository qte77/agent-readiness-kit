/**
 * Row 6 — runs all 7 `src/scan/sources/*.ts` modules for one property and assembles the
 * single `ScanRun` persisted by `src/checkpoint.ts` / read by `src/remediation/issue.ts`.
 *
 * Design decisions this module implements (see docs/plans/0001-scan-engine.md's "Design
 * decisions (rows 3, 4, 6)" — do not re-derive or diverge from these):
 *
 * 1. `scanOraAi` is the one source returning `{ findings, score?, grade? }` instead of a
 *    bare `Finding[]` (it's the sole producer of `ScanRun`-level score/grade). Its
 *    `findings` are concatenated in like every other source; its `score`/`grade` are
 *    additionally assigned onto the assembled `ScanRun` itself.
 * 3. No cross-source dedup. `wellKnown.ts`/`oraAi.ts`/`isitAgentReady.ts` can legitimately
 *    all touch the same conceptual signal (e.g. `openapi-spec`) — `Finding.id`
 *    (`<source>.<signal>`) is already unique per source, so every source's findings are
 *    kept as-is, never merged or reconciled.
 *
 * All 7 sources are independent of each other, so they run concurrently (`Promise.all`)
 * rather than serially.
 */
import type { PropertyConfig } from "../../config/properties.js";
import type { ScanRun } from "../types.js";
import { scanCloudflareMcp } from "./sources/cloudflareMcp.js";
import { scanContentSignal } from "./sources/contentSignal.js";
import { discoverSnapshot } from "./sources/discoverSnapshot.js";
import { scanIsitAgentReady } from "./sources/isitAgentReady.js";
import { scanMcpA2aProbe } from "./sources/mcpA2aProbe.js";
import { scanOraAi } from "./sources/oraAi.js";
import { scanWellKnown } from "./sources/wellKnown.js";

/**
 * Scan `property` with all 7 sources and assemble one `ScanRun`. Never throws on its own —
 * every source module already collapses its own failures into an `"unknown"`-status
 * Finding, so a single misbehaving source degrades that source's findings, not the whole run.
 */
export async function scanProperty(property: PropertyConfig): Promise<ScanRun> {
  const { url } = property;

  const [wellKnown, contentSignal, discover, oraAi, isitAgentReady, cloudflareMcp, mcpA2aProbe] =
    await Promise.all([
      scanWellKnown(url),
      scanContentSignal(url),
      discoverSnapshot(url),
      scanOraAi(url),
      scanIsitAgentReady(url),
      scanCloudflareMcp(url),
      scanMcpA2aProbe(url),
    ]);

  const findings = [
    ...wellKnown,
    ...contentSignal,
    ...discover,
    ...oraAi.findings,
    ...isitAgentReady,
    ...cloudflareMcp,
    ...mcpA2aProbe,
  ];

  const scanRun: ScanRun = {
    propertyId: property.id,
    url,
    scannedAt: new Date().toISOString(),
    findings,
  };
  if (oraAi.score !== undefined) scanRun.score = oraAi.score;
  if (oraAi.grade !== undefined) scanRun.grade = oraAi.grade;

  return scanRun;
}
