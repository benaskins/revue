package revue_test

import (
	"context"
	"testing"

	"github.com/benaskins/axon-talk"
	"github.com/benaskins/revue"
)

type mockLLM struct {
	response string
}

func (m *mockLLM) Chat(_ context.Context, _ *talk.Request, fn func(talk.Response) error) error {
	return fn(talk.Response{Content: m.response, Done: true})
}

func TestChunkerReturnsChunks(t *testing.T) {
	llm := &mockLLM{response: `{
		"chunks": [
			{
				"summary": "Add user validation",
				"files": "user.go",
				"diff": "+func validate() {}",
				"lines": 1,
				"category": "feature"
			}
		]
	}`}

	chunker := revue.NewChunker(llm, "test-model")
	result, err := chunker.Chunk(context.Background(), "fake diff")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(result.Chunks))
	}

	chunk := result.Chunks[0]
	if chunk.Summary != "Add user validation" {
		t.Errorf("unexpected summary: %s", chunk.Summary)
	}
	if chunk.Lines != 1 {
		t.Errorf("expected 1 line, got %d", chunk.Lines)
	}
	if chunk.Category != "feature" {
		t.Errorf("unexpected category: %s", chunk.Category)
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

	chunker := revue.NewChunker(llm, "test-model")
	result, err := chunker.Chunk(context.Background(), "fake diff")
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

	_, err := chunker.Chunk(context.Background(), "fake diff")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}
