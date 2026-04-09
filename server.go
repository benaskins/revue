package revue

import (
	"embed"
	"net/http"

	"github.com/benaskins/axon"
)

// Server is the revue HTTP server.
type Server struct {
	mux         *http.ServeMux
	staticFiles *embed.FS
}

// Option configures a Server.
type Option func(*Server)

// WithStaticFiles sets the embedded filesystem for the frontend.
func WithStaticFiles(fs *embed.FS) Option {
	return func(s *Server) {
		s.staticFiles = fs
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
