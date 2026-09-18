---
title: Agent-Readiness Kit — crosswalk signal accuracy audit + gap analysis
description: Verify every scan signal's spec/RFC/draft citation at source, fix what's stale, and propose well-established signals missing from the crosswalk — triggered by a user request to explore agent-native aspects beyond what's already implemented.
date: 2026-09-18
updated: 2026-09-18
status: open
issues: []
predecessor: 3
---

# Arc 0004 — crosswalk signal accuracy audit + gap analysis

## Status (read this first — onboards the next session)

**Nothing shipped yet — planning/research only.** Triggered mid-arc-0003 by an owner request to
verify the crosswalk's existing signals against their real specs and look for well-established
signals the crosswalk is missing. Six parallel research subagents fetched primary sources
(rfc-editor.org, datatracker.ietf.org, modelcontextprotocol.io, a2a-protocol.org,
agenticresourcediscovery.org, workos.com, github.com/cloudflare) this session (2026-09-18) and
their findings are recorded verbatim-sourced in **Findings** below. This doc is the durability
step for those findings — they existed only in the triggering conversation's transcript before
this write-up.

**What's next, in order** (full detail in the remaining-work table):
1. Rows 1-4 — mechanical, low-risk fixes (probe-path fallback, comment/wording updates only, no
   behavior change to existing pass/fail grading logic). Independent of each other, safe to batch
   into one PR or split — implementer's call.
2. Row 5 — **the one row needing more research before coding**: the A2A signal has a real
   functional-risk schema drift (see Findings). Do not implement against the field-level facts
   already gathered here alone — fetch the complete `AgentCard`/`AgentInterface`/`SendMessage`
   message definitions from `specification/a2a.proto`
   (<https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto>) first; this arc's
   research confirmed individual field names/requiredness, not the full shape needed to write a
   correct, non-false-failing check.
3. Rows 6-7 — owner-gated: an upstream doc PR (different repo) and a gap-analysis decision on
   which candidate new signals (if any) to adopt.

**The loop** (same one used for every prior row this session, see `docs/plans/0003-...md` for the
full description): RED-first test → minimum implementation → `npx vitest run` + `npx tsc
--noEmit` green → commit on a topic branch → push + open PR (don't merge from inside a dispatched
agent — that's the coordinating session's job after CI/CodeFactor/CodeQL are green) → `gh pr
merge --squash --admin --delete-branch` → delete branch → `git fetch --prune`.

**Is this independent of arc 0003?** Yes, confirmed zero file overlap: arc 0003 touches
`scripts/buildSite.ts`, `test/scripts/buildSite.test.ts`, `site/app.js`, `site/style.css`; this
arc touches `src/scan/sources/*.ts` and (for row 5, eventually) its tests. Both can proceed in
parallel, each in its own worktree/branch.

**Owner-gates:** row 6 (a PR in a *different* repo, `agenthud-agui-a2ui`) and row 7 (a judgment
call on adding new signals — the crosswalk's source-of-truth table lives upstream; see
`src/scan/crosswalk.ts`'s own `assignCategory` error message, which requires registering a new
signal id there before this repo's code). Rows 1-5 are agent-gated and do not depend on either.

**Commands:** same as arc 0003 — `npm install`, `npx vitest run`, `npx tsc --noEmit`, `npm run
build && npm run site:build`.

**Watch-outs:** identical to arc 0003's list (`env -u GH_TOKEN -u GITHUB_TOKEN` on every git/gh
call, `git config commit.gpgsign false` before committing, no literal `()`/`<>` in inline
`-m`/`--body` text — use `-F`/`--body-file`, `/usr/bin/git` not bare `git` inside worktrees). Not
repeated in full here to avoid drift between two copies — see `docs/plans/0003-category-trend-indicator.md`'s
Watch-outs section, still current.

## Context

