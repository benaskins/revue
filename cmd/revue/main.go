package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/benaskins/axon"
	"github.com/benaskins/axon-talk/anthropic"
	"github.com/benaskins/revue"
)

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8090"
	}

	model := os.Getenv("REVUE_MODEL")
	if model == "" {
		model = "claude-sonnet-4-20250514"
	}

	llm := anthropic.NewClient(
		"https://api.anthropic.com",
		os.Getenv("ANTHROPIC_API_KEY"),
	)

	srv := revue.NewServer(
		revue.WithStaticFiles(&revue.StaticFiles),
		revue.WithGitHubToken(os.Getenv("GITHUB_TOKEN")),
		revue.WithLLM(llm, model),
	)

	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Handler())
	mux.Handle("/", srv.SPAHandler())

	slog.Info("starting revue", "addr", addr)
	axon.ListenAndServe(addr, mux)
}
