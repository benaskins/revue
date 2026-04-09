@AGENTS.md

## Conventions
- Server construction uses options pattern: `NewServer(opts...)`
- React + shadcn/ui + Tailwind frontend in `web/`, built output embedded via `//go:embed all:static`
- API routes under `/api/`, SPA fallback on `/`

## Constraints
- Experimental app — move fast, keep it simple
- Frontend is IN this repo (`web/` dir)
- Do not add database dependencies — this is stateless for now

## Testing
- `go test ./...` — backend tests
- Frontend: `cd web && npm install && npm run build` (builds to `static/`)
