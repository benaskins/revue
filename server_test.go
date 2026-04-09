package revue_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/benaskins/revue"
)

func TestHealthEndpoint(t *testing.T) {
	srv := revue.NewServer()

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	body := rec.Body.String()
	if body != `{"status":"ok"}` {
		t.Fatalf("unexpected body: %s", body)
	}
}