Triggered by an owner message mid-session (while arc 0003 was queued for dispatch): "we want to
explore, research and adopt best practices and store our findings... explore other agent-native
aspects too, the ones we are already using and others we might have missed... how to concisely
and actionable enhance [our docs]." The immediate prompt was two specific claims about
`src/scan/crosswalk.ts`'s `ai-catalog` and `mcp-server-card` signals (whether `server-card.json`
is real MCP spec, and what spec `ai-catalog.json` follows) — verifying those surfaced a broader
pattern worth auditing across every signal that cites an external spec/RFC/draft, per this
project's own `.claude/rules/claim-verification.md` gate ("every load-bearing factual claim...
verified at source in the same turn").

Every one of this repo's 17 crosswalk signals traces to one of 8 scan-source modules
(`src/scan/sources/*.ts`). Of those, 11 signals cite a specific external spec/RFC/draft in their
remediation text or code comments; the other 6 (`bot-rules`, `content-signal`, `markdown-twins`,
`markdown-negotiation`, `dev-resource-discovery`, `schema-type-breadth`) are heuristic/plausibility
checks with no single external spec to drift against, so were not in scope for this audit.

## Findings (verified at source, 2026-09-18)

Each finding names its source, states the verdict, and carries forward every hedge/caveat the
researching agent flagged — per `claim-verification.md`, a hedge stated during research must
survive into the artifact, not just the conversation.

### 1. `ai-catalog` — REFUTED on filename (concept correct, path stale)

Code (`src/scan/sources/wellKnown.ts:175,194-200`) probes `/.well-known/ai-catalog.json`, citing
"the Agentic Resource Discovery (ARD) convention". Verified against
<https://agenticresourcediscovery.org/spec/> (current version **v0.91**, status **"Proposal"**,
dated 2026-08-26 — an early-stage multi-vendor working-group draft, not a ratified standard;
authors/contributors span Google, Microsoft, Hugging Face, AWS, Cisco, and others).

The spec's **current canonical path is `/.well-known/ard.json`**: "A consumer resolving a
domain's entries MUST fetch `/.well-known/ard.json`, and MUST honour a `rel=\"ard\"` link."
`ai-catalog.json` was "ARD's predecessor['s]... path", now kept only as an optional
backward-compat fallback — not required, not primary. A conformant consumer needs only
`ard.json` + the `rel="ard"` link relation.

*Hedge carried forward:* the researching agent could not `curl` raw HTML directly (no Bash network
access in that sandbox) — this rests on three independent WebFetch extraction passes that agreed
with each other, not a raw-HTML diff. Treat as strong, not absolute, if this ever needs
belt-and-suspenders re-confirmation.

Note: `agenthud-agui-a2ui/docs/agent-readiness.md` (this repo's own upstream crosswalk source of
truth) independently lists the same stale `/.well-known/ai-catalog.json (ARD)` target in its own
"Remaining gaps"/"Next steps" sections — this isn't a bug unique to this repo's code, it's
inherited from the upstream doc, which is why row 6 below is a separate, cross-repo fix.

### 2. `mcp-server-card` — spec doesn't exist yet; signal name traces to an unmerged proposal

Code (`src/scan/sources/cloudflareMcp.ts:19,26-32`) probes `/.well-known/mcp/server-card.json`
for `name`/`description`/`version`/`serverUrl`/`tools[]`. Verified against
modelcontextprotocol.io's versioned spec pages:

- MCP's actual capability-discovery mechanism, in **every ratified spec version**, is a live
  JSON-RPC exchange, never a static file: `initialize` request/response through spec revision
  2025-11-25; the **current spec (2026-07-28)** replaced it with a mandatory `server/discover` RPC
  plus per-request `_meta` versioning ("Servers MUST implement it"; `initialize` is now legacy,
  kept only for backward interop with older clients/servers).
