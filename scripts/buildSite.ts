/**
 * Pure logic for the GitHub Pages readiness dashboard (arc 0002), split from
 * `scripts/buildSiteCli.ts`'s git-log-walk + file-copy wiring the same way this repo already
 * splits `src/scan/orchestrator.ts` (logic) from `src/main.ts` (wiring) — see
 * `docs/plans/0002-readiness-dashboard.md`.
 */
import type { ScanRun, Status } from "../src/types.js";

/** Per-status finding counts for one scan run. */
export interface StatusCounts {
  pass: number;
  fail: number;
  warn: number;
  unknown: number;
}

/** One point of trend history for a property, as consumed by `site/app.js`'s sparkline. */
export interface RunSummary {
  scannedAt: string;
  /**
   * `ScanRun.score` (ora.ai's 0-100) when present; otherwise a fallback computed from this
   * run's findings (see `summarizeScanRun`). `undefined` — never `NaN` — when there are zero
   * graded (pass/fail/warn) findings to compute a fallback from.
   */
  score?: number;
  /** `run.grade` passed through verbatim. Never invented for the fallback-score case. */
  grade?: string;
  counts: StatusCounts;
}

function countByStatus(run: ScanRun): StatusCounts {
  const counts: StatusCounts = { pass: 0, fail: 0, warn: 0, unknown: 0 };
  for (const finding of run.findings) {
    counts[finding.status] += 1;
  }
  return counts;
}

/** `unknown` findings are excluded from the fallback score's denominator (see plan's Threshold model). */
const GRADED_STATUSES: readonly Status[] = ["pass", "fail", "warn"];

function fallbackScore(counts: StatusCounts): number | undefined {
  const denominator = GRADED_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  if (denominator === 0) return undefined;
  return Math.round((100 * counts.pass) / denominator);
}

/**
 * Summarize one `ScanRun` into the shape `site/app.js` renders a card/sparkline point from.
 * `run.score` wins when present; otherwise falls back to `fallbackScore` so the dashboard stays
 * useful even when ora.ai fails for a given run (plan's Threshold model).
 */
export function summarizeScanRun(run: ScanRun): RunSummary {
  const counts = countByStatus(run);
  return {
    scannedAt: run.scannedAt,
    score: run.score ?? fallbackScore(counts),
    grade: run.grade,
    counts,
  };
}

/**
 * Drops a consecutive duplicate `scannedAt`, keeping the first occurrence. A real scan always
 * produces a fresh, unique timestamp (`new Date().toISOString()` at scan time) — two adjacent
 * entries sharing one mean `git log -- <path>` returned the same underlying revision twice,
 * not two real scans (observed cause: a later, unrelated commit whose tree happened to be
 * byte-identical to an earlier one for this specific path, e.g. a squash-merge that never
 * touched this property but still counted as "touching" it under git's history
 * simplification). Non-consecutive matches are left alone — this only guards against the
 * exact adjacent-duplicate shape actually observed, not a general dedup.
 */
function dedupeConsecutive(summaries: RunSummary[]): RunSummary[] {
  const result: RunSummary[] = [];
  for (const summary of summaries) {
    if (result[result.length - 1]?.scannedAt !== summary.scannedAt) {
      result.push(summary);
    }
  }
  return result;
}

/**
 * Cap trend history at the most recent `max` entries (default 52, ~1 year of weekly runs),
 * assuming `summaries` is already ordered oldest-to-newest. Handles N=0/N=1 without crashing.
 */
export function capHistory(summaries: RunSummary[], max = 52): RunSummary[] {
  return dedupeConsecutive(summaries).slice(-max);
}
