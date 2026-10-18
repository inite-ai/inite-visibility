# AGENTS.md — inite-visibility

Instructions for AI coding agents (Claude Code, Cursor, Codex, Copilot coding
agent, Gemini CLI, Windsurf…) working **on** this repository. Humans: the
[README](README.md) says what the package does; [CONTRIBUTING.md](CONTRIBUTING.md)
says how to propose a change.

## What this is

`@inite/visibility` — a stdio MCP server (`inite-visibility`, TypeScript) with
two halves:

- **Local tools** — `check_ai_access`, `check_identity_files`,
  `check_page_signals`: fetch a public site's `robots.txt`, identity files and
  homepage on the user's machine and report **facts**. No account, no call to
  inite.ai.
- **Remote bridge** — everything else is `https://inite.ai/api/mcp`'s own tool
  list (portal, AI-visibility analyzer `analyze_site`/`get_analysis`, Atlas),
  forwarded as-is, as a guest when signed out or with the user's token.

For whom: site owners, marketers and their agents asking "can the answer
engines see this site?". Tokens come from INITE Auth
(`https://auth-api.inite.ai`, the INITE Triad's identity service; contract:
<https://github.com/inite-ai/inite-triad/blob/main/docs/compatibility.md>).
The remote server and its scoring are a separate, private deployment.

## Ground rules (non-negotiable)

1. **Tool names and input schemas are a public contract.** MCP clients, saved
   prompts and the MCP Registry entry (`server.json`, `ai.inite/inite-visibility`)
   depend on `check_ai_access`, `check_identity_files`, `check_page_signals`
   and their `{ url }` input. Never rename or remove a tool or a required
   input; add optional inputs only. A replacement ships alongside the old name
   (old one still works, its description says "deprecated: use …") and the
   removal is a maintainer's decision. A tool's *output* is prose for a model:
   it may gain lines, but don't drop or reword a fact people may rely on
   without saying so in the PR.
2. **Remote tools are not defined here.** `listTools`/`callTool` in
   `src/index.ts` forward to inite.ai without copying, filtering or rewriting
   schemas or results. A change to a remote tool happens in the service.
3. **Local tools report facts, never a score.** The weights that turn checks
   into a number stay on the server (README "What this package is"). Same
   input + same site content → same output; no randomness, no model calls,
   no telemetry, no call home.
4. **Only the public web.** Every local fetch goes through `publicUrl()` in
   `src/checks.ts`, which refuses localhost, private ranges and non-http(s).
   Never weaken it or add a fetch that bypasses it.
5. **Never log or send secrets or user data.** Tokens go only as a bearer
   header to `INITE_MCP_URL` and to the auth server during login; never into
   output, errors or issues. The token file stays `0600`. `INITE_TOKEN` beats
   the file (tested). Nothing user-specific is sent anywhere by a local tool.
6. **stdout is the protocol.** Human-facing lines go to stderr
   (`process.stderr.write`), as `src/bin.ts` explains. No `console.log`.
7. **Exactly one `bin`.** `npx @inite/visibility` resolves only because there
   is one binary (`inite-visibility`); `test/package.test.js` pins it. Keep the
   package `name`, `bin` and `mcpName` (= `server.json` `name`) unchanged.
8. **Versions move together.** `package.json` `version`, `VERSION` in
   `src/index.ts` (handshake + user-agent) and `server.json`
   `packages[0].version` are equal (`1.2.0` today; the test checks the
   server.json one). `server.json` top-level `version` is the registry entry's
   own and moves on its own (it went to `2.0.0` when the remote lane changed).
   Don't bump by hand: release-please moves the first three (see Releasing);
   never run `npm publish` or the registry publisher yourself.
9. **Don't hand-edit `dist/`** (git-ignored build output of `tsc`) and don't
   add runtime dependencies without asking (there is one:
   `@modelcontextprotocol/sdk`).

## Zones

| Path | What lives there | Zone |
|---|---|---|
| `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/` templates | docs | green |
| `test/*.test.js` (adding tests) | tests | green |
| `src/checks.ts` — `parseRobots`, `isAllowed`, `checkAiAccess`, `checkIdentityFiles`, `checkPageSignals`, `RETRIEVAL_BOTS`, `TRAINING_BOTS`, `IDENTITY_FILES` | local check logic and lists | yellow — tests required |
| `src/index.ts` `LOCAL_TOOLS` descriptions, a **new** local tool | what models read; new surface | yellow |
| `src/bin.ts` | `login` / `whoami` / `--help` / `--version` | yellow |
| `src/checks.ts` `publicUrl`, `get` | SSRF guard and the only fetch | red |
| `src/index.ts` `remoteCall`, `listTools`, `callTool`, existing tool names/schemas | bridge, guest/401 semantics, public contract | red |
| `src/auth.ts` | OAuth (PKCE loopback), token storage | red |
| `package.json` (`name`, `bin`, `mcpName`, `files`, deps), `server.json` | npm + MCP Registry identity | red |

Green: just do it. Yellow: needs tests + a note in the PR. Red: open an issue
with a spec first (template "Product idea"); a maintainer approves the design
before code.

## Setup

- **Codespaces / devcontainer:** "Code → Codespaces → Create" (or "Reopen in
  Container"). `.devcontainer/devcontainer.json` is a plain Node 20 image;
  `npm ci` runs on create (and builds, via `prepare`). No services needed.
- **Local:** Node `>=20` (`engines`), then `npm ci`.

## Commands

Exactly what CI runs ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
npm ci            # installs from package-lock.json; `prepare` runs the build
npm run build     # tsc → dist/ (this is also the typecheck: strict mode)
npm test          # node --test test/*.test.js — imports from dist/, so build first
```

Done = all three green. Single test file: `npm run build && node --test test/checks.test.js`.
Try it by hand: `node dist/bin.js --help`, `node dist/bin.js whoami`
(stderr). `node dist/bin.js` with no argument is the stdio server — a client
launches it. There is no lint or format script.

## Architecture map

```
src/bin.ts      CLI entry (package bin → dist/bin.js): login | whoami | --help | --version | (none) → main()
src/index.ts    the MCP server: LOCAL_TOOLS (name, description, inputSchema),
                runLocal() dispatch, remoteCall() JSON-RPC to INITE_MCP_URL,
                listTools() = local + remote, callTool() = local or forward, main()
src/checks.ts   the local work: publicUrl() guard, get(), robots parser,
                checkAiAccess / checkIdentityFiles / checkPageSignals → text report
src/auth.ts     accessToken() (INITE_TOKEN > file), login() (DCR + PKCE loopback), refresh
test/           node:test against dist/: checks (parser, guard), remote (bridge),
                auth (precedence, perms), package (one bin, README, server.json)
```

Request flow: client → stdio → `CallToolRequestSchema` handler → `callTool()`
→ a local name runs `runLocal()` → `publicUrl()` → `check*()` → text; any
other name → `remoteCall("tools/call")` with the token if there is one → the
remote result unchanged. A thrown error becomes an `isError` result, never a
crash.

**Add a local tool:**

1. Write the check as an exported `async function checkX(site: URL): Promise<string>`
   in `src/checks.ts`, fetching only through `get()` on URLs built from the
   `site` that `publicUrl()` returned. Keep parsing in pure, exported helpers
   so they can be tested without the network.
2. Add `{ name, description, inputSchema }` to `LOCAL_TOOLS` in
   `src/index.ts`. Reuse `urlArg` for a `{ url }` input; a new input is a
   JSON Schema object with `required` listing only what is truly required.
   End the description with "Runs locally, no account needed."
3. Add the branch to `runLocal()`.
4. Tests in `test/checks.test.js` for the pure helpers (see "a specific group
   beats the wildcard") and, if the tool can refuse input, for that.
5. Add a row to the README "Tools" table. If `server.json` `_meta` counts
   tools (`"tools": 5`), ask a maintainer whether to update it.

## From idea to PR

The loop you run **with** the human (Claude Code: `/contribute` runs it):

1. Restate the idea in plain words; ask at most 3 clarifying questions.
2. Find where it fits (Zones). Check for an existing issue:
   `gh issue list -R inite-ai/inite-visibility --search "<words>" --state all`.
   If it is about the score, the audit or a remote tool, it belongs to the
   inite.ai service — file an idea issue and say so.
3. Write a short spec: problem, user-visible behaviour (tool output), tool
   surface change (new tool / new optional input), what is fetched from the
   site, risks, out of scope. **Red zone → stop**, open an issue with the spec
   (template "Product idea"), and wait for a maintainer.
4. Plan small steps.
5. Implement with tests (tests first where practical — the robots tests are
   the model).
6. Run all of "Commands".
7. Update the README where behaviour or tools changed.
8. Commit: conventional commits (`feat(checks): …`, `fix(auth): …`, `docs: …`,
   `!` for breaking). Older history uses plain sentences; new commits use the
   conventional form. The commit type decides the next version (see
   Releasing).
9. Open a PR with the template filled, explaining the change to a
   non-engineer too.

## Conventions

- TypeScript, `strict`, ESM (`"module": "NodeNext"` — import local files with
  a `.js` suffix). Source in `src/`: double quotes, semicolons, trailing
  commas. Tests in `test/`: plain `.js`, single quotes, no semicolons. No
  formatter is configured — match the file you are in.
- Every module and non-trivial function has a block comment that says **why**
  (the failure it prevents); keep that density.
- A tool failure is a result (`fail(message)` → `isError: true`) with a
  sentence the model can act on, not a thrown error.
- Constants for public lists (`RETRIEVAL_BOTS`, `IDENTITY_FILES`) are `as const`
  arrays; prefer data over branching.
- Branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`. One behaviour per PR.

## Testing

`node:test` + `node:assert/strict`, files `test/<area>.test.js`, importing
from `../dist/*.js` — so `npm run build` before `node --test`. Tests never hit
the network: bridge tests inject a fake `fetch` (`remoteCall(..., fetchImpl)`
in `test/remote.test.js`); auth tests point `INITE_TOKEN_FILE` at a temp dir
(`test/auth.test.js`). Good model for a new check: the robots tests in
`test/checks.test.js` — feed text to the pure parser, assert the verdict.
CI runs `npm ci`, `npm run build`, `npm test`.

## Releasing

release-please (`.github/workflows/release-please.yml`) reads the
conventional commits on `main` and keeps a release PR open (`fix` → patch,
`feat` → minor, `!` → major). Merging that PR bumps `package.json`,
`VERSION` and `server.json` `packages[0].version`, writes `CHANGELOG.md`,
tags `vX.Y.Z` and, in the same run, publishes to npm with provenance
(`publish-npm.yml`) and then the MCP Registry (`publish-mcp-registry.yml`).
The registry entry is only republished when `server.json`'s top-level
`version` is new — bump it in the release PR when the listing should change.
Both publishes skip a version that is already out, so dispatching
release-please by hand publishes whatever `main` carries. Secrets:
`NPM_TOKEN`, `MCP_REGISTRY_PRIVATE_KEY`.

## When to ask a human

- anything in a red zone (SSRF guard, bridge, auth, package/registry identity);
- renaming/removing a tool, an input, a command or an env var;
- a check that would need a score, a weight, a model call or a paid API;
- adding a runtime dependency; a version bump or a release;
- the change needs the inite.ai service to change;
- you would need a real token or account to verify it.

## Help

Issues: <https://github.com/inite-ai/inite-visibility/issues> (templates:
product idea, bug). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).
Security: do **not** open a public issue — report privately via
[SECURITY.md](SECURITY.md) (GitHub private vulnerability reporting, or
security@inite.ai). Claude Code: `/contribute` runs
the loop above; `/spec-idea` only files an idea.
