# revue

PR flash-card review tool. LLM-powered chunking of GitHub PR diffs, presented as auto-advancing flash cards.

## Build & Test

```bash
go test ./...
go vet ./...
go build -o bin/revue ./cmd/revue
```

## Structure

```
cmd/revue/main.go       entry point
server.go               HTTP server, routes, handlers
embed.go                go:embed for static frontend
static/                 built frontend output (embedded)
web/                    React frontend source (phase I, step 4)
```

## Key dependencies

- axon (HTTP chassis, SPA handler, graceful shutdown)
- axon-loop + axon-talk (LLM chunking, phase I step 3)

Local module resolution is handled by go.work at the lamina workspace root.
