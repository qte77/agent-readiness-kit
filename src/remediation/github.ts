/**
 * Minimal GitHub REST API v3 client — zero runtime dependencies, plain `fetch` only
 * (see docs/architecture.md's "Dependency policy (runtime)").
 *
 * Production usage: this runs inside a GHA job, where the runner provides the
 * `GITHUB_TOKEN` secret. Note that GHA does NOT set `GITHUB_TOKEN` as a step's
 * environment variable automatically — the workflow YAML must map it explicitly
 * (`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, or `github.token`) and grant
 * `permissions: issues: write` (verified against
 * https://docs.github.com/en/actions/security-guides/automatic-token-authentication).
 * That wiring belongs to `.github/workflows/scan.yml` (arc row 11); this module only
 * reads `process.env.GITHUB_TOKEN` once it's there.
 *
 * Callers (e.g. src/remediation/issue.ts, its tests) may pass an explicit `token`
 * argument to every function here instead, which always takes precedence over the
 * environment — this is how tests supply a fake token without touching
 * `GITHUB_TOKEN`/`GH_TOKEN` at all.
 */

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "agent-readiness-kit";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
}

/** Shape returned by GitHub's issues endpoints; pull requests share this endpoint too. */
interface RawGitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  pull_request?: unknown;
}

function resolveToken(explicitToken?: string): string {
  const token = explicitToken ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. In GHA, the workflow must map it explicitly " +
        "(env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}) and grant " +
        "`permissions: issues: write` — GHA does not inject it automatically. " +
        "Outside a GHA job, pass an explicit token argument instead.",
    );
  }
  return token;
}

function requestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };
}

async function githubRequest(
  path: string,
  init: { method: string; body?: string },
  token: string,
): Promise<Response> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: init.method,
    body: init.body,
    headers: requestHeaders(token),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API ${init.method} ${path} failed: ${response.status} ${response.statusText} — ${text}`,
    );
  }
  return response;
}

function toGitHubIssue(raw: RawGitHubIssue): GitHubIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state === "closed" ? "closed" : "open",
    html_url: raw.html_url,
  };
}

/**
 * Search OPEN issues in the repo for an exact title match, paginating through
 * `per_page=100` pages until a short page signals the end. Uses the plain "list
 * issues" endpoint rather than the Search API, which has known indexing lag and
 * would risk a dedup miss right after an issue is created/updated. Pull requests
 * (which share this endpoint) are filtered out. Matching is exact-title-equality
 * only — never fuzzy/substring — so a differently-worded issue can never be
 * mistaken for the dedup target. When more than one open issue matches (the very
 * duplicate-issue state this dedup logic exists to prevent), the lowest issue
 * number is returned so the canonical target is deterministic regardless of API
 * sort order. See docs/architecture.md's "Dedup-safe issue creation".
 */
export async function findOpenIssueByTitle(
  ref: GitHubRepoRef,
  title: string,
  token?: string,
): Promise<GitHubIssue | null> {
  const resolvedToken = resolveToken(token);
  const perPage = 100;
  let bestMatch: RawGitHubIssue | null = null;

  for (let page = 1; ; page++) {
    const response = await githubRequest(
      `/repos/${ref.owner}/${ref.repo}/issues?state=open&per_page=${perPage}&page=${page}`,
      { method: "GET" },
      resolvedToken,
    );
    const rawIssues = (await response.json()) as RawGitHubIssue[];
    for (const raw of rawIssues) {
      if (raw.pull_request || raw.title !== title) continue;
      if (!bestMatch || raw.number < bestMatch.number) bestMatch = raw;
    }
    if (rawIssues.length < perPage) break;
  }

  return bestMatch ? toGitHubIssue(bestMatch) : null;
}

/** Create a new issue. */
export async function createIssue(
  ref: GitHubRepoRef,
  title: string,
  body: string,
  token?: string,
): Promise<GitHubIssue> {
  const resolvedToken = resolveToken(token);
  const response = await githubRequest(
    `/repos/${ref.owner}/${ref.repo}/issues`,
    { method: "POST", body: JSON.stringify({ title, body }) },
    resolvedToken,
  );
  return toGitHubIssue((await response.json()) as RawGitHubIssue);
}

/** Replace an existing issue's body in place (never touches its title). */
export async function updateIssueBody(
  ref: GitHubRepoRef,
  issueNumber: number,
  body: string,
  token?: string,
): Promise<GitHubIssue> {
  const resolvedToken = resolveToken(token);
  const response = await githubRequest(
    `/repos/${ref.owner}/${ref.repo}/issues/${issueNumber}`,
    { method: "PATCH", body: JSON.stringify({ body }) },
    resolvedToken,
  );
  return toGitHubIssue((await response.json()) as RawGitHubIssue);
}

/** Append a changelog comment to an existing issue. */
export async function addIssueComment(
  ref: GitHubRepoRef,
  issueNumber: number,
  body: string,
  token?: string,
): Promise<void> {
  const resolvedToken = resolveToken(token);
  await githubRequest(
    `/repos/${ref.owner}/${ref.repo}/issues/${issueNumber}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
    resolvedToken,
  );
}
