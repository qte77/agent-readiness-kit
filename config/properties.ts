/**
 * The properties this kit scans. The list itself lives in `config/properties.json` — to scan
 * another property, append an entry there (config, not code); it is validated on load.
 * `id` matches the `data/scans/<id>.json` filename (kebab-case, no dots/slashes).
 */
import rawProperties from "./properties.json" with { type: "json" };

export interface PropertyConfig {
  id: string;
  url: string;
  /** Short human label used in issue titles / remediation output. */
  label: string;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Validate a parsed properties list against `PropertyConfig`. Throws naming the bad entry. */
export function parseProperties(input: unknown): PropertyConfig[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("config/properties.json: expected a non-empty array of properties");
  }
  const seen = new Set<string>();
  return input.map((entry: unknown, i) => {
    const fail = (why: string): never => {
      throw new Error(`config/properties.json: properties[${i}] ${why}`);
    };
    if (typeof entry !== "object" || entry === null) return fail("is not an object");
    const { id, url, label } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("needs a kebab-case id");
    if (seen.has(id)) return fail(`repeats id "${id}"`);
    if (!isHttpUrl(url)) return fail("needs an http(s) url");
    if (typeof label !== "string" || label.trim() === "") return fail("needs a non-empty label");
    seen.add(id);
    return { id, url: url as string, label };
  });
}

export const PROPERTIES: readonly PropertyConfig[] = parseProperties(rawProperties);
