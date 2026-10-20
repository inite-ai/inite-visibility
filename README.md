# INITE MCP — AI visibility, from inside your agent

Ask your assistant whether the answer engines can see a website, and get a
number back.

```
> Can ChatGPT actually find stripe.com, or is it invisible?

  analyze_site(url: "stripe.com")   → run_id: cm4x…
  get_analysis(run_id: "cm4x…")     → Score: 78/100
```

The audit reads a live site the way an assistant does — the identity files an
engine looks for (`llms.txt`, `ai.json` and the rest), the crawler policy, the
schema graph, page health — and then asks Claude, ChatGPT, Gemini and
Perplexity whether they name it. One score out of 100 across eight weighted
sections.

It is the same audit that runs at [inite.ai/en/analyze](https://inite.ai/en/analyze).

## Works before you sign in

Three of the tools run entirely on your machine — a `robots.txt` fetched, a
file probed for, a page parsed. No account, no allowance, no call home.

```
> Is anything blocking AI crawlers on stripe.com?

  check_ai_access(url: "stripe.com")

  Retrieval: all 7 answer-engine crawlers may fetch the site.
  Training:  3 of 8 blocked — Meta-ExternalAgent, Bytespider, Amazonbot.
```

The rest is inite.ai's AI visibility server, and it answers signed out too, as
a guest: `check_identity`, the fix plan (`visibility_fixes`), a competitor read
the same way (`compare_sites`), how the reading moved (`visibility_history`),
and `analyze_site` as the survey - the audit without its two paid steps, two a
day per address.

```
> What should firecrawl.dev fix first so ChatGPT can use it?

  visibility_fixes(url: "firecrawl.dev")

  1. [critical] No structured data on the site (about +3.5 points)
     Do: Add Organization (and WebSite) JSON-LD to every page.
  2. [high] 7 retrieval crawlers are blocked on …
```

Visibility and nothing else. INITE's services and booking are
[`ai.inite/inite`](https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.inite/inite),
the catalogue of AI tools is [`ai.inite/atlas`](https://inite.ai/en/atlas).

Signing in makes the calls your account's: its tier of the audit (the teaser on
a free plan, the whole audit on a paid one) and your audits: `my_reports`, and
the fix plan and history built from them.

## Install

**Claude Desktop, Cursor, or any client that launches a stdio server:**

```json
{
  "mcpServers": {
    "inite": {
      "command": "npx",
      "args": ["-y", "@inite/visibility"]
    }
  }
}
```

Then sign in once:

```sh
npx @inite/visibility login
```

That opens a browser, you approve, and the token is stored at
`~/.config/inite/mcp.json` with owner-only permissions. Authorization code with
PKCE over a loopback redirect, the flow RFC 8252 prescribes for a native app.
Nothing is written to the repository and no secret ships in the package.

**Already have a token** (CI, a shared config, a container):

```json
{
  "mcpServers": {
    "inite": {
      "command": "npx",
      "args": ["-y", "@inite/visibility"],
      "env": { "INITE_TOKEN": "…" }
    }
  }
}
```

`INITE_TOKEN` wins over the stored file.

**Client speaks remote MCP?** Skip this package. Point it straight at
`https://inite.ai/api/mcp/analyzer`: every open tool answers without a token,
and a member tool answers `401` with `WWW-Authenticate` naming
[the protected-resource metadata](https://inite.ai/.well-known/oauth-protected-resource/api/mcp/analyzer),
which names the authorization server.

## Tools

**Local — no account:**

| tool | what it does |
|---|---|
| `check_ai_access(url)` | Which AI crawlers `robots.txt` lets in, separating the ones that fetch a page to answer a live question from the ones that only collect training data. Blocking the first kind is what makes a site invisible; blocking the second costs nothing. |
| `check_identity_files(url)` | Which of the ten identity files exist — `llms.txt`, `ai.json`, `identity.json` and the rest. |
| `check_page_signals(url)` | Title, description, canonical, hreflang, and the Schema.org types in the page's JSON-LD. |

**Remote — open without an account, more with one:**

| tool | what it does |
|---|---|
| `check_identity(url)` | Free and instant: which answer-engine crawlers get in, the identity files, structured data, an identity score out of 100 and what that reading says to fix. No model asked. |
| `visibility_fixes(url)` | The fix plan, most important first: what to change, why, how many points it should recover, the pages it applies to, and a paste-ready file when there is one. Signed in, built from your latest audit of the site. |
| `compare_sites(url, other)` | Your site and a competitor's, read the same way, side by side, and who is ahead on each count. |
| `visibility_history(url)` | How the reading moved: the INITE Atlas's weekly readings for a site it carries, and your own audits. |
| `analyze_site(url)` | Starts the audit that also asks the answer engines whether they name the site, and returns a `run_id`. A survey without an account, the teaser on a free plan, the whole audit on a paid one. |
| `get_analysis(run_id)` | Progress while it runs; the score out of 100 and what to fix first once it finishes. |
| `my_reports()` | Signed in: your audits, newest first. |

Two tools rather than one for the audit, because it is asynchronous. A single
tool that blocked for a minute would be torn down by most clients' timeouts.

## Commands

```
inite-visibility            run as an MCP server over stdio (what a client does)
inite-visibility login      sign in through the browser
inite-visibility whoami     say whether a usable token is present
```

## What this package is

Two halves.

The local checks are real work done here: fetching, parsing, and the robots
rules applied properly — most-specific group wins, longest matching rule wins,
`Allow` breaks a tie. They cost nobody anything because your machine does them.

The remote half defines no schemas of its own. It asks `inite.ai` what it
offers and forwards calls there, so that tool list is whatever the service
implements today. A local copy would be a second source of truth, and the first
thing it would do is drift.

What stays on the server is what costs something or is ours: four answer
engines asked whether they name a site, and the weights that turn everything
into one number. The local tools report facts; `analyze_site` reports a score.

## Account and allowance

Without an account every open tool answers, under a per-address allowance: the
identity check, the fix plan, the comparison and the history, and the audit as
a survey, two a day. An account makes the audit its plan's own, exactly as on
the website: the teaser on a free plan, the full pipeline - four answer engines
asked - on a paid one. [Plans are here](https://inite.ai/en/pricing).

## Environment

| variable | meaning |
|---|---|
| `INITE_TOKEN` | Use this token instead of the stored one. |
| `INITE_MCP_URL` | Point at a different endpoint. Default `https://inite.ai/api/mcp/analyzer`. |
| `INITE_TOKEN_FILE` | Where the token lives. Default `~/.config/inite/mcp.json`. |
| `INITE_AUTH_URL` | Authorization server. Default `https://auth-api.inite.ai`. |

## Namespace

Published to the MCP registry as `ai.inite/inite-visibility`, a namespace held
by proving control of `inite.ai` — the public half of the key is served at
[/.well-known/mcp-registry-auth](https://inite.ai/.well-known/mcp-registry-auth).

Named by the domain rather than the code host on purpose: a service whose whole
job is being legible to machines should tell them who it belongs to in its own
name.

## A note on the command name

`npx @inite/visibility` resolves because there is exactly one binary in the
package. npm looks for a command matching the package name with the scope
stripped — `visibility` — does not find it, and runs the only one there is.

The binary is called `inite-visibility` rather than `visibility` on purpose: a
scoped package has no business claiming a word that general in your `PATH` on
a global install. The cost is that a second binary would break the line above
for every client, so a test pins it at one.

If you are invoking it from a directory that contains this package's own
`package.json`, npm prefers the local copy and finds no linked command. Name it
explicitly there:

```sh
npx -p @inite/visibility inite-visibility login
```

## Development

```sh
npm install
npm run build
npm test
```

The tests cover what the bridge can get wrong without saying so: dropping the
credential, turning "signed out" into "broken", swallowing an error into a
success, and letting a stale file beat the environment.

## Contribute with an AI agent

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/inite-ai/inite-visibility)

You don't need to be an engineer. Open the repo in your coding agent and say
`/contribute` (Claude Code) — or "read AGENTS.md and help me add …" in any
other agent. [AGENTS.md](AGENTS.md) holds the rules, the commands CI runs and
the idea → PR loop; [CONTRIBUTING.md](CONTRIBUTING.md) is the short version.
Only want to suggest something? `/spec-idea`, or the
[Product idea](https://github.com/inite-ai/inite-visibility/issues/new?template=product-idea.yml)
form.

## Licence

MIT. The service it talks to is [INITE](https://inite.ai).
