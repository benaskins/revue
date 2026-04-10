package revue

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/benaskins/axon-talk"
)

// Chunk is a logical group of changes within a PR diff.
type Chunk struct {
	Summary  string `json:"summary"`
	Files    string `json:"files"`
	Diff     string `json:"diff"`
	Lines    int    `json:"lines"`
	Category string `json:"category"`
}

// ChunkResult is the LLM's response containing all chunks.
type ChunkResult struct {
	Chunks []Chunk `json:"chunks"`
}

const sequencePrompt = `You are a code review assistant. You will receive a list of pre-split diff chunks from a GitHub pull request. Each chunk has a file path, diff content, and line count.

Your job is to:
1. Sequence the chunks from most significant to least significant
2. Add a summary and category to each chunk

For each chunk, return:
- "summary": a 1-2 sentence description of what this chunk does
- "files": the file path (preserve from input)
- "diff": the exact diff content (preserve from input)
- "lines": the line count (preserve from input)
- "category": one of "feature", "fix", "refactor", "test", "config", "docs", "chore"

Return a JSON object with a "chunks" array containing all chunks in your recommended review order.

Here are the chunks:

%s`

var chunkSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"chunks": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"summary":  map[string]any{"type": "string"},
					"files":    map[string]any{"type": "string"},
					"diff":     map[string]any{"type": "string"},
					"lines":    map[string]any{"type": "integer"},
					"category": map[string]any{"type": "string"},
				},
				"required": []any{"summary", "files", "diff", "lines", "category"},
			},
		},
	},
	"required": []any{"chunks"},
}

// Chunker breaks a diff into logical chunks using an LLM.
type Chunker struct {
	client talk.LLMClient
	model  string
}

// NewChunker creates a Chunker with the given LLM client and model.
func NewChunker(client talk.LLMClient, model string) *Chunker {
	return &Chunker{client: client, model: model}
}

// Chunk splits a unified diff deterministically, then asks the LLM
// to sequence and annotate the chunks.
func (c *Chunker) Chunk(ctx context.Context, diff string) (*ChunkResult, error) {
	rawChunks := SplitDiff(diff)

	chunksJSON, err := json.Marshal(rawChunks)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal chunks: %w", err)
	}

	req := talk.NewRequest(c.model, []talk.Message{
		{Role: talk.RoleUser, Content: fmt.Sprintf(sequencePrompt, string(chunksJSON))},
	}, talk.WithStructuredOutput(chunkSchema))

	var buf strings.Builder
	var toolArgs map[string]any
	err = c.client.Chat(ctx, req, func(resp talk.Response) error {
		buf.WriteString(resp.Content)
		for _, tc := range resp.ToolCalls {
			if tc.Name == "structured_response" {
				toolArgs = tc.Arguments
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("LLM sequencing failed: %w", err)
	}

	var raw []byte
	if toolArgs != nil {
		raw, _ = json.Marshal(toolArgs)
	} else {
		raw = []byte(buf.String())
	}

	var result ChunkResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("failed to parse chunk response: %w", err)
	}
	return &result, nil
}
