import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addIssueComment,
  createIssue,
  findOpenIssueByTitle,
  updateIssueBody,
  type GitHubRepoRef,
} from "../../src/remediation/github.js";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findOpenIssueByTitle", () => {
  it("returns the issue when an open issue's title matches exactly", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse([
        { number: 1, title: "unrelated", body: "x", state: "open", html_url: "https://x/1" },
        {
          number: 2,
          title: "[agent-readiness] qte77-github-io remediation",
          body: "y",
          state: "open",
          html_url: "https://x/2",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const found = await findOpenIssueByTitle(
      ref,
      "[agent-readiness] qte77-github-io remediation",
      token,
    );

    expect(found?.number).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues?state=open&per_page=100&page=1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("ignores pull requests sharing the issues endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse([
        {
          number: 3,
          title: "match-title",
          body: null,
          state: "open",
          html_url: "https://x/3",
          pull_request: {},
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const found = await findOpenIssueByTitle(ref, "match-title", token);

    expect(found).toBeNull();
  });

  it("returns null when no page ever contains a matching title", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `issue-${i}`,
      body: null,
      state: "open",
      html_url: `https://x/${i}`,
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const found = await findOpenIssueByTitle(ref, "does-not-exist", token);

    expect(found).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues?state=open&per_page=100&page=2",
      expect.anything(),
    );
  });

  it("returns the lowest-numbered match when more than one open issue shares the title (dup-state safety)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse([
        { number: 50, title: "dup-title", body: null, state: "open", html_url: "https://x/50" },
        { number: 12, title: "dup-title", body: null, state: "open", html_url: "https://x/12" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const found = await findOpenIssueByTitle(ref, "dup-title", token);

    expect(found?.number).toBe(12);
  });
});

describe("createIssue / updateIssueBody / addIssueComment", () => {
  it("creates an issue via POST /repos/:owner/:repo/issues", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { number: 10, title: "t", body: "b", state: "open", html_url: "https://x/10" },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const issue = await createIssue(ref, "t", "b", token);

    expect(issue.number).toBe(10);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "t", body: "b" }) }),
    );
  });

  it("updates an issue body via PATCH /repos/:owner/:repo/issues/:number", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          number: 10,
          title: "t",
          body: "new body",
          state: "open",
          html_url: "https://x/10",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const issue = await updateIssueBody(ref, 10, "new body", token);

    expect(issue.body).toBe("new body");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues/10",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ body: "new body" }) }),
    );
  });

  it("adds a changelog comment via POST /repos/:owner/:repo/issues/:number/comments", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: 1 }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await addIssueComment(ref, 10, "changelog text", token);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/qte77/agent-readiness-kit/issues/10/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "changelog text" }),
      }),
    );
  });

  it("throws with status and body text when the GitHub API responds non-ok", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ message: "Validation Failed" }, 422),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createIssue(ref, "t", "b", token)).rejects.toThrow(/422/);
  });

  it("throws a clear error naming GITHUB_TOKEN when no explicit token is given and none is configured", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(createIssue(ref, "t", "b", "")).rejects.toThrow(/GITHUB_TOKEN/);
  });
});
