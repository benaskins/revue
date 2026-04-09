package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/benaskins/axon"
	"github.com/benaskins/revue"
)

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8090"
	}

	srv := revue.NewServer(
		revue.WithStaticFiles(&revue.StaticFiles),
	)

	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Handler())
	mux.Handle("/", srv.SPAHandler())

	slog.Info("starting revue", "addr", addr)
	axon.ListenAndServe(addr, mux)
}
