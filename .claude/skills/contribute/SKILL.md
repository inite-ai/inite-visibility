---
name: contribute
description: Use when someone says "I have an idea", "I want to add / change / fix something" in inite-visibility (the INITE AI-visibility MCP server — local robots/identity/page checks plus the inite.ai bridge) — runs idea → spec → plan → change → tests → gates → PR, stopping at red zones and explaining each step in plain words.
---

# /contribute — inite-visibility

The person may not be an engineer. Say what you are doing, and why, in plain
words at every step. `AGENTS.md` is the source of truth; re-read the section a
step names when unsure.

## 1. Understand

Restate the idea in two or three plain sentences. Ask at most 3 clarifying
questions — only ones whose answer changes what gets built.

## 2. Does it belong here?

This repo holds the **three local checks** and a **bridge**. The score, the
full audit (`analyze_site`, `get_analysis`), the portal and the Atlas tools
live in the inite.ai service, not here. If the idea is about those, say so,
offer `/spec-idea` to file it, and stop. Local checks report facts, never a
score (AGENTS.md rule 3) — an idea that needs weights or a model call belongs
to the service too.

Search first:
`gh issue list -R inite-ai/inite-visibility --search "<key words>" --state all`.

## 3. Zone and spec

Find the zone in AGENTS.md "Zones"; tell the person which and what it means.
Spec: problem · what the tool will report · tool surface change (new tool or
new **optional** input only) · what gets fetched from the site · risks · out
of scope.

- **Red** (`publicUrl`/`get` in `src/checks.ts`, the bridge in
  `src/index.ts`, `src/auth.ts`, renaming/removing a tool or input,
  `package.json` identity, `server.json`): **stop.** Show the spec, get a yes,
  file it with the "Product idea" template (`/spec-idea` does this), and
  explain that a maintainer approves the design before code.

## 4. Plan, then build — tests first

Branch from `main`: `git switch -c feat/<slug>`. Follow AGENTS.md
"Architecture map → Add a local tool" step by step. Write the test in
`test/checks.test.js` first (pure helper, no network), watch it fail, then
implement. Update the README "Tools" table when tools change.

## 5. Gates

Run, and show the person the result:

```bash
npm ci
npm run build
npm test
```

All green, or explain what failed and fix it. Never skip or delete a test to
get green.

## 6. Commit and PR

Conventional commits (`feat(checks): …`, `fix: …`, `docs: …`). No version
bump unless a maintainer asked for a release (AGENTS.md rule 8). Then:

```bash
git push -u origin HEAD
gh pr create --fill   # then edit the body to follow .github/PULL_REQUEST_TEMPLATE.md
```

Fill every section: plain-language summary, zone, gates, tests, AI-assisted
disclosure. Share the link and what happens next: CI runs, a maintainer
reviews.
