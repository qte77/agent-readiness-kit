/**
 * The properties this kit scans. Start set per docs/plans/0001-scan-engine.md.
 * `id` matches the `data/scans/<id>.json` filename (kebab-case, no dots/slashes).
 */
export interface PropertyConfig {
  id: string;
  url: string;
  /** Short human label used in issue titles / remediation output. */
  label: string;
}

export const PROPERTIES: readonly PropertyConfig[] = [
  {
    id: "qte77-github-io",
    url: "https://qte77.github.io",
    label: "qte77.github.io",
  },
  {
    id: "agenthud-agui-a2ui",
    url: "https://qte77.github.io/agenthud-agui-a2ui/",
    label: "agenthud-agui-a2ui",
  },
  {
    id: "sortmy-london",
    url: "https://sortmy.london",
    label: "sortmy.london (ldnmxx-hack)",
  },
] as const;
