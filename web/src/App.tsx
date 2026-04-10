import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Chunk,
  type FlaggedChunk,
  MODELS,
  DEFAULT_MODEL,
  parsePRURL,
  fetchDiff,
  chunkDiff,
  chunkDiffLocal,
  splitDiff,
} from "./api";
import FlashCard from "./FlashCard";
import TimerBar from "./TimerBar";
import { useTimer } from "./useTimer";
import "./index.css";

type Phase = "input" | "loading" | "ready" | "review" | "summary";

interface Speed {
  label: string;
  baseMs: number;
  perLineMs: number;
}

const SPEEDS: Record<string, Speed> = {
  slow:    { label: "Slow (1m)",     baseMs: 60_000, perLineMs: 1000 },
  normal:  { label: "Normal (30s)",  baseMs: 30_000, perLineMs: 500 },
  fast:    { label: "Fast (15s)",    baseMs: 15_000, perLineMs: 250 },
  rsvp:    { label: "RSVP (5s)",     baseMs: 5_000,  perLineMs: 100 },
};

const DEFAULT_SPEED = "normal";

function chunkDuration(lines: number, speed: Speed): number {
  return speed.baseMs + lines * speed.perLineMs;
}

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable
  }
}

const REASSURANCES = [
  "Please be patient",
  "Don't be afraid",
  "Not all code is scary",
  "Trust your feelings",
  "You are doing important work",
  "The code wants to be understood",
  "The author appreciates this",
  "Stay calm and refine",
];

function useRotatingMessage(messages: string[], intervalMs: number): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [messages, intervalMs]);
  return messages[index];
}

const FALLBACK_FRAGMENTS = [
  "// loading...",
  "// preparing review...",
  "// parsing diff...",
  "// analysing changes...",
];

// Deterministic shuffle using a seed — avoids Math.random in render
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Tag ~20% of chunks as "scary" using a deterministic hash
function isScary(index: number, total: number): boolean {
  const hash = ((index + 1) * 2654435761) >>> 0;
  return hash % 5 === 0 && total > 3;
}

