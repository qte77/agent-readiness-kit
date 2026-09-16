import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding, ScanRun } from "../../src/types.js";
import type { GitHubRepoRef } from "../../src/remediation/github.js";
import {
  buildChangelogComment,
  buildIssueBody,
  remediationIssueTitle,
  upsertRemediationIssue,
} from "../../src/remediation/issue.js";

const ref: GitHubRepoRef = { owner: "qte77", repo: "agent-readiness-kit" };
const token = "test-token";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const failingFinding: Finding = {
  id: "wellKnown.agent-card-json",
  category: "Discovery",
  source: "wellKnown",
  status: "fail",
  summary: "GET /.well-known/agent-card.json returned 404",
  remediation: "Publish an A2A agent card at /.well-known/agent-card.json",
};

const scanRun: ScanRun = {
  propertyId: "qte77-github-io",
  url: "https://qte77.github.io",
  scannedAt: "2026-09-16T00:00:00.000Z",
  findings: [failingFinding],
  score: 42,
  grade: "D",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upsertRemediationIssue — dedup search-then-update-or-create", () => {
  it("(a) existing open issue found -> updates its body in place and appends a changelog comment, never creating a duplicate", async () => {
    const existingIssue = {
      number: 42,
      title: remediationIssueTitle("qte77-github-io"),
      body: "stale body",
      state: "open",
      html_url: "https://github.com/qte77/agent-readiness-kit/issues/42",
    };
    const fetchMock = vi
      .fn()
      // 1. dedup search
      .mockResolvedValueOnce(jsonResponse([existingIssue]))
      // 2. PATCH body update
      .mockResolvedValueOnce(jsonResponse({ ...existingIssue, body: "new body" }))
      // 3. POST changelog comment
      .mockResolvedValueOnce(jsonResponse({ id: 1 }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertRemediationIssue(ref, scanRun, "qte77.github.io", token);

    expect(result).toEqual({
      action: "updated",
      issueNumber: 42,
      url: "https://github.com/qte77/agent-readiness-kit/issues/42",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Call 1 must be the dedup search — GET .../issues?state=open... — before anything else.
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/repos/qte77/agent-readiness-kit/issues?state=open"),
      expect.objectContaining({ method: "GET" }),
    );
    // Call 2 must be the PATCH against the existing issue's own number.
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues/42",
      expect.objectContaining({ method: "PATCH" }),
    );
    // Call 3 must be the changelog comment on the same existing issue.
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues/42/comments",
      expect.objectContaining({ method: "POST" }),
    );

    // Never a POST to the bare issues-create endpoint — no duplicate is ever created.
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "https://api.github.com/repos/qte77/agent-readiness-kit/issues" &&
        init.method === "POST",
    );
    expect(createCall).toBeUndefined();
  });

  it("(b) no matching open issue found -> creates a new issue instead of updating anything", async () => {
    const fetchMock = vi
      .fn()
      // 1. dedup search — empty, no match
      .mockResolvedValueOnce(jsonResponse([]))
      // 2. POST create
      .mockResolvedValueOnce(
        jsonResponse(
          {
            number: 7,
            title: remediationIssueTitle("qte77-github-io"),
            body: "new body",
            state: "open",
            html_url: "https://github.com/qte77/agent-readiness-kit/issues/7",
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertRemediationIssue(ref, scanRun, "qte77.github.io", token);

    expect(result).toEqual({
      action: "created",
      issueNumber: 7,
      url: "https://github.com/qte77/agent-readiness-kit/issues/7",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Call 1 must still be the dedup search — the gate always runs first.
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/repos/qte77/agent-readiness-kit/issues?state=open"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues",
      expect.objectContaining({ method: "POST" }),
    );
    const [, createInit] = fetchMock.mock.calls[1]!;
    const sentBody = JSON.parse(createInit.body as string);
    expect(sentBody.title).toBe(remediationIssueTitle("qte77-github-io"));

    // No PATCH call — nothing existing was touched.
    const patchCall = fetchMock.mock.calls.find(([, init]) => init.method === "PATCH");
    expect(patchCall).toBeUndefined();
  });
});

describe("remediationIssueTitle", () => {
  it("is a fixed, deterministic marker per property id", () => {
    expect(remediationIssueTitle("qte77-github-io")).toBe(
      remediationIssueTitle("qte77-github-io"),
    );
    expect(remediationIssueTitle("qte77-github-io")).not.toBe(
      remediationIssueTitle("sortmy-london"),
    );
  });
});

describe("buildIssueBody", () => {
  it("includes actionable findings with category, status, and remediation text", () => {
    const body = buildIssueBody(scanRun, "qte77.github.io");

    expect(body).toContain("wellKnown.agent-card-json");
    expect(body).toContain("Discovery");
    expect(body).toContain("Publish an A2A agent card");
    expect(body).toContain("qte77-github-io");
  });

  it("reports no outstanding findings when every finding passes", () => {
    const cleanRun: ScanRun = {
      ...scanRun,
      findings: [{ ...failingFinding, status: "pass", remediation: undefined }],
    };

    const body = buildIssueBody(cleanRun, "qte77.github.io");

    expect(body).toContain("No outstanding findings");
  });
});

describe("buildChangelogComment", () => {
  it("records the scan timestamp and count of outstanding findings", () => {
    const comment = buildChangelogComment(scanRun);

    expect(comment).toContain(scanRun.scannedAt);
    expect(comment).toContain("Outstanding findings: 1");
  });
});
