# Revue

Code Refinement Terminal by Axon, a division of Lamina Corporation.

PR flash-card review tool. Paste a GitHub PR URL, and the diff is split into timed flash cards. Press spacebar if the code scares you.

**https://revue.getlamina.ai**

## What's live

The live site is the static frontend only (`web/` directory). It runs entirely in your browser — no server, no account, no API key required.

Diffs are fetched directly from the GitHub API, split deterministically by hunk boundaries, scored by file type and change shape, and sequenced by significance. An optional OpenRouter API key upgrades the heuristic summaries to LLM-powered annotations.

## What's in this repo

The repo also contains a Go server that can run the chunking server-side using axon modules. This is not deployed on the live site.

```
web/                    React frontend (the live site)
static/                 Built frontend output
cmd/revue/main.go       Server entry point
server.go               HTTP server, routes, handlers
chunker.go              LLM-powered chunking (server path)
diff.go                 Deterministic diff parser
```

## License

MIT
