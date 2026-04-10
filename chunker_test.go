package revue_test

import (
	"context"
	"strings"
	"testing"

	"github.com/benaskins/axon-talk"
	"github.com/benaskins/revue"
)

type mockLLM struct {
	response    string
	lastRequest string
}

func (m *mockLLM) Chat(_ context.Context, req *talk.Request, fn func(talk.Response) error) error {
	if len(req.Messages) > 0 {
		m.lastRequest = req.Messages[0].Content
	}
	return fn(talk.Response{Content: m.response, Done: true})
}

func TestChunkerSplitsThenSequences(t *testing.T) {
	// LLM returns sequenced chunks with summaries
	llm := &mockLLM{response: `{
		"chunks": [
			{
				"summary": "Add new route handlers",
				"files": "server.go",
				"diff": "+handler code",
				"lines": 3,
				"category": "feature"
			},
			{
				"summary": "Add imports",
				"files": "server.go",
				"diff": "+import code",
				"lines": 2,
				"category": "chore"
			}
		]
	}`}

	diff := "diff --git a/server.go b/server.go\n--- a/server.go\n+++ b/server.go\n@@ -1,2 +1,4 @@\n+import1\n+import2\n@@ -10,2 +12,5 @@\n+handler1\n+handler2\n+handler3\n"

	chunker := revue.NewChunker(llm, "test-model")
	result, err := chunker.Chunk(context.Background(), diff)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Chunks) != 2 {
		t.Fatalf("expected 2 chunks, got %d", len(result.Chunks))
	}

	// Verify LLM received pre-split chunks, not raw diff
	if !strings.Contains(llm.lastRequest, `"file"`) {
		t.Error("expected LLM prompt to contain pre-split chunk data with file field")
	}
	if strings.Contains(llm.lastRequest, "diff --git") {
		t.Error("expected LLM prompt to NOT contain raw diff header — should receive structured chunks")
	}

	// Verify result has LLM-provided summaries
	if result.Chunks[0].Summary != "Add new route handlers" {
		t.Errorf("unexpected summary: %s", result.Chunks[0].Summary)
	}
	if result.Chunks[0].Category != "feature" {
		t.Errorf("unexpected category: %s", result.Chunks[0].Category)
	}
}

type mockToolCallLLM struct {
	args map[string]any
}

func (m *mockToolCallLLM) Chat(_ context.Context, _ *talk.Request, fn func(talk.Response) error) error {
	return fn(talk.Response{
		ToolCalls: []talk.ToolCall{{Name: "structured_response", Arguments: m.args}},
		Done:      true,
	})
}

func TestChunkerReturnsChunksFromToolCall(t *testing.T) {
	llm := &mockToolCallLLM{args: map[string]any{
		"chunks": []any{
			map[string]any{
				"summary":  "Refactor auth",
				"files":    "auth.go",
				"diff":     "-old\n+new",
				"lines":    float64(2),
				"category": "refactor",
			},
		},
	}}

	diff := "diff --git a/auth.go b/auth.go\n--- a/auth.go\n+++ b/auth.go\n@@ -1,1 +1,1 @@\n-old\n+new\n"

	chunker := revue.NewChunker(llm, "test-model")
	result, err := chunker.Chunk(context.Background(), diff)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(result.Chunks))
	}
	if result.Chunks[0].Summary != "Refactor auth" {
		t.Errorf("unexpected summary: %s", result.Chunks[0].Summary)
	}
}

func TestChunkerHandlesInvalidJSON(t *testing.T) {
	llm := &mockLLM{response: "not json"}
	chunker := revue.NewChunker(llm, "test-model")

	diff := "diff --git a/x.go b/x.go\n--- a/x.go\n+++ b/x.go\n@@ -1,1 +1,1 @@\n+line\n"
	_, err := chunker.Chunk(context.Background(), diff)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}
