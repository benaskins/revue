import { useCallback, useEffect, useRef, useState } from "react";
import FlashCard from "./FlashCard";
import TimerBar from "./TimerBar";
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

const BASE_MS = 3000;
const PER_LINE_MS = 80;

function chunkDuration(lines: number): number {
  return BASE_MS + lines * PER_LINE_MS;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [note, setNote] = useState("");
  const [flagged, setFlagged] = useState<FlaggedChunk[]>([]);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const advance = useCallback(() => {
    if (currentIndex >= chunks.length - 1) {
      setPhase("summary");
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, chunks.length]);

  // Spacebar to pause, Enter to resume (when paused)
  useEffect(() => {
    if (phase !== "review") return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && !paused) {
        e.preventDefault();
        setPaused(true);
        setTimeout(() => noteRef.current?.focus(), 50);
      } else if (e.code === "Enter" && paused && e.target === noteRef.current) {
        // Shift+Enter for newlines in the note
        if (e.shiftKey) return;
        e.preventDefault();

        // Flag if there's a note
        if (note.trim()) {
          setFlagged((prev) => [
            ...prev,
            { chunk: chunks[currentIndex], index: currentIndex, note: note.trim() },
          ]);
        }
        setNote("");
        setPaused(false);
        advance();
      } else if (e.code === "Escape" && paused) {
        // Escape to resume without flagging
        e.preventDefault();
        setNote("");
        setPaused(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, paused, note, chunks, currentIndex, advance]);

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
      setCurrentIndex(0);
      setPaused(false);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("input");
    }
  }

  // --- Input phase ---
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

  // --- Summary phase ---
  if (phase === "summary") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-2xl px-6">
          <h1 className="text-3xl font-bold mb-2 text-white">Review Complete</h1>
          <p className="text-neutral-400 mb-6">
            {flagged.length} of {chunks.length} chunks flagged
          </p>
          {/* Summary list built in step 7 */}
          <button
            onClick={() => {
              setPhase("input");
              setChunks([]);
              setFlagged([]);
            }}
            className="mt-4 px-4 py-2 text-sm text-neutral-400 border border-neutral-700 rounded hover:border-neutral-500 transition-colors"
          >
            New Review
          </button>
        </div>
      </div>
    );
  }

  // --- Review phase ---
  const currentChunk = chunks[currentIndex];
  if (!currentChunk) {
    setPhase("summary");
    return null;
  }

  const duration = chunkDuration(currentChunk.lines);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Timer bar at top */}
      <div className="px-6 pt-4">
        <TimerBar
          key={currentIndex}
          durationMs={duration}
          paused={paused}
          onComplete={advance}
        />
      </div>

      {/* Flash card centred */}
      <div className="flex-1 flex items-center justify-center">
        <FlashCard
          summary={currentChunk.summary}
          files={currentChunk.files}
          diff={currentChunk.diff}
          lines={currentChunk.lines}
          category={currentChunk.category}
          index={currentIndex}
          total={chunks.length}
        />
      </div>

      {/* Paused overlay with annotation */}
      {paused && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center pb-8 z-50">
          <div className="w-full max-w-2xl mx-6 bg-neutral-900 border border-neutral-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-yellow-400 font-medium">
                Paused — reviewing chunk {currentIndex + 1}
              </span>
              <span className="text-xs text-neutral-500">
                Enter to flag · Esc to skip
              </span>
            </div>
            <textarea
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What caught your eye? (Enter to flag, Esc to skip)"
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 resize-none"
              rows={3}
            />
          </div>
        </div>
      )}

      {/* Bottom hint */}
      {!paused && (
        <div className="text-center pb-4">
          <span className="text-xs text-neutral-600">
            spacebar to pause and examine
          </span>
        </div>
      )}
    </div>
  );
}
