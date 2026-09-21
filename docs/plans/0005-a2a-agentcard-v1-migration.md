---
title: Agent-Readiness Kit — A2A AgentCard v1.0.0 migration
description: Fix the a2a-agent-card signal's real functional-risk schema drift (A2A protocol v0.3.0→v1.0.0) in the static shape check and the live JSON-RPC probe, using the fully-resolved v1.0.0 schema — promoted from arc 0004's row 5 once that research was completed.
date: 2026-09-21
updated: 2026-09-21
status: closed
issues: []
predecessor: 4
---

# Arc 0005 — A2A AgentCard v1.0.0 migration

## Status (read this first — onboards the next session)

**Closed 2026-09-21 — shipped in full, same day as planned.** All 3 rows done: row 1 (PR #61) and
row 2 (PR #62) were dispatched genuinely in parallel across 2 git worktrees, as planned; both
merged clean with zero file overlap. Row 3 (cross-module verification) confirmed the two
independently-written pieces compose correctly — see "At arc close" for the concrete evidence.

**What shipped, in order** (full detail in the remaining-work table):
1. Rows 1 and 2 — dispatched in parallel, each its own git worktree, unlike arc 0003. **Shipped.**
   See "Why this is parallelizable" below for why that was the correct call here, not a shortcut
   — it held up: neither agent touched the other's files, both implemented the same
   already-specified algorithm without needing to coordinate.
2. Row 3 — verification, after both 1 and 2 merged. **Shipped**, done directly (not dispatched),
   per the plan.

**The loop** (same one used for every prior row this session): RED-first test → minimum
implementation → `npx vitest run` + `npx tsc --noEmit` green → commit on a topic branch → push +
open PR (don't merge from inside a dispatched agent — that's the coordinating session's job,
after CI/CodeQL are green and after the owner approves the merge) → `gh pr merge --squash --admin
--delete-branch` → delete branch (remote + local) → `git fetch --prune`.

**Owner-gates:** none for rows 1-2 (agent-gated, no secrets, no new external calls — this is a
citation/schema-shape fix to code that already exists). Row 3 is also agent-gated but needs
judgment, not just execution — do it directly rather than dispatching.

**Commands:** same as every prior arc this session —
```bash
cd /workspaces/qte77/agent-readiness-kit
npm install
npx vitest run          # test suite (vitest 5 — see watch-out below)
npx tsc --noEmit         # typecheck
```

**Watch-outs:**
- `env -u GH_TOKEN -u GITHUB_TOKEN` on every git/gh call; `git config commit.gpgsign false`
  before committing; no literal `()`/`<>` in inline `-m`/`--body` text — use `-F`/`--body-file`;
  `/usr/bin/git` (not bare `git`) inside worktrees. All standing gotchas for this whole repo, not
  new to this arc — see arc 0003/0004's plan docs for the full original context if needed.
- **vitest 5** (bumped this session, PR #51/#52): this sandbox's `rtk` output wrapper cannot
  parse vitest 5's console summary format (`[RTK:PASSTHROUGH] vitest parser: All parsing tiers
  failed`) — it still writes a real JSON report to `.vitest/json/output.json` (gitignored). Read
  `numTotalTests`/`numPassedTests`/`numFailedTests`/`success` from that file directly (e.g. via a
  short Python snippet) instead of trusting the truncated console output.
- **`mcpA2aProbe.test.ts`'s existing tests already assert the OLD wire format** (line 60:
  `expect(requestBody.method).toBe("message/send")`; line 61:
  `expect(requestBody.params.message.role).toBe("user")`) — these are not just missing new
  cases, they assert values that must actively change to `"SendMessage"`/`"ROLE_USER"`. Don't
  just add new tests alongside stale ones; update these two assertions, or the suite will be
  internally contradictory (old test asserting the old, wrong wire format your new code no
  longer produces).
- The two files' existing `AGENT_CARD_PATH` constant is **already duplicated** between
  `cloudflareMcp.ts` and `mcpA2aProbe.ts` (established precedent, not a bug) — the new
  endpoint-extraction helper (row 2 below) should follow the same precedent: implemented
  independently in each file, not factored into a shared module. See "Design decisions" below.

## Context

Arc 0004's crosswalk audit (`docs/plans/0004-crosswalk-accuracy-and-gaps.md`) found
`a2a-agent-card` is the one signal with a real functional-risk schema drift: the A2A protocol
moved v0.3.0→v1.0.0, and this repo's static shape check (`cloudflareMcp.ts`) and live JSON-RPC
probe (`mcpA2aProbe.ts`) still assume the old shape. That arc's row 5 explicitly gated
implementation on first reading the complete `a2a.proto` schema, since the research available at
the time only confirmed individual field names/requiredness, not the full message shapes needed
to write a correct, non-false-failing check. That research is now done (this session,
2026-09-21) and found more drift than the earlier partial pass did — enough that this was worth
a dedicated plan-mode pass and its own plan doc rather than a quick inline fix.

## Findings (verified at source, 2026-09-21)

Fetched `github.com/a2aproject/A2A`'s `specification/a2a.proto` and `docs/specification.md`
**directly via raw GitHub content** (not the rendered `a2a-protocol.org` site, which truncates
before reaching the relevant examples in every attempt made this session).

- **`AgentCard`** (JSON representation; spec §5.5: "All JSON serializations of the A2A protocol
  data model MUST use camelCase naming... not the snake_case convention used in Protocol Buffer
  definitions"). Proto-level `REQUIRED` fields (`google.api.field_behavior`), 8 total: `name`,
  `description`, `supported_interfaces` (JSON `supportedInterfaces`), `version`, `capabilities`,
  `default_input_modes` (`defaultInputModes`), `default_output_modes` (`defaultOutputModes`),
  `skills`. Arc 0004's research only confirmed the first 3. **No flat `url` field exists anywhere
  on `AgentCard`** in v1.0.0 — fully replaced by `supportedInterfaces`.
- **`AgentInterface`** (each entry in `supportedInterfaces[]`): `url`, `protocol_binding`
  (`protocolBinding`), `protocol_version` (`protocolVersion`) all `REQUIRED`; optional `tenant`.
  Real example, quoted verbatim from the spec's own Sample Agent Card (§8.5):
  ```json
  "supportedInterfaces": [
    {"url": "https://georoute-agent.example.com/a2a/v1", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"},
    {"url": "https://georoute-agent.example.com/a2a/grpc", "protocolBinding": "GRPC", "protocolVersion": "1.0"}
  ]
  ```
- **JSON-RPC method name**: `"SendMessage"`, confirmed via the spec's own Method Mapping
  Reference table (§5.3): `| Send message | SendMessage | SendMessage | POST /message:send |`.
  Not `"message/send"` (the v0.3.0 name this repo's code still sends). REST binding separately:
  `POST /message:send`.
- **`Message.role`**: proto enum `Role { ROLE_UNSPECIFIED = 0; ROLE_USER = 1; ROLE_AGENT = 2; }`
  — JSON value is the enum's name string, `"ROLE_USER"`, confirmed via a real example
  (`"role": "ROLE_USER"`) in the spec's Basic Task Execution walkthrough (§6.1). This repo's code
  currently sends `role: "user"` (lowercase, no `ROLE_` prefix) — wrong for v1.0.0.
- **`Part`**: proto `oneof content { string text = 1; bytes raw = 2; string url = 3;
  google.protobuf.Value data = 4; }` plus `metadata`/`filename`/`media_type`. A proto `oneof`
  serializes in JSON as just the active field directly on the containing object — confirmed by
  the same real example's `"parts": [{"text": "What is the weather today?"}]`, **no `"kind"`
  discriminator key**. This repo's code currently sends `{ kind: "text", text: "…" }` — the
  `kind` key does not exist in v1.0.0's wire format and must be dropped, not just relabeled.
- **`SendMessageRequest`**: `{ tenant?: string; message: Message (REQUIRED); configuration?;
  metadata?: google.protobuf.Struct }`. **`SendMessageResponse`**: `oneof payload { Task task;
  Message message; }`, wrapped in the outer JSON-RPC envelope's `result` key exactly as before —
  this repo's `isJsonRpcResult`/`isJsonRpcError` functions (`mcpA2aProbe.ts:38-48`) only inspect
  the outer `jsonrpc`/`result`/`error` keys and never look inside `result`, so **they need no
  change** — the drift is entirely in the outbound request, not the inbound-response envelope
  parsing.
- **`messageId`** (the one field this repo's probe already sets on the outbound `Message`) was
  already camelCase in the existing code (`mcpA2aProbe.ts:32`) — no change needed there,
  coincidentally already correct.

*Hedge:* these are all read directly from the raw proto/markdown source on GitHub's `main`
branch, cross-checked against each other (the JSON examples in `docs/specification.md` agree with
the field-name casing the `a2a.proto`'s REQUIRED annotations + proto3 JSON-mapping conventions
would predict) — high confidence, not a single unconfirmed source. Not independently verified
against a second, non-GitHub mirror of the spec.

## Design decisions

1. **Static shape check (`cloudflareMcp.ts`)** — drop `["url", "string"]` from `AGENT_CARD_KEYS`
   (`cloudflareMcp.ts:48-55`). Add a small dedicated post-check specifically for the A2A card's
   result (not a generic `KeySpec`, since it's an OR across two differently-typed/named fields,
   which the existing `KeySpec`/`missingKeys` model can't express): the check passes only if
   `body.url` is a non-empty string **or** `body.supportedInterfaces` is a non-empty array — this
   is the "accept either shape" leniency arc 0004's row 5 asked for, so a real v0.3.0-era card
   doesn't suddenly fail. Keep it minimal — presence + type only, matching this module's own
   documented policy ("Both checks only verify presence + a handful of basic key/type checks —
   not a full schema", `cloudflareMcp.ts:22-23`). Do **not** attempt to validate all 8 v1.0.0
   `REQUIRED` fields found above; that would be a scope increase this module has never done for
   either signal it owns.
2. **Live probe (`mcpA2aProbe.ts`)** — this module independently re-fetches and re-parses the
   card by design (module independence — no cross-module Finding passing, per
   `docs/architecture.md`; see the module's own docstring, lines 5-7), so it needs its own
   endpoint-extraction logic, using the identical algorithm to (1) but for extraction rather than
   presence-checking: if `cardBody.url` is a non-empty string, use it (legacy shape); else if
   `cardBody.supportedInterfaces` is a non-empty array, find the entry whose `protocolBinding`
   case-insensitively equals `"jsonrpc"` and use **its** `url`; else no usable endpoint (same
   `"unknown"` Finding path that already exists today for a missing `url`,
   `mcpA2aProbe.ts:100-107`).
   Update `buildMessageSendRequest()` (`mcpA2aProbe.ts:23-36`): `method: "SendMessage"` (was
   `"message/send"`), `role: "ROLE_USER"` (was `"user"`), drop the `kind: "text"` key from the
   part entirely (was `{ kind: "text", text: "…" }`, now just `{ text: "…" }`). The outbound
   request always targets the current v1.0.0 wire format — no dual-format *sending* (the
   read-leniency in decision 1 is for *accepting* a real card either way; this repo isn't
   required to also speak the old wire format outbound, and none of the 3 tracked properties
   currently publish any agent-card at all, so there's no real legacy A2A server in practice to
   accommodate by sending the old shape).
   Duplicating the small endpoint-extraction helper across both files, rather than factoring it
   into a shared module, matches this codebase's own existing precedent — both files already
   independently define their own `AGENT_CARD_PATH` constant for the same reason (module
   independence is a deliberate property of this pair of modules, not an oversight). A shared
   helper can be extracted later if a third consumer of this logic appears (YAGNI).
3. Update both modules' doc comments and remediation/citation text: `a2a-protocol.org/v0.3.0` →
   `a2a-protocol.org/v1.0.0` throughout (`cloudflareMcp.ts:44`, `mcpA2aProbe.ts:9-10`), and the
   `cloudflareMcp.ts:166` remediation string `"A2A agent card
   (name/description/url/version/capabilities/skills[])"` → reflect that `url` is now
   `url-or-supportedInterfaces`.

## Why this is parallelizable (unlike arc 0003)

Arc 0003 was correctly single-worktree because its row 2 literally could not render until row 1's
new `categoryStatus` field existed on `RunSummary` — a real, hard dependency. Here, once the
schema is resolved (done above, during planning — not left for the implementing agents to
redo or potentially disagree on), the two code changes are **fully file-independent**:
`cloudflareMcp.ts` + `test/scan/sources/cloudflareMcp.test.ts` (row 1) vs. `mcpA2aProbe.ts` +
`test/scan/sources/mcpA2aProbe.test.ts` (row 2) — zero file overlap, and each agent implements
the *same, already-fully-specified* algorithm given verbatim in "Design decisions" above, rather
than inventing its own — so there's no risk of the two agents designing incompatible logic that
then fails to compose. This matches arc 0001's precedent (seven independent scan-source modules
dispatched in parallel across worktrees), not arc 0002/0003's single-dependency-chain case.

## Source map

| File | What's there now | What changes |
|---|---|---|
| `src/scan/sources/cloudflareMcp.ts` | `AGENT_CARD_KEYS` (lines 48-55, includes `["url","string"]`); `checkWellKnownJson` (lines 74-137, generic, shared with `mcp-server-card` — **do not change its generic logic**); `scanCloudflareMcp` (lines 151-174, invokes both checks, builds Findings); module docstring (lines 1-24) cites `a2a-protocol.org/v0.3.0` at line 44 and remediation text at line 166 | Row 1 |
| `test/scan/sources/cloudflareMcp.test.ts` | `describe("a2a-agent-card (static shape)")` block, lines 112-163: a "passes" case with a full `url`+other-keys card (lines 113-135), a "fails on 404" case (137-149), a "warns when required keys are missing" case using `{name: "Example"}` only (151-162) | Row 1 — add a `supportedInterfaces`-only passing case, and confirm the existing "warns" case (which has neither `url` nor `supportedInterfaces`) still warns, not passes |
| `src/scan/sources/mcpA2aProbe.ts` | `buildMessageSendRequest()` (lines 23-36: `method: "message/send"`, `role: "user"`, `{kind:"text", text:...}`); endpoint read at lines 95-98 (`cardBody["url"]`); module docstring (lines 1-15) cites v0.3.0 at lines 9-10 | Row 2 |
| `test/scan/sources/mcpA2aProbe.test.ts` | First test ("passes with a strong verdict...", lines 29-63) **asserts the OLD format directly** — line 60 `expect(requestBody.method).toBe("message/send")`, line 61 `expect(requestBody.params.message.role).toBe("user")`. All other tests' fixtures use `{url: ENDPOINT}` or `{name: "Example Agent", url: ENDPOINT}` cards (lines 32, 67, 84, 96, 107, 118, 140) | Row 2 — **update** lines 60-61's assertions to the new values (not just add new tests); add a `supportedInterfaces`-only card fixture (probe should extract the JSONRPC-binding entry's `url`) and a multi-interface fixture (JSONRPC entry not first in the array, to prove selection isn't just "take index 0") |
| `docs/plans/0004-crosswalk-accuracy-and-gaps.md` | Row 5 in the remaining-work table still describes the not-yet-researched version of this work | Row 3 — one-line update: point to this doc instead of re-describing (single source of truth, per this repo's own plan-doc convention) |

## Remaining-work table (SINGLE source of open work)

| # | Item | Gate | Depends on | Done-when |
|---|------|------|------------|-----------|
| 1 | ~~`cloudflareMcp.ts` static shape check: drop required `url`, add url-or-supportedInterfaces leniency...~~ **Shipped 2026-09-21 (PR #61).** Implemented as an `extraCheck` predicate threaded through `checkWellKnownJson` (a small deviation from "post-check" wording — same effect, `checkWellKnownJson` didn't expose the parsed body to a separate post-hoc function). 157/157 tests passing, `npx tsc --noEmit` clean. | agent (worktree A, parallel with row 2) | — | Done |
| 2 | ~~`mcpA2aProbe.ts` live probe: `SendMessage` method, `ROLE_USER` role, part without `kind`, new endpoint-extraction...~~ **Shipped 2026-09-21 (PR #62).** Also swept remaining `message/send`-citing remediation/summary strings and test titles the plan's design decision 3 covered but didn't enumerate line-by-line. 157/157 tests passing, `npx tsc --noEmit` clean, zero file overlap with row 1. | agent (worktree B, parallel with row 1) | — | Done |
| 3 | ~~Verification: after both 1 and 2 merge...~~ **Shipped 2026-09-21.** Full suite green post-merge (159/159). Cross-module synthetic-AgentCard check (a real v1.0.0 shape: `supportedInterfaces` with a GRPC entry *and* a JSONRPC entry, no flat `url`) confirmed both pieces compose: the static check passed it, and the live probe correctly selected the JSONRPC entry over GRPC (proving selection filters by `protocolBinding`, not array order) and sent a request with `method: "SendMessage"`, `role: "ROLE_USER"`, and no `kind` key on the part. Verification test was temporary (not committed — a one-off cross-module check, not a permanent fixture; each module's own PR already has thorough permanent coverage). | agent (direct, not dispatched) | 1, 2 | Done |

## Tests (strict RED-first; modules only)

Both `cloudflareMcp.ts` and `mcpA2aProbe.ts` are `src/scan/sources/*.ts` modules — RED-first TDD
applies per `AGENTS.md`, same bar every other module in this directory already meets. No
config/wiring exemption applies here (unlike, say, `site/app.js`).

## Verification

- Each of rows 1-2, independently: `npx vitest run` + `npx tsc --noEmit` green in its own
  worktree before opening its PR. Remember the vitest-5 JSON-report watch-out above — read
  `.vitest/json/output.json` if the console summary doesn't render.
- Row 3, after both merge: full suite green on `main`; the cross-module synthetic-AgentCard
  check described in the table above (this is the one thing that can only be verified once both
  pieces exist together — neither row 1 nor row 2 alone can prove the two compose correctly).

## At arc close

**Closed 2026-09-21.** All 3 rows shipped same-day as planned (PRs #61, #62; row 3 verified
directly). The JSONRPC-binding interface selection needed no different handling than described —
the design held up exactly as specified, confirmed by a multi-interface test fixture (row 2) and
the cross-module verification (row 3) both putting the GRPC entry first in the array specifically
to prove selection filters by `protocolBinding` rather than defaulting to index 0. Two minor,
harmless deviations from the literal plan text, both already noted in the table: row 1's shape
check is an `extraCheck` predicate rather than a separate post-hoc function (same effect); row 2
additionally swept stale `message/send`-citing prose beyond the plan's line-by-line enumeration
(within the scope design decision 3 already called for). Arc 0004's row 5 already points here
as the closed-out detail rather than re-describing it there.
