// Heuristic chunking: zero-config sequencing, categorisation, and summaries.
// No LLM required — works entirely from diff structure.

interface RawChunk {
  file: string;
  diff: string;
  lines: number;
}

interface AnnotatedChunk {
  summary: string;
  files: string;
  diff: string;
  lines: number;
  category: string;
}

// --- Category ---

const CATEGORY_RULES: [RegExp, string][] = [
  [/_test\.go$|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|__tests__\//, "test"],
  [/\.md$|\.txt$|LICENSE|CHANGELOG/, "docs"],
  [/\.ya?ml$|\.toml$|\.json$|\.env|Dockerfile|justfile|Makefile|\.config\./, "config"],
  [/go\.mod$|go\.sum$|package\.json$|package-lock|yarn\.lock|pnpm-lock/, "config"],
];

function categoriseByFile(file: string): string | null {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(file)) return category;
  }
  return null;
}

function categoriseByDiff(diff: string): string {
  const lines = diff.split("\n");
  let adds = 0;
  let dels = 0;

  for (const line of lines) {
    if (line.startsWith("+")) adds++;
    else if (line.startsWith("-")) dels++;
  }

  // Pure deletions → refactor
  if (adds === 0 && dels > 0) return "refactor";
  // Mostly renames / replacements (balanced adds/dels)
  if (dels > 0 && adds > 0 && Math.abs(adds - dels) <= Math.max(adds, dels) * 0.3) return "refactor";
  // Pure additions with no deletions → feature
  if (adds > 0 && dels === 0) return "feature";
  // More adds than dels → feature
  if (adds > dels) return "feature";
  // More dels → fix (removing bad code)
  return "fix";
}

export function categorise(chunk: RawChunk): string {
  return categoriseByFile(chunk.file) || categoriseByDiff(chunk.diff);
}

// --- Summary ---

// Extract function/method name from @@ hunk header
// Format: @@ -start,count +start,count @@ optional context
const HUNK_CONTEXT_RE = /@@\s+[^@]+@@\s*(.+)/;

function extractContext(diff: string): string | null {
  const match = diff.match(HUNK_CONTEXT_RE);
  if (!match) return null;
  const ctx = match[1].trim();
  return ctx || null;
}

function describeChange(diff: string): string {
  const lines = diff.split("\n");
  let adds = 0;
  let dels = 0;

  for (const line of lines) {
    if (line.startsWith("+")) adds++;
    else if (line.startsWith("-")) dels++;
  }

  if (adds > 0 && dels === 0) return `${adds} lines added`;
  if (dels > 0 && adds === 0) return `${dels} lines removed`;
  return `${adds} added, ${dels} removed`;
}

export function summarise(chunk: RawChunk): string {
  const fileName = chunk.file.split("/").pop() || chunk.file;
  const context = extractContext(chunk.diff);
  const change = describeChange(chunk.diff);

  if (context) {
    return `${fileName}: ${context} — ${change}`;
  }
  return `${fileName} — ${change}`;
}

// --- Scoring (higher = more significant, shown first) ---

const FILE_PRIORITY: [RegExp, number][] = [
  [/\.go$/, 10],
  [/\.[tj]sx?$/, 9],
  [/\.svelte$/, 9],
  [/\.css$/, 5],
  [/\.sql$/, 8],
  [/\.ya?ml$|\.toml$|\.json$/, 3],
  [/\.md$/, 1],
  [/_test\.go$|\.test\.[tj]sx?$|\.spec\./, -2], // tests below their source
];

function filePriority(file: string): number {
  let score = 5; // default
  for (const [pattern, priority] of FILE_PRIORITY) {
    if (pattern.test(file)) {
      score = priority;
      // Don't break — later rules (like _test.go) can override
    }
  }
  return score;
}

function score(chunk: RawChunk): number {
  let s = 0;

  // File type importance
  s += filePriority(chunk.file) * 10;

  // More changes = more significant (diminishing returns)
  s += Math.min(chunk.lines, 30) * 2;

  // Bonus for additions (new code is usually more interesting)
  const adds = chunk.diff.split("\n").filter((l) => l.startsWith("+")).length;
  const ratio = chunk.lines > 0 ? adds / chunk.lines : 0;
  s += ratio * 10;

  return s;
}

// --- Main entry point ---

export function annotateChunks(raw: RawChunk[]): AnnotatedChunk[] {
  // Score and sort descending
  const scored = raw.map((chunk) => ({
    chunk,
    score: score(chunk),
  }));
  scored.sort((a, b) => b.score - a.score);

  return scored.map(({ chunk }) => ({
    summary: summarise(chunk),
    files: chunk.file,
    diff: chunk.diff,
    lines: chunk.lines,
    category: categorise(chunk),
  }));
}
