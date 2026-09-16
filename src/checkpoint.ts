/**
 * Read/write the per-property scan checkpoint at `data/scans/<propertyId>.json`.
 *
 * Per docs/architecture.md's "State / trend history" decision: one committed JSON file per
 * property, overwritten each run — git history is the trend record, no KV store, no
 * database, no separate history file. This module is the only place that touches that
 * directory; it round-trips a `ScanRun` (src/types.ts) verbatim.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScanRun } from "./types.js";

/** Directory holding one checkpoint file per property, relative to the process cwd. */
export const SCANS_DIR = "data/scans";

/** Path to the checkpoint file for a given property id, under `baseDir` (default `SCANS_DIR`). */
export function checkpointPath(propertyId: string, baseDir: string = SCANS_DIR): string {
  return join(baseDir, `${propertyId}.json`);
}

/**
 * Persist a ScanRun, overwriting any prior checkpoint for the same property. Creates
 * `baseDir` (and any missing parents) if it doesn't exist yet.
 */
export async function writeCheckpoint(run: ScanRun, baseDir: string = SCANS_DIR): Promise<void> {
  const path = checkpointPath(run.propertyId, baseDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

/**
 * Load the last checkpoint for a property. Rejects (ENOENT) if no checkpoint has been
 * written yet — callers that need a "no prior run" case should catch and handle that
 * themselves rather than this module inventing an empty placeholder ScanRun.
 */
export async function readCheckpoint(propertyId: string, baseDir: string = SCANS_DIR): Promise<ScanRun> {
  const raw = await readFile(checkpointPath(propertyId, baseDir), "utf8");
  return JSON.parse(raw) as ScanRun;
}
