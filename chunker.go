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

const chunkPrompt = `You are a code review assistant. Analyse the following unified diff from a GitHub pull request and group the changes into logical chunks.

Each chunk should represent a coherent unit of change — for example:
- A new feature with its tests
- A mechanical rename across files
- A configuration change
- A bug fix with its guard clause

IMPORTANT: Each chunk's diff MUST be 25 lines or fewer. If a logical change is larger than 25 lines, split it into smaller sub-chunks that each make sense on their own (e.g. split a feature from its tests, or split changes by file).

For each chunk, provide:
- "summary": a 1-2 sentence description of what this chunk does
- "files": comma-separated list of files touched by this chunk
- "diff": the exact unified diff lines belonging to this chunk (preserve the diff format)
- "lines": count of diff lines (additions + deletions) in this chunk
- "category": one of "feature", "fix", "refactor", "test", "config", "docs", "chore"

Return a JSON object with a "chunks" array. Order chunks from most significant to least significant.

Here is the diff:

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

// Chunk analyses a unified diff and returns logical chunks.
func (c *Chunker) Chunk(ctx context.Context, diff string) (*ChunkResult, error) {
	req := talk.NewRequest(c.model, []talk.Message{
		{Role: talk.RoleUser, Content: fmt.Sprintf(chunkPrompt, diff)},
	}, talk.WithStructuredOutput(chunkSchema))

	var buf strings.Builder
	var toolArgs map[string]any
	err := c.client.Chat(ctx, req, func(resp talk.Response) error {
		buf.WriteString(resp.Content)
		// Anthropic returns structured output as a tool call
		for _, tc := range resp.ToolCalls {
			if tc.Name == "structured_response" {
				toolArgs = tc.Arguments
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("LLM chunking failed: %w", err)
	}

	// Prefer tool call arguments (Anthropic), fall back to text content (OpenAI)
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