function RefinementAnimation({ fragments }: { fragments: string[] }) {
  const message = useRotatingMessage(REASSURANCES, 2500);
  const items = fragments.length > 0 ? fragments : FALLBACK_FRAGMENTS;
  const [order, setOrder] = useState(() => items.map((_, i) => i));
  const [visible, setVisible] = useState(false);

  // Fade in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setOrder(items.map((_, i) => i));
  }, [items.length]);

  // Rotate which chunks are "scary" every shuffle
  const [scaryOffset, setScaryOffset] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setOrder((prev) => {
        const seed = Date.now();
        return seededShuffle(prev, seed);
      });
      setScaryOffset((prev) => prev + 1);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const cols = items.length <= 4 ? 2 : items.length <= 9 ? 3 : 4;

  return (
    <div
      className="flex flex-col items-center gap-8"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 1.2s ease-in",
      }}
    >
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          width: "min(95vw, 900px)",
        }}
      >
        {order.map((fragIndex, gridPos) => {
          const scary = isScary(fragIndex + scaryOffset, items.length);
          return (
            <div
              key={fragIndex}
              className="p-3 overflow-hidden"
              style={{
                height: "8rem",
                order: gridPos,
                transition: "all 2.5s cubic-bezier(0.4, 0, 0.2, 1)",
                opacity: 0.7 + (fragIndex % 3) * 0.1,
                background: scary
                  ? "linear-gradient(135deg, var(--revue-panel), rgba(224, 108, 96, 0.06))"
                  : "var(--revue-panel)",
                border: scary
                  ? "1px solid rgba(224, 108, 96, 0.25)"
                  : "1px solid var(--revue-border)",
                boxShadow: scary
                  ? "0 0 12px rgba(224, 108, 96, 0.06)"
                  : "none",
              }}
            >
              <pre
                className="text-[11px] leading-[1.5] whitespace-pre-wrap"
                style={{
                  color: scary ? "var(--revue-red)" : "var(--revue-text)",
                  transition: "color 2s ease",
                }}
              >
                {items[fragIndex]}
              </pre>
            </div>
          );
        })}
      </div>

      <div className="text-center">
        <p
          className="text-[var(--revue-white)] text-sm tracking-[0.2em] uppercase mb-3"
          style={{ animation: "glow-pulse 3s ease-in-out infinite" }}
        >
          Refining Code
        </p>
        <p
          key={message}
          className="text-[var(--revue-text-dim)] text-xs tracking-wider h-4"
          style={{ animation: "bin-reveal 0.4s ease-out" }}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [rawFragments, setRawFragments] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [note, setNote] = useState("");
  const [flagged, setFlagged] = useState<FlaggedChunk[]>([]);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [apiKey, setApiKey] = useState(() => loadSetting("revue:apiKey", ""));
  const [model, setModel] = useState(() =>
    loadSetting("revue:model", DEFAULT_MODEL),
  );
  const [speedKey, setSpeedKey] = useState(() =>
    loadSetting("revue:speed", DEFAULT_SPEED),
  );
  const speed = SPEEDS[speedKey] || SPEEDS[DEFAULT_SPEED];
  const [githubToken, setGithubToken] = useState(() =>
    loadSetting("revue:githubToken", ""),
  );
  const [showSettings, setShowSettings] = useState(false);

  const advance = useCallback(() => {
    if (currentIndex >= chunks.length - 1) {
      setPhase("summary");
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, chunks.length]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Escape always dismisses the note dialog, even from textarea
      if (e.code === "Escape" && paused && phase === "review") {
        e.preventDefault();
        setNote("");
        setPaused(false);
        return;
      }

      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (
          e.code === "Enter" &&
          paused &&
          e.target === noteRef.current &&
          !e.shiftKey
        ) {
          e.preventDefault();
          if (note.trim()) {
            setFlagged((prev) => [
              ...prev,
              {
                chunk: chunks[currentIndex],
                index: currentIndex,
                note: note.trim(),
              },
            ]);
          }
          setNote("");
          setPaused(false);
          advance();
        }
        return;
      }

      if (phase === "ready" && e.code === "Space") {
        e.preventDefault();
        setPhase("review");
        return;
      }

      if (phase !== "review") return;

      if (e.code === "Space" && !paused) {
        // Flag — open note dialog
        e.preventDefault();
        setPaused(true);
        setTimeout(() => noteRef.current?.focus(), 50);
      } else if (e.code === "ArrowRight" && !paused) {
        // Skip — advance to next chunk
        e.preventDefault();
        advance();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, paused, note, chunks, currentIndex, advance]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    try {
      const ref = parsePRURL(url);
      const diff = await fetchDiff(ref, githubToken || undefined);

      // Split deterministically and show real code in the animation
      const raw = splitDiff(diff);
      setRawFragments(raw.map((c) => c.diff));
      setPhase("loading");

      // Use LLM if API key is configured, otherwise heuristic
      const result = apiKey.trim()
        ? await chunkDiff(diff, apiKey, model)
        : chunkDiffLocal(diff);

      // Let the refinement animation breathe
      await new Promise((r) => setTimeout(r, 3000));

      setChunks(result.chunks);
      setFlagged([]);
      setCurrentIndex(0);
      setPaused(false);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("input");
    }
  }

  function handleSaveSettings() {
    saveSetting("revue:apiKey", apiKey);
    saveSetting("revue:model", model);
    saveSetting("revue:githubToken", githubToken);
    saveSetting("revue:speed", speedKey);
    setShowSettings(false);
  }

  // --- Settings terminal ---
  const settingsPanel = showSettings && (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="w-full max-w-md mx-6 bg-[var(--revue-panel)] border border-[var(--revue-border)] p-6">
        <div className="flex items-center gap-3 mb-6 pb-3 border-b border-[var(--revue-border)]">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: "var(--revue-cyan)",
              boxShadow: "0 0 6px var(--revue-cyan-glow)",
            }}
          />
          <h2 className="text-xs tracking-[0.3em] text-[var(--revue-cyan)] uppercase">
            Terminal Configuration
          </h2>
        </div>

        <label className="block text-xs text-[var(--revue-text-dim)] mb-1 tracking-wider uppercase">
          Review Speed
        </label>
        <select
          value={speedKey}
          onChange={(e) => setSpeedKey(e.target.value)}
          className="w-full px-3 py-2 mb-4 bg-[var(--revue-bg)] border border-[var(--revue-border)] text-[var(--revue-white)] text-sm focus:outline-none focus:border-[var(--revue-cyan)]"
        >
          {Object.entries(SPEEDS).map(([key, s]) => (
            <option key={key} value={key}>
              {s.label}
            </option>
          ))}
        </select>

        <p className="text-xs text-[var(--revue-text-dim)] mb-5 leading-relaxed opacity-70">
          This terminal optionally uses{" "}
          <a
            href="https://openrouter.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--revue-cyan)] hover:underline"
          >
            OpenRouter
          </a>{" "}
          to access LLM providers. You'll need an OpenRouter API key — create
          one at{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--revue-cyan)] hover:underline"
          >
            openrouter.ai/keys
          </a>
          .
        </p>

        <label className="block text-xs text-[var(--revue-text-dim)] mb-1 tracking-wider uppercase">
          OpenRouter API Key{" "}
          <span className="normal-case tracking-normal opacity-50">
            (optional)
          </span>
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-or-..."
          className="w-full px-3 py-2 mb-4 bg-[var(--revue-bg)] border border-[var(--revue-border)] text-[var(--revue-white)] text-sm focus:outline-none focus:border-[var(--revue-cyan)]"
        />

        <label className="block text-xs text-[var(--revue-text-dim)] mb-1 tracking-wider uppercase">
          Refinement Engine
        </label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full px-3 py-2 mb-4 bg-[var(--revue-bg)] border border-[var(--revue-border)] text-[var(--revue-white)] text-sm focus:outline-none focus:border-[var(--revue-cyan)]"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <label className="block text-xs text-[var(--revue-text-dim)] mb-1 tracking-wider uppercase">
          Repository Credential{" "}
          <span className="normal-case tracking-normal opacity-50">
            (optional)
          </span>
        </label>
        <input
          type="password"
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          placeholder="ghp_..."
          className="w-full px-3 py-2 mb-6 bg-[var(--revue-bg)] border border-[var(--revue-border)] text-[var(--revue-white)] text-sm focus:outline-none focus:border-[var(--revue-cyan)]"
        />

        <p className="text-xs text-[var(--revue-text-dim)] mb-6 leading-relaxed opacity-60">
          All credentials remain in local storage. No data leaves this
          terminal except to OpenRouter and GitHub.{" "}
          <a
            href="https://github.com/benaskins/revue"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--revue-text)] underline hover:text-[var(--revue-cyan)]"
          >
            Inspect source
          </a>
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setShowSettings(false)}
            className="px-4 py-2 text-xs tracking-wider text-[var(--revue-text-dim)] border border-[var(--revue-border)] hover:border-[var(--revue-text-dim)] transition-colors uppercase"
          >
            Dismiss
          </button>
          <button
            onClick={handleSaveSettings}
            className="px-4 py-2 text-xs tracking-wider text-[var(--revue-bg)] bg-[var(--revue-cyan)] hover:brightness-110 transition-all uppercase"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );

  const settingsButton = (
    <button
      onClick={() => setShowSettings(true)}
      className="fixed top-4 right-4 p-2 text-[var(--revue-text-dim)] hover:text-[var(--revue-cyan)] transition-colors z-40"
      title="Terminal Configuration"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        <rect x="1" y="1" width="14" height="14" rx="1" />
        <line x1="1" y1="5" x2="15" y2="5" />
        <circle cx="4" cy="3" r="0.5" fill="currentColor" />
        <circle cx="6.5" cy="3" r="0.5" fill="currentColor" />
      </svg>
    </button>
  );

  // --- Input phase ---
  if (phase === "input") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {settingsButton}
        {settingsPanel}
        <div className="w-full max-w-lg px-6 text-center">
          <div className="mb-8">
            <h1
              className="text-3xl font-light tracking-[0.4em] text-[var(--revue-white)] uppercase mb-3"
              style={{ animation: "glow-pulse 4s ease-in-out infinite" }}
            >
              Revue
            </h1>
            <div className="w-16 h-px bg-[var(--revue-border)] mx-auto mb-3" />
            <p className="text-xs tracking-[0.2em] text-[var(--revue-text-dim)] uppercase">
              Code Refinement Terminal by{" "}
              <span className="relative inline-block group">
                <span className="text-[var(--revue-text)] cursor-default">
                  Axon
                </span>
                <span
                  className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{
                    background: "var(--revue-panel)",
                    border: "1px solid var(--revue-border)",
                    color: "var(--revue-text-dim)",
                    fontSize: "9px",
                    letterSpacing: "0.15em",
                    boxShadow: "0 0 8px rgba(79, 209, 197, 0.08)",
                  }}
                >
                  a division of lamina corporation
                </span>
              </span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter pull request location"
              required
              className="w-full px-4 py-3 bg-[var(--revue-panel)] border border-[var(--revue-border)] text-[var(--revue-white)] text-sm text-center tracking-wide placeholder:text-[var(--revue-text-dim)] placeholder:opacity-50 focus:outline-none focus:border-[var(--revue-cyan)] transition-colors"
            />
            <button
              type="submit"
              className="px-6 py-3 text-xs tracking-[0.3em] uppercase text-[var(--revue-bg)] bg-[var(--revue-cyan)] hover:brightness-110 transition-all"
              style={{
                boxShadow: "0 0 15px rgba(79, 209, 197, 0.15)",
              }}
            >
              Begin Refinement
            </button>
          </form>

          <p className="mt-6 text-[var(--revue-text-dim)] text-xs tracking-wider">
            {apiKey
              ? `Engine: ${MODELS.find((m) => m.id === model)?.name || model}`
              : "Heuristic mode — configure an API key for AI-powered summaries"}
          </p>
          {error && (
            <p className="mt-4 text-[var(--revue-red)] text-xs tracking-wider">
              {error}
            </p>
          )}

          <div className="mt-16 text-[10px] text-[var(--revue-text-dim)] opacity-70 tracking-wider leading-relaxed">
            <p>
              This terminal operates entirely within your browser.{" "}
              <a
                href="https://github.com/benaskins/revue"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--revue-text)]"
              >
                Inspect source
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- Loading phase ---
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefinementAnimation fragments={rawFragments} />
      </div>
    );
  }

  // --- Ready phase ---
  if (phase === "ready") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--revue-text-dim)] text-xs tracking-[0.3em] uppercase mb-6">
            Refinement Complete
          </p>
          <div
            className="text-7xl font-light text-[var(--revue-cyan)] mb-4"
            style={{
              animation: "glow-pulse 3s ease-in-out infinite",
              textShadow:
                "0 0 20px var(--revue-cyan-glow), 0 0 40px rgba(79, 209, 197, 0.1)",
            }}
          >
            {chunks.length}
          </div>
          <p className="text-[var(--revue-text)] text-sm tracking-wider mb-2">
            bins ready for review
          </p>
          <p className="text-[var(--revue-text-dim)] text-xs tracking-wider mb-10">
            estimated duration:{" "}
            {Math.ceil((chunks.length * speed.baseMs) / 60_000)} min
          </p>
          <div className="animate-pulse">
            <p className="text-[var(--revue-cyan)] text-xs tracking-[0.2em] uppercase">
              Press spacebar to begin session
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- Summary phase ---
  if (phase === "summary") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-2xl px-6">
          <div className="text-center mb-8">
            <p className="text-[var(--revue-text-dim)] text-xs tracking-[0.3em] uppercase mb-3">
              Session Complete
            </p>
            <div className="flex items-center justify-center gap-6">
              <div>
                <div className="text-3xl text-[var(--revue-cyan)]">
                  {flagged.length}
                </div>
                <div className="text-[10px] text-[var(--revue-text-dim)] tracking-wider uppercase">
                  Flagged
                </div>
              </div>
              <div className="w-px h-8 bg-[var(--revue-border)]" />
              <div>
                <div className="text-3xl text-[var(--revue-text)]">
                  {chunks.length}
                </div>
                <div className="text-[10px] text-[var(--revue-text-dim)] tracking-wider uppercase">
                  Total
                </div>
              </div>
            </div>
          </div>

          {flagged.length === 0 ? (
            <p className="text-[var(--revue-text-dim)] text-center text-sm">
              No anomalies detected. All bins refined.
            </p>
          ) : (
            <div className="space-y-3 text-left">
              {flagged.map((f, i) => (
                <div
                  key={i}
                  className="bg-[var(--revue-panel)] border border-[var(--revue-border)] p-4"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] text-[var(--revue-text-dim)] tracking-[0.2em] uppercase">
                      Bin {String(f.index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] text-[var(--revue-yellow)] tracking-wider uppercase">
                      {f.chunk.category}
                    </span>
                  </div>
                  <p className="text-[var(--revue-white)] text-sm mb-1">
                    {f.chunk.summary}
                  </p>
                  <p className="text-[var(--revue-text-dim)] text-xs mb-2">
                    {f.chunk.files}
                  </p>
                  <div
                    className="border-l-2 border-[var(--revue-yellow)] pl-3 mt-2"
                    style={{
                      background:
                        "linear-gradient(90deg, rgba(212, 170, 92, 0.05), transparent)",
                    }}
                  >
                    <p className="text-[var(--revue-yellow)] text-sm whitespace-pre-wrap">
                      {f.note}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 mt-8 justify-center">
            {flagged.length > 0 && (
              <button
                onClick={() => {
                  const text = flagged
                    .map(
                      (f) =>
                        `## Bin ${String(f.index + 1).padStart(2, "0")}: ${f.chunk.summary}\n**Files:** ${f.chunk.files}\n**Category:** ${f.chunk.category}\n\n> ${f.note}\n`,
                    )
                    .join("\n---\n\n");
                  navigator.clipboard.writeText(text);
                }}
                className="px-4 py-2 text-xs tracking-wider text-[var(--revue-cyan)] border border-[var(--revue-border)] hover:border-[var(--revue-cyan)] transition-colors uppercase"
              >
                Export Report
              </button>
            )}
            <button
              onClick={() => {
                setPhase("input");
                setChunks([]);
                setFlagged([]);
              }}
              className="px-4 py-2 text-xs tracking-wider text-[var(--revue-text-dim)] border border-[var(--revue-border)] hover:border-[var(--revue-text-dim)] transition-colors uppercase"
            >
              New Session
            </button>
          </div>
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

  const duration = chunkDuration(currentChunk.lines, speed);

  return (
    <ReviewPhase
      chunk={currentChunk}
      index={currentIndex}
      total={chunks.length}
      duration={duration}
      paused={paused}
      note={note}
      noteRef={noteRef}
      flaggedCount={flagged.length}
      onNoteChange={setNote}
      onComplete={advance}
    />
  );
}

// --- Review phase as separate component (needs its own timer state) ---

const PROMPTS_CALM = [
  "Press spacebar if the code scares you",
  "Observe the changes carefully",
  "Trust your instincts",
];

const PROMPTS_URGENT = [
  "Time is running out",
  "Decide now",
  "Do you see it?",
  "Look closer",
];

const PROMPTS_CRITICAL = [
  "This bin is about to close",
  "Speak now",
  "Last chance",
];

function ReviewPhase({
  chunk,
  index,
  total,
  duration,
  paused,
  note,
  noteRef,
  flaggedCount,
  onNoteChange,
  onComplete,
}: {
  chunk: Chunk;
  index: number;
  total: number;
  duration: number;
  paused: boolean;
  note: string;
  noteRef: React.RefObject<HTMLTextAreaElement | null>;
  flaggedCount: number;
  onNoteChange: (v: string) => void;
  onComplete: () => void;
}) {
  const { progress } = useTimer(duration, paused);

  const urgent = progress > 0.7;
  const critical = progress > 0.9;

  const prompts = critical
    ? PROMPTS_CRITICAL
    : urgent
      ? PROMPTS_URGENT
      : PROMPTS_CALM;

  const promptMessage = useRotatingMessage(
    prompts,
    critical ? 1200 : urgent ? 1800 : 3000,
  );

  const borderColor = critical
    ? "var(--revue-red)"
    : urgent
      ? "var(--revue-yellow)"
      : "var(--revue-border)";

  // Vignette intensifies with urgency
  const vignetteOpacity = critical ? 0.5 : urgent ? 0.25 : 0;

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Urgency vignette */}
      {vignetteOpacity > 0 && (
        <div
          className="fixed inset-0 pointer-events-none z-30"
          style={{
            background: `radial-gradient(ellipse at center, transparent 50%, rgba(224, 108, 96, ${vignetteOpacity}) 100%)`,
            transition: "background 2s ease",
          }}
        />
      )}

      <div className="px-6 pt-6">
        <TimerBar
          key={index}
          durationMs={duration}
          paused={paused}
          onComplete={onComplete}
        />
      </div>

      <div
        className="flex-1 flex items-center justify-center transition-all duration-1000"
        style={{
          filter: critical
            ? "brightness(1.05)"
            : urgent
              ? "brightness(1.02)"
              : "none",
        }}
      >
        <div
          style={{
            borderLeft: `1px solid ${borderColor}`,
            borderRight: `1px solid ${borderColor}`,
            transition: "border-color 1s ease",
            padding: "0 2px",
          }}
        >
          <FlashCard
            summary={chunk.summary}
            files={chunk.files}
            diff={chunk.diff}
            lines={chunk.lines}
            category={chunk.category}
            index={index}
            total={total}
          />
        </div>
      </div>

      {/* Paused — anomaly detected */}
      {paused && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center pb-8 z-50">
          <div className="w-full max-w-2xl mx-6 bg-[var(--revue-panel)] border border-[var(--revue-yellow)] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{
                    background: "var(--revue-yellow)",
                    boxShadow: "0 0 8px rgba(212, 170, 92, 0.4)",
                  }}
                />
                <span className="text-xs tracking-[0.2em] text-[var(--revue-yellow)] uppercase">
                  Anomaly — Bin {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <span className="text-[10px] text-[var(--revue-text-dim)] tracking-wider">
                ENTER to flag · ESC to dismiss
              </span>
            </div>
            <textarea
              ref={noteRef}
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Tell us why this code scares you..."
              className="w-full bg-[var(--revue-bg)] border border-[var(--revue-border)] px-3 py-2 text-[var(--revue-white)] text-sm focus:outline-none focus:border-[var(--revue-yellow)] resize-none"
              rows={3}
            />
          </div>
        </div>
      )}

      {/* Bottom status — escalates with urgency */}
      <div className="text-center pb-4 flex items-center justify-center gap-6">
        {!paused && (
          <>
            <span
              key={promptMessage}
              className="text-[10px] tracking-[0.2em] uppercase"
              style={{
                color: critical
                  ? "var(--revue-red)"
                  : urgent
                    ? "var(--revue-yellow)"
                    : "var(--revue-text-dim)",
                animation: `bin-reveal 0.3s ease-out${critical ? ", glow-pulse 0.8s ease-in-out infinite" : ""}`,
              }}
            >
              {promptMessage}
            </span>
            <span className="text-[10px] text-[var(--revue-text-dim)] tracking-wider opacity-40">
              → skip
            </span>
          </>
        )}
        {flaggedCount > 0 && (
          <span className="text-[10px] text-[var(--revue-yellow)] tracking-wider opacity-60">
            {flaggedCount} flagged
          </span>
        )}
      </div>
    </div>
  );
}
