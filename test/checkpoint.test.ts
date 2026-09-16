import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkpointPath, readCheckpoint, writeCheckpoint } from "../src/checkpoint.js";
import type { ScanRun } from "../src/types.js";

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "arc-checkpoint-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const RUN_A: ScanRun = {
  propertyId: "qte77-github-io",
  url: "https://qte77.github.io",
  scannedAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
  findings: [
    {
      id: "wellKnown.agent-card-json",
      category: "Discovery",
      source: "wellKnown",
      status: "fail",
      summary: "GET /.well-known/agent-card.json returned 404",
      remediation: "Publish an A2A agent card at /.well-known/agent-card.json",
      evidence: { httpStatus: 404 },
    },
  ],
  score: 56,
  grade: "C",
};

describe("checkpointPath", () => {
  it("joins baseDir and propertyId into a .json path", () => {
    expect(checkpointPath("qte77-github-io", "data/scans")).toBe("data/scans/qte77-github-io.json");
  });

  it("defaults baseDir to data/scans", () => {
    expect(checkpointPath("qte77-github-io")).toBe("data/scans/qte77-github-io.json");
  });
});

describe("writeCheckpoint / readCheckpoint round-trip", () => {
  it("round-trips a full ScanRun (findings with evidence, score, grade) verbatim", async () => {
    await writeCheckpoint(RUN_A, baseDir);
    const loaded = await readCheckpoint(RUN_A.propertyId, baseDir);
    expect(loaded).toEqual(RUN_A);
  });

  it("round-trips a ScanRun with optional score/grade omitted", async () => {
    const run: ScanRun = {
      propertyId: "sortmy-london",
      url: "https://sortmy.london",
      scannedAt: new Date("2026-09-16T00:00:00.000Z").toISOString(),
      findings: [],
    };
    await writeCheckpoint(run, baseDir);
    const loaded = await readCheckpoint(run.propertyId, baseDir);
    expect(loaded).toEqual(run);
    expect(loaded.score).toBeUndefined();
    expect(loaded.grade).toBeUndefined();
  });

  it("overwrites a prior checkpoint for the same property (latest write wins)", async () => {
    const first: ScanRun = { ...RUN_A, score: 56, grade: "C" };
    const second: ScanRun = { ...RUN_A, score: 78, grade: "B", findings: [] };

    await writeCheckpoint(first, baseDir);
    await writeCheckpoint(second, baseDir);
    const loaded = await readCheckpoint(RUN_A.propertyId, baseDir);

    expect(loaded).toEqual(second);
  });

  it("creates baseDir (including missing nested parents) if it doesn't exist yet", async () => {
    const nested = join(baseDir, "nested", "deeper");
    await writeCheckpoint(RUN_A, nested);
    const loaded = await readCheckpoint(RUN_A.propertyId, nested);
    expect(loaded).toEqual(RUN_A);
  });

  it("rejects when no checkpoint has been written for that property yet", async () => {
    await expect(readCheckpoint("never-scanned", baseDir)).rejects.toThrow();
  });
});
