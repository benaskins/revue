import { useState } from "react";
import FlashCard from "./FlashCard";
import "./index.css";

interface Chunk {
  summary: string;
  files: string;
  diff: string;
  lines: number;
  category: string;
}

type Phase = "input" | "loading" | "review" | "summary";

export interface FlaggedChunk {
  chunk: Chunk;
  index: number;
  note: string;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [error, setError] = useState("");
  const [_flagged, setFlagged] = useState<FlaggedChunk[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPhase("loading");

    try {
      const res = await fetch("/api/chunks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }

      const data = await res.json();
      setChunks(data.chunks);
      setFlagged([]);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("input");
    }
  }

  if (phase === "input" || phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-lg px-6">
          <h1 className="text-4xl font-bold mb-2 text-white tracking-tight">
            revue
          </h1>
          <p className="text-neutral-400 mb-8">
            Flash-card PR review. Paste a PR URL to begin.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              required
              className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
              disabled={phase === "loading"}
            />
            <button
              type="submit"
              disabled={phase === "loading"}
              className="px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {phase === "loading" ? "Analysing PR..." : "Start Review"}
            </button>
          </form>
          {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
        </div>
      </div>
    );
  }

  // Review phase: show current chunk as a flash card
  const currentChunk = chunks[0]; // Step 6 will add index tracking + timer
  if (!currentChunk) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-neutral-400">No chunks to review.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <FlashCard
        summary={currentChunk.summary}
        files={currentChunk.files}
        diff={currentChunk.diff}
        lines={currentChunk.lines}
        category={currentChunk.category}
        index={0}
        total={chunks.length}
      />
    </div>
  );
}