- There **is** an open, unmerged proposal literally named **"MCP Server Cards"** (SEP-2127),
  backed by an official Working Group charter page
  (<https://modelcontextprotocol.io/community/working-groups/server-card.md>), status **Draft**,
  target date **Apr 3, 2026 already passed** as of today without shipping. Its charter explicitly
  scopes it as **separate from the handshake** ("Out of Scope: Changes to the MCP initialization
  handshake or transport layer") and states the discovery mechanism itself is **still unresolved**
  ("Specification of how an MCP Server Card document is discovered (well-known URL,
  resource-based discovery, etc.)" — open question, not yet decided).
- Two adjacent, real, but distinct mechanisms not to confuse with this: (a) OAuth
  authorization-server metadata discovery (unrelated to capability/tool discovery), and (b) the
  MCP Registry's `server.json` — a real, official publish-time manifest schema at
  static.modelcontextprotocol.io, but fetched from `registry.modelcontextprotocol.io`, not the
  MCP server's own host at connection time.

*Hedge carried forward:* SEP-2127's PR/issue content came from a WebFetch AI summary (`gh auth`
returned 401 in that sandbox), not a verbatim primary read — only a `.diff` fetch of
`docs/seps/2127-mcp-server-cards.mdx` is close to primary text, and it only verbatim-confirms a
*related* `ai-catalog.json` cross-ecosystem path, not the Server Card's own discovery path.

**This repo's `mcp-server-card` check mirrors Cloudflare's own `isitagentready.com` 16-signal
check set** (see `cloudflareMcp.ts`'s module docstring), not the MCP spec directly — that's a
defensible, pre-existing design choice (mirroring an established external grader), just not
labeled as such in the code comment today.

### 3. `a2a-agent-card` — CONFIRMED STALE, real functional risk (not just a citation issue)

Code (`src/scan/sources/cloudflareMcp.ts:39-46`, `src/scan/sources/mcpA2aProbe.ts:19-36`) checks
`/.well-known/agent-card.json` requiring `name`/`description`/`url`/`version`/`capabilities`/`skills`,
then does a live JSON-RPC 2.0 `message/send` probe against the card's `url` field. Comments cite
"a2a-protocol.org/v0.3.0/specification, verified at source 2026-09-16" — **two days stale**.
Verified against <https://a2a-protocol.org/v1.0.0/specification/> and
<https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto> (primary source, current as
of today):

- **Version moved v0.3.0 → v1.0.0** (now under Linux Foundation governance, Google-contributed).
- **Well-known path unchanged**: still `/.well-known/agent-card.json` (spec §8.2, confirmed
  verbatim).
- **AgentCard required fields changed**: the proto now marks only `name`, `description`, and
  `supported_interfaces` (`repeated AgentInterface`) as `REQUIRED`. The flat `url` field this
  code requires **no longer exists** in that form — replaced by a list of interfaces. `version`,
  `capabilities`, `skills` still exist as fields but carry no REQUIRED annotation in the current
  schema.
- **JSON-RPC method renamed**: the spec's "Method Mapping Reference" table lists `SendMessage`
  (REST binding `POST /message:send`), not `message/send`, which this repo's live probe still
  sends verbatim.

**Practical consequence:** a property running a fully spec-conformant A2A v1.0.0 server may today
score `warn`/`fail` on this signal — the static shape check flags a "missing" `url` key it no
longer needs to have, and the live probe calls a JSON-RPC method the server may not recognize
under that name. This is graded pass/fail today (unlike `dns-aid`'s deliberate "too unsettled to
grade" treatment) against a spec that has already moved out from under the implementation.

*Hedge carried forward:* the JSON-RPC method-rename finding (`SendMessage` vs `message/send`) is
"one notch softer" than the other three sub-findings — confirmed via two independent fetches of
`docs/specification.md`'s method-mapping table, but the researching agent could not locate a full
literal `{"jsonrpc":"2.0",...}` request/response example to triple-confirm the exact wire string.

### 4. `web-bot-auth` — citation stale (mechanism unchanged)

Code (`src/scan/sources/contentSignal.ts:150-155`) checks
`/.well-known/http-message-signatures-directory` for a JWKS-style `keys` array, citing
"draft-meunier-http-message-signatures-directory / draft-meunier-webbotauth-httpsig-protocol".
Verified against datatracker.ietf.org: both cited drafts have expired and chain-replaced —
`draft-meunier-http-message-signatures-directory` → `draft-meunier-webbotauth-httpsig-directory`
(also expired) → `draft-meunier-webbotauth-httpsig-protocol` (expired 2026-08-19) →
**`draft-ietf-webbotauth-httpsig-protocol`**, now an **Active WG Document** under IETF's chartered
`webbotauth` working group (a real maturity upgrade: individual submission → WG-adopted).
**Well-known path and `keys`-array JWKS format are unchanged** — confirmed via a quoted live
example (`{"keys": [{"kty": "OKP", "crv": "Ed25519", "kid": "...", ...}]}`). No probe-logic
change needed, citation-string update only.

### 5. `api-catalog` (RFC 9727) and `oauth-protected-resource` (RFC 9728) — CONFIRMED EXACT

Both verified directly against rfc-editor.org primary text; both RFCs define exactly the paths
the code probes (`/.well-known/api-catalog`, `/.well-known/oauth-protected-resource`
respectively). No change needed.

### 6. `oauth-oidc-discovery` — misattributed citation (path/logic correct, wording loose)

Code probes `/.well-known/openid-configuration`, citing "RFC 8414 / OIDC Discovery". RFC 8414
("OAuth 2.0 Authorization Server Metadata") itself defines a *different* default path,
`/.well-known/oauth-authorization-server`; RFC 8414 §5 ("Compatibility Notes") explicitly
acknowledges `openid-configuration` as belonging to **OpenID Connect Discovery 1.0** (an OpenID
Foundation spec, not an IETF RFC), listed as a related-but-distinct convention. The code's
"RFC 8414 / OIDC Discovery" wording is defensible as citing both, but easy to misread as RFC 8414
defining that exact path — it doesn't. No path/logic bug; wording-only fix.

### 7. `auth-md` and `agent-skills-index` — CONFIRMED REAL, paths exact

- `auth-md`: WorkOS's open, vendor-neutral agent-registration protocol
  (<https://workos.com/auth-md>, <https://github.com/workos/auth.md>) — a prose Markdown doc at
  **site root** (not `.well-known/`) naming supported registration types and linking to the
  machine-readable OAuth Protected Resource Metadata. Code's `/auth.md` root-path probe matches
  exactly.
- `agent-skills-index`: real, externally authored — Cloudflare's **"Agent Skills Discovery RFC"**
  (<https://github.com/cloudflare/agent-skills-discovery-rfc>, v0.2.0, status **Draft**, not
  IETF/W3C-track). Mandates publishers "MUST provide an index at:
  `/.well-known/agent-skills/index.json`" — exact match to the code's probe path. Has real early
  third-party engagement (vercel-labs/skills, agentskills.io) but meaningfully less mature than an
  RFC-track standard.

### 8. `schema-type-breadth` — not an external-spec citation, out of audit scope

Confirmed (read `src/scan/sources/discoverSnapshot.ts` directly): computed from the count of
distinct schema.org JSON-LD `@type` values in polyfetch-scrape's `discover --json` output. No
external spec/RFC citation to verify — schema.org itself is the de facto reference, already
correctly used. No action.

## Gap analysis — candidate signals not yet in the crosswalk

Ranked by confidence/maturity, not by ease of implementation:

1. **`AGENTS.md` presence check (Discovery)** — strongest candidate. Root-level file of
   build/test/convention instructions for *coding* agents (distinct from `llms.txt`, which
   targets LLMs consuming site *content*). Originated Aug 2025 (OpenAI Codex, Amp, Google Jules,
   Cursor, Factory); now stewarded by the Agentic AI Foundation (Linux Foundation), 60,000+
   adopting projects. This repo itself ships one. Cheap to add: one more `probe()` +
   `evaluateTextPresence()` call in `wellKnown.ts`, identical pattern to the existing
   `agent-instruction` (`llms.txt`) check.
2. **IETF AIPREF `vocab`/`attach` drafts (Trust)** — a chartered IETF WG (not competing individual
   drafts, unlike `dns-aid`'s unsettled situation), Proposed-Standard track:
   `draft-ietf-aipref-vocab` (AI usage preference vocabulary — train/search/input categories) +
   `draft-ietf-aipref-attach` (attaches via HTTP header or robots.txt), milestone Aug 2026. **The
   `attach` draft is currently expired on Datatracker** — treat as a "watch," not an "add," until
   it re-files. More standards-track weight than Cloudflare's Content Signals policy (which
   `content-signal` likely already checks) — worth flagging as the direction that signal may be
   heading, not a signal to add today.
3. **`llms-full.txt` (Content)** — weakest candidate. Full-site-content-in-one-file companion to
   `llms.txt`, popularized by Mintlify and other docs platforms, with real adoption — but
   "the llmstxt.org spec never defines llms-full.txt": no formal spec body at all, purely a de
   facto convention. Apply this repo's own existing `dns-aid` bar (documented, `unknown`-only,
   never graded pass/fail against an unsettled format) if added at all — or skip for v1.

Adding any of these requires registering the signal id in the crosswalk's upstream source of
truth first (`src/scan/crosswalk.ts`'s own `assignCategory` error message: "Add it there first,
then here") — i.e. a PR in `agenthud-agui-a2ui/docs/agent-readiness.md` before any code here.

## Source map

| Signal | File : lines | Current probe/logic | Row |
|---|---|---|---|
| `ai-catalog` | `src/scan/sources/wellKnown.ts:175,194-200` | `probe(`${origin}/.well-known/ai-catalog.json`)` | 1 |
| `mcp-server-card` | `src/scan/sources/cloudflareMcp.ts:1-15,19,26-32` | module docstring + `MCP_SERVER_CARD_PATH` | 2 |
| `oauth-oidc-discovery` | `src/scan/sources/wellKnown.ts:225-230` | remediation string only | 3 |
| `web-bot-auth` | `src/scan/sources/contentSignal.ts:150-155` | remediation string only | 4 |
| `a2a-agent-card` (static) | `src/scan/sources/cloudflareMcp.ts:34-46,142-165` | `AGENT_CARD_KEYS` (requires `url` as string) | 5 |
| `a2a-agent-card` (live) | `src/scan/sources/mcpA2aProbe.ts:19-36,71-193` | `buildMessageSendRequest()` (method `message/send`), reads `cardBody.url` | 5 |
| upstream crosswalk doc | `agenthud-agui-a2ui/docs/agent-readiness.md` (different repo) — lines ~102,136,139,157-159 per this session's read | lists `ai-catalog.json`, `mcp/server-card.json` as still-open gaps | 6 |
| crosswalk signal-id registry | `src/scan/crosswalk.ts:21-51` (this repo) / upstream table (different repo) | `SIGNAL_TO_CATEGORY` — no changes needed for rows 1-5 (paths/wording only); rows 7's candidates would each need a new entry here, upstream-first | 7 |

## Remaining-work table (SINGLE source of open work)

| # | Item | Gate | Depends on | Done-when |
|---|------|------|------------|-----------|
| 1 | `ai-catalog`: probe `/.well-known/ard.json` as primary, fall back to legacy `/.well-known/ai-catalog.json` on 404; update remediation text to the current ARD v0.91 path. Signal id unchanged. | agent | — | `wellKnown.ts` tries `ard.json` first, falls back correctly; tests cover both the new-path-pass and fallback-pass cases; `npx vitest run` + `npx tsc --noEmit` clean |
| 2 | `mcp-server-card`: add a code comment (mirroring `cloudflareMcp.ts`'s existing docstring style) noting this check mirrors Cloudflare's `isitagentready.com` grading, not a shipped MCP spec; the real "MCP Server Card" concept is SEP-2127 (Draft, discovery mechanism unresolved as of 2026-09-18). Decide-by-default: **keep grading pass/fail as today** (mirrors an established external grader) rather than downgrading to `unknown`-only like `dns-aid` — record this decision in the comment so a future session doesn't silently flip it either way without noticing it was deliberate. | agent | — | Comment added; no probe-path/logic change; `npx tsc --noEmit` clean |
| 3 | `oauth-oidc-discovery`: reword remediation string to "per OpenID Connect Discovery 1.0 (a related-but-distinct mechanism from RFC 8414's own `/.well-known/oauth-authorization-server`)" or similar — wording only. | agent | — | Remediation string updated; existing tests still pass unmodified (no behavior change) |
| 4 | `web-bot-auth`: update citation from expired `draft-meunier-*` names to `draft-ietf-webbotauth-httpsig-protocol` (Active WG Document). Wording only — well-known path and `keys` format unchanged. | agent | — | Comment/remediation string updated; existing tests still pass unmodified |
| 5 | `a2a-agent-card`: fix schema-drift risk. **First** fetch the complete `AgentCard`/`AgentInterface`/`SendMessage` definitions from `specification/a2a.proto` (not yet done this session — only individual field facts were confirmed). Then update `cloudflareMcp.ts`'s `AGENT_CARD_KEYS` to not hard-require a flat `url` (accept `supported_interfaces[]` as the v1.0.0-correct shape, ideally accepting either shape so a v0.3.0-era card doesn't suddenly fail either), and update `mcpA2aProbe.ts`'s live probe to use the current method name and correct endpoint-selection logic (`supported_interfaces` is a list, not one string) — update citations from v0.3.0 to v1.0.0 throughout. Update tests for both files. | agent | full a2a.proto schema read (not yet done) | A conformant v1.0.0 AgentCard and a legacy v0.3.0-shaped one both grade correctly (no false-fail on either); live probe uses the current JSON-RPC method; `npx vitest run` + `npx tsc --noEmit` clean; spot-check against a real reachable A2A v1.0.0 server if one is publicly documented |
| 6 | Open a PR in `agenthud-agui-a2ui/docs/agent-readiness.md` (different repo) correcting its own `ai-catalog.json`→ARD and `mcp/server-card.json` references per Findings #1-#2 above, so the two repos' crosswalk sources don't drift back apart. | owner | — | Owner opens/reviews/merges that PR, or explicitly defers — either way this repo's rows 1-5 are not blocked on it |
| 7 | Decide whether to adopt any of the 3 gap-analysis candidates (`AGENTS.md` presence check, IETF AIPREF watch, `llms-full.txt`). If yes for any, register the signal id upstream first (crosswalk source of truth), then it becomes a small new row in a future arc. | owner | 6 (same upstream doc) | Owner picks yes/no/defer per candidate; recorded in this doc's "At arc close" note |

## Tests (strict RED-first; modules only)

- Rows 1 and 5 touch real module logic (new probe/fallback behavior, new shape-check behavior) —
  RED-first tests required, same bar this repo already applies to every `src/scan/sources/*.ts`
  module (see `AGENTS.md`).
- Rows 2-4 are comment/remediation-string-only changes with no behavior change — no new tests
  required; existing tests must still pass unmodified (a passing existing test that starts
  failing after a "wording-only" change would mean the change wasn't wording-only).

## Verification

- `npx vitest run` / `npx tsc --noEmit` green after each row.
- For row 1: rebuild and confirm the fallback order (try `ard.json`, only probe legacy
  `ai-catalog.json` if the first returns 404) against a test fixture — not against any of this
  repo's 3 real tracked properties, since none currently publish either file (this is graded
  `fail`, correctly, either way).
- For row 5: this is the one row where a wrong fix is worse than no fix (it changes live pass/fail
  grading for real properties) — do not ship without re-verifying the full proto schema at source
  first, per the row's own "Depends on" column.

## At arc close

Tick the remaining-work table against what merged, record the owner's row-6/row-7 decisions here,
and migrate any still-open rows to the next `NNNN` pair — in particular, row 5's full-schema
re-verification and implementation is substantial enough it may deserve its own dedicated
follow-on arc rather than being squeezed in alongside rows 1-4.
