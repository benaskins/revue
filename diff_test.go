package revue_test

import (
	"testing"

	"github.com/benaskins/revue"
)

const testDiff = `diff --git a/server.go b/server.go
--- a/server.go
+++ b/server.go
@@ -10,6 +10,8 @@ import (
 	"net/http"
+	"log/slog"
+	"encoding/json"
 )
@@ -20,3 +22,7 @@ func (s *Server) routes() {
 	s.mux.HandleFunc("GET /api/health", s.handleHealth)
+	s.mux.HandleFunc("POST /api/diff", s.handleDiff)
+	s.mux.HandleFunc("POST /api/chunks", s.handleChunks)
 }
diff --git a/chunker.go b/chunker.go
--- a/chunker.go
+++ b/chunker.go
@@ -1,4 +1,10 @@ package revue
+// Chunker breaks a diff into logical chunks.
+type Chunker struct {
+	client LLMClient
+	model  string
+}
+
 func NewChunker() {}`

func TestSplitDiffSplitsByFileAndHunk(t *testing.T) {
	chunks := revue.SplitDiff(testDiff)

	if len(chunks) != 3 {
		t.Fatalf("expected 3 chunks (2 hunks in server.go + 1 in chunker.go), got %d", len(chunks))
	}

	if chunks[0].File != "server.go" {
		t.Errorf("chunk 0: expected file server.go, got %s", chunks[0].File)
	}
	if chunks[1].File != "server.go" {
		t.Errorf("chunk 1: expected file server.go, got %s", chunks[1].File)
	}
	if chunks[2].File != "chunker.go" {
		t.Errorf("chunk 2: expected file chunker.go, got %s", chunks[2].File)
	}
}

func TestSplitDiffCountsLines(t *testing.T) {
	chunks := revue.SplitDiff(testDiff)

	if chunks[0].Lines != 2 {
		t.Errorf("chunk 0: expected 2 changed lines, got %d", chunks[0].Lines)
	}
	if chunks[1].Lines != 2 {
		t.Errorf("chunk 1: expected 2 changed lines, got %d", chunks[1].Lines)
	}
	if chunks[2].Lines != 6 {
		t.Errorf("chunk 2: expected 6 changed lines, got %d", chunks[2].Lines)
	}
}

func TestSplitDiffSubSplitsLargeHunks(t *testing.T) {
	// Build a diff with a single hunk of 40 changed lines
	diff := "diff --git a/big.go b/big.go\n--- a/big.go\n+++ b/big.go\n@@ -1,1 +1,41 @@\n"
	for i := 0; i < 40; i++ {
		diff += "+line\n"
	}

	chunks := revue.SplitDiff(diff)

	if len(chunks) != 2 {
		t.Fatalf("expected 2 sub-chunks for 40-line hunk (30 cap), got %d", len(chunks))
	}
	if chunks[0].Lines != 30 {
		t.Errorf("first sub-chunk: expected 30 lines, got %d", chunks[0].Lines)
	}
	if chunks[1].Lines != 10 {
		t.Errorf("second sub-chunk: expected 10 lines, got %d", chunks[1].Lines)
	}
}

func TestSplitDiffPreservesDiffContent(t *testing.T) {
	chunks := revue.SplitDiff(testDiff)

	// Each chunk's Diff should contain the hunk header and lines
	for i, c := range chunks {
		if c.Diff == "" {
			t.Errorf("chunk %d: diff is empty", i)
		}
		if c.File == "" {
			t.Errorf("chunk %d: file is empty", i)
		}
	}
}

func TestSplitDiffEmptyInput(t *testing.T) {
	chunks := revue.SplitDiff("")
	if len(chunks) != 0 {
		t.Errorf("expected 0 chunks for empty diff, got %d", len(chunks))
	}
}
