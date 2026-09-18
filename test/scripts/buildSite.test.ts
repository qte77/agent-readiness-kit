import { describe, expect, it } from "vitest";
import { capHistory, summarizeScanRun, type RunSummary } from "../../scripts/buildSite.js";
import type { Finding, ScanRun } from "../../src/types.js";

function finding(status: Finding["status"], id = "x"): Finding {
  return {
    id,
    category: "Discovery",
    source: "wellKnown",
    status,
    summary: "test finding",
  };
}

const BASE_RUN: ScanRun = {
  propertyId: "qte77-github-io",
  url: "https://qte77.github.io",
  scannedAt: "2026-09-17T14:13:34.078Z",
  findings: [],
};

describe("summarizeScanRun", () => {
  it("uses run.score/run.grade verbatim when score is present", () => {
    const run: ScanRun = {
      ...BASE_RUN,
      score: 65,
      grade: "C",
      findings: [finding("pass"), finding("fail"), finding("warn"), finding("unknown")],
    };
    expect(summarizeScanRun(run)).toEqual({
      scannedAt: BASE_RUN.scannedAt,
      score: 65,
      grade: "C",
      counts: { pass: 1, fail: 1, warn: 1, unknown: 1 },
    });
  });

  it("computes a fallback score from pass/fail/warn counts (ignoring unknown) when run.score is absent", () => {
    const run: ScanRun = {
      ...BASE_RUN,
      findings: [finding("pass"), finding("pass"), finding("fail"), finding("warn"), finding("unknown")],
    };
    const summary = summarizeScanRun(run);
    // 2 pass out of (2 pass + 1 fail + 1 warn) = 4 graded findings -> round(100 * 2/4) = 50
    expect(summary.score).toBe(50);
    expect(summary.grade).toBeUndefined();
    expect(summary.counts).toEqual({ pass: 2, fail: 1, warn: 1, unknown: 1 });
  });

  it("reports score as undefined (not NaN) when there are zero findings", () => {
    const run: ScanRun = { ...BASE_RUN, findings: [] };
    const summary = summarizeScanRun(run);
    expect(summary.score).toBeUndefined();
    expect(summary.counts).toEqual({ pass: 0, fail: 0, warn: 0, unknown: 0 });
  });

  it("reports score as undefined (not NaN) when every finding is unknown (zero graded findings)", () => {
    const run: ScanRun = { ...BASE_RUN, findings: [finding("unknown"), finding("unknown")] };
    const summary = summarizeScanRun(run);
    expect(summary.score).toBeUndefined();
    expect(summary.counts).toEqual({ pass: 0, fail: 0, warn: 0, unknown: 2 });
  });

  it("passes run.grade through verbatim and never invents a letter grade for the fallback score", () => {
    const run: ScanRun = { ...BASE_RUN, grade: undefined, findings: [finding("pass")] };
    expect(summarizeScanRun(run).grade).toBeUndefined();
  });
});

describe("capHistory", () => {
  function summaryAt(i: number): RunSummary {
    return {
      scannedAt: new Date(2026, 0, i + 1).toISOString(),
      score: i,
      grade: "C",
      counts: { pass: 1, fail: 0, warn: 0, unknown: 0 },
    };
  }

  it("returns an empty array for N=0 without crashing", () => {
    expect(capHistory([])).toEqual([]);
  });

  it("returns the single entry unchanged for N=1", () => {
    const single = [summaryAt(0)];
    expect(capHistory(single)).toEqual(single);
  });

  it("returns everything unchanged when under the cap", () => {
    const summaries = Array.from({ length: 10 }, (_, i) => summaryAt(i));
    expect(capHistory(summaries, 52)).toEqual(summaries);
  });

  it("caps at 52 by default, keeping the most recent (last) entries in order", () => {
    const summaries = Array.from({ length: 60 }, (_, i) => summaryAt(i));
    const capped = capHistory(summaries);
    expect(capped).toHaveLength(52);
    expect(capped[0]).toEqual(summaries[8]); // oldest 8 dropped
    expect(capped[capped.length - 1]).toEqual(summaries[59]);
  });

  it("respects an explicit max override", () => {
    const summaries = Array.from({ length: 5 }, (_, i) => summaryAt(i));
    const capped = capHistory(summaries, 3);
    expect(capped).toEqual([summaries[2], summaries[3], summaries[4]]);
  });

  it("drops a consecutive duplicate scannedAt, keeping the first occurrence", () => {
    // Real cause: two different commits (e.g. an unrelated squash-merge) can produce
    // byte-identical content for a data/scans/<id>.json path, so git log -- <path> returns
    // both even though only one represents a real distinct scan run.
    const a = summaryAt(0);
    const duplicate = { ...summaryAt(1), scannedAt: a.scannedAt };
    const b = summaryAt(2);
    expect(capHistory([a, duplicate, b])).toEqual([a, b]);
  });

  it("keeps entries with distinct scannedAt even when other fields are identical", () => {
    const a = summaryAt(0);
    const b = { ...summaryAt(0), scannedAt: summaryAt(1).scannedAt };
    expect(capHistory([a, b])).toEqual([a, b]);
  });

  it("collapses more than two consecutive duplicates down to one", () => {
    const a = summaryAt(0);
    const dup1 = { ...summaryAt(1), scannedAt: a.scannedAt };
    const dup2 = { ...summaryAt(2), scannedAt: a.scannedAt };
    const b = summaryAt(3);
    expect(capHistory([a, dup1, dup2, b])).toEqual([a, b]);
  });
});
