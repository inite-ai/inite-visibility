# Contributing to inite-visibility

Thanks for helping. The short version:

- **Have an idea, not code?** Open an issue with the
  [Product idea](https://github.com/inite-ai/inite-visibility/issues/new?template=product-idea.yml)
  template. Plain words are fine.
- **Found a bug?** Open a
  [Bug report](https://github.com/inite-ai/inite-visibility/issues/new?template=bug_report.yml)
  with the site URL and what the tool said. Never paste a token.
- **Want to change code?** [AGENTS.md](AGENTS.md) is the source of truth — for
  people and AI agents alike: ground rules, zones, the exact commands CI runs
  (`npm ci`, `npm run build`, `npm test`), the architecture map, and the
  idea → PR loop. With Claude Code, open the repo and run `/contribute`; with
  any other agent, say "read AGENTS.md and help me with …".

The score and the full audit live in the inite.ai service, not here; ideas
about them are still welcome as issues. Changes to the URL guard, the bridge,
sign-in or the package identity (red zones in AGENTS.md) start as an issue
that a maintainer approves before code.

Security problems: please don't open a public issue — ask a maintainer for a
private channel.
