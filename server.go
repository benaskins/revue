package revue

import (
	"embed"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/benaskins/axon"
)

// Server is the revue HTTP server.
type Server struct {
	mux         *http.ServeMux
	staticFiles *embed.FS
	github      *GitHubClient
}

// Option configures a Server.
type Option func(*Server)

// WithStaticFiles sets the embedded filesystem for the frontend.
func WithStaticFiles(fs *embed.FS) Option {
	return func(s *Server) {
		s.staticFiles = fs
	}
}

// WithGitHubToken sets the GitHub API token for fetching PR diffs.
func WithGitHubToken(token string) Option {
	return func(s *Server) {
		s.github = NewGitHubClient(token)
	}
}

// NewServer creates a new revue server.
func NewServer(opts ...Option) *Server {
	s := &Server{
		mux: http.NewServeMux(),
	}
	for _, opt := range opts {
		opt(s)
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("POST /api/diff", s.handleDiff)
}

// Handler returns the API handler.
func (s *Server) Handler() http.Handler {
	return s.mux
}

// SPAHandler returns the frontend handler.
func (s *Server) SPAHandler() http.Handler {
	if s.staticFiles == nil {
		return http.NotFoundHandler()
	}
	return axon.SPAHandler(*s.staticFiles, "static", axon.WithStaticPrefix("/assets/"))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

type diffRequest struct {
	URL string `json:"url"`
}

type diffResponse struct {
	Ref  PRRef  `json:"ref"`
	Diff string `json:"diff"`
}

func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	if s.github == nil {
		http.Error(w, "GitHub token not configured", http.StatusServiceUnavailable)
		return
	}

	var req diffRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	ref, err := ParsePRURL(req.URL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	diff, err := s.github.FetchDiff(r.Context(), ref)
	if err != nil {
		slog.Error("failed to fetch diff", "error", err, "ref", ref)
		http.Error(w, "failed to fetch diff", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(diffResponse{Ref: ref, Diff: diff})
}
