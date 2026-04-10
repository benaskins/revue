export interface Chunk {
  summary: string;
  files: string;
  diff: string;
  lines: number;
  category: string;
}

export interface ChunkResult {
  chunks: Chunk[];
}

export interface FlaggedChunk {
  chunk: Chunk;
  index: number;
  note: string;
}

export interface PRRef {
  owner: string;
  repo: string;
  number: string;
}

const PR_URL_RE = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export function parsePRURL(url: string): PRRef {
  const m = url.match(PR_URL_RE);
  if (!m) throw new Error("Invalid PR URL");
  return { owner: m[1], repo: m[2], number: m[3] };
}

export async function fetchDiff(
  ref: PRRef,
  githubToken?: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3.diff",
  };
  if (githubToken) {
    headers["Authorization"] = `Bearer ${githubToken}`;
  }

  let res = await fetch(url, { headers });

  // Retry without auth on 401 (token may be expired, repo may be public)
  if (res.status === 401 && githubToken) {
    res = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3.diff" },
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API returned ${res.status}: ${text}`);
  }

  return res.text();
}

const MAX_CHUNK_LINES = 30;

interface RawChunk {
  file: string;
  diff: string;
  lines: number;
}

export function splitDiff(diff: string): RawChunk[] {
  if (!diff) return [];

  const lines = diff.split("\n");
  const chunks: RawChunk[] = [];

  let currentFile = "";
  let hunkLines: string[] = [];
  let changedCount = 0;

  function flush() {
    if (hunkLines.length === 0 || !currentFile) return;
    const diffText = hunkLines.join("\n");
    if (changedCount <= MAX_CHUNK_LINES) {
      chunks.push({ file: currentFile, diff: diffText, lines: changedCount });
    } else {
      chunks.push(...subSplit(currentFile, hunkLines));
    }
    hunkLines = [];
    changedCount = 0;
  }

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flush();
      const parts = line.split(" b/");
      if (parts.length >= 2) currentFile = parts[1];
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    } else if (line.startsWith("@@")) {
      flush();
      hunkLines.push(line);
    } else if (line.startsWith("+") || line.startsWith("-")) {
      hunkLines.push(line);
      changedCount++;
    } else if (hunkLines.length > 0) {
      hunkLines.push(line);
    }
  }
  flush();

  return chunks;
}

function subSplit(file: string, lines: string[]): RawChunk[] {
  const chunks: RawChunk[] = [];
  let batch: string[] = [];
  let changed = 0;

  for (const line of lines) {
    const isChanged = line.startsWith("+") || line.startsWith("-");

    if (isChanged && changed >= MAX_CHUNK_LINES) {
      chunks.push({ file, diff: batch.join("\n"), lines: changed });
      batch = [];
      changed = 0;
    }

    batch.push(line);
    if (isChanged) changed++;
  }

  if (batch.length > 0 && changed > 0) {
    chunks.push({ file, diff: batch.join("\n"), lines: changed });
  }

  return chunks;
}

const SEQUENCE_PROMPT = `You are a code review assistant. You will receive a list of pre-split diff chunks from a GitHub pull request. Each chunk has a file path, diff content, and line count.

Your job is to:
1. Sequence the chunks from most significant to least significant
2. Add a summary and category to each chunk

For each chunk, return:
- "summary": a 1-2 sentence description of what this chunk does
- "files": the file path (preserve from input)
- "diff": the exact diff content (preserve from input)
- "lines": the line count (preserve from input)
- "category": one of "feature", "fix", "refactor", "test", "config", "docs", "chore"

Return a JSON object with a "chunks" array containing all chunks in your recommended review order.`;

const CHUNK_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "chunk_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        chunks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              summary: { type: "string" },
              files: { type: "string" },
              diff: { type: "string" },
              lines: { type: "integer" },
              category: { type: "string" },
            },
            required: ["summary", "files", "diff", "lines", "category"],
            additionalProperties: false,
          },
        },
      },
      required: ["chunks"],
      additionalProperties: false,
    },
  },
};

export async function chunkDiff(
  diff: string,
  apiKey: string,
  model: string,
): Promise<ChunkResult> {
  const rawChunks = splitDiff(diff);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "revue",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: `${SEQUENCE_PROMPT}\n\nHere are the chunks:\n\n${JSON.stringify(rawChunks)}`,
        },
      ],
      response_format: CHUNK_SCHEMA,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter returned ${res.status}: ${text}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No response from model");
  }

  // Strip markdown code fences if present
  content = content.trim();
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  return JSON.parse(content) as ChunkResult;
}

export interface ModelOption {
  id: string;
  name: string;
}

export const MODELS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "anthropic/claude-haiku-4", name: "Claude Haiku 4" },
  { id: "openai/gpt-4.1", name: "GPT-4.1" },
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
  { id: "google/gemini-2.5-flash-preview", name: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-pro-preview", name: "Gemini 2.5 Pro" },
];

export const DEFAULT_MODEL = MODELS[0].id;
