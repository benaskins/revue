package revue

import "strings"

const maxChunkLines = 30

// RawChunk is a deterministically-split piece of a unified diff.
type RawChunk struct {
	File  string `json:"file"`
	Diff  string `json:"diff"`
	Lines int    `json:"lines"`
}

// SplitDiff parses a unified diff and splits it into chunks by file and hunk.
// Hunks with more than maxChunkLines changed lines are sub-split.
func SplitDiff(diff string) []RawChunk {
	if diff == "" {
		return nil
	}

	var chunks []RawChunk
	lines := strings.Split(diff, "\n")

	var currentFile string
	var hunkLines []string
	var changedCount int

	flush := func() {
		if len(hunkLines) == 0 || currentFile == "" {
			return
		}
		diff := strings.Join(hunkLines, "\n")
		if changedCount <= maxChunkLines {
			chunks = append(chunks, RawChunk{
				File:  currentFile,
				Diff:  diff,
				Lines: changedCount,
			})
		} else {
			// Sub-split large hunks
			chunks = append(chunks, subSplit(currentFile, hunkLines)...)
		}
		hunkLines = nil
		changedCount = 0
	}

	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "diff --git"):
			flush()
			// Extract filename from "diff --git a/path b/path"
			parts := strings.SplitN(line, " b/", 2)
			if len(parts) == 2 {
				currentFile = parts[1]
			}

		case strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "+++ "):
			// Skip file header lines
			continue

		case strings.HasPrefix(line, "@@"):
			flush()
			hunkLines = append(hunkLines, line)

		case strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-"):
			hunkLines = append(hunkLines, line)
			changedCount++

		default:
			// Context line
			if len(hunkLines) > 0 {
				hunkLines = append(hunkLines, line)
			}
		}
	}
	flush()

	return chunks
}

func subSplit(file string, lines []string) []RawChunk {
	var chunks []RawChunk
	var batch []string
	changed := 0

	for _, line := range lines {
		isChanged := strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-")

		if isChanged && changed >= maxChunkLines {
			chunks = append(chunks, RawChunk{
				File:  file,
				Diff:  strings.Join(batch, "\n"),
				Lines: changed,
			})
			batch = nil
			changed = 0
		}

		batch = append(batch, line)
		if isChanged {
			changed++
		}
	}

	if len(batch) > 0 && changed > 0 {
		chunks = append(chunks, RawChunk{
			File:  file,
			Diff:  strings.Join(batch, "\n"),
			Lines: changed,
		})
	}

	return chunks
}
