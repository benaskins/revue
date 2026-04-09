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

const CHUNK_PROMPT = `You are a code review assistant. Analyse the following unified diff from a GitHub pull request and group the changes into logical chunks.

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

Return a JSON object with a "chunks" array. Order chunks from most significant to least significant.`;

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
          content: `${CHUNK_PROMPT}\n\nHere is the diff:\n\n${diff}`,
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
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No response from model");
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
