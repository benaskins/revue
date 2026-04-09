import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Chunk,
  type FlaggedChunk,
  MODELS,
  DEFAULT_MODEL,
  parsePRURL,
  fetchDiff,
  chunkDiff,
} from "./api";
import FlashCard from "./FlashCard";
import TimerBar from "./TimerBar";
import "./index.css";

type Phase = "input" | "loading" | "ready" | "review" | "summary";

const BASE_MS = 60_000;
const PER_LINE_MS = 1000;

function chunkDuration(lines: number): number {
  return BASE_MS + lines * PER_LINE_MS;
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
  "The data wants to be sorted",
  "Your outie appreciates this",
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

// Lumon-style data refinement animation
function RefinementAnimation() {
  const message = useRotatingMessage(REASSURANCES, 2500);
  const symbols = ["+", "-", "@@", "fn", "{}", "->", "+", "-", "//", "++"];
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="relative w-72 h-72">
        {/* Outer boundary */}
        <div
          className="absolute inset-0 border border-[var(--lumon-border)] rounded-full animate-[spin_12s_linear_infinite]"
          style={{ boxShadow: "0 0 20px rgba(79, 209, 197, 0.05)" }}
        />
        <div className="absolute inset-6 border border-[var(--lumon-border)] rounded-full animate-[spin_8s_linear_infinite_reverse]" />
        <div className="absolute inset-12 border border-[var(--lumon-cyan-dim)] rounded-full animate-[spin_6s_linear_infinite]" />

        {/* Centre core */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-4 h-4 rounded-full"
            style={{
              background: "var(--lumon-cyan)",
              boxShadow:
                "0 0 12px var(--lumon-cyan-glow), 0 0 30px rgba(79, 209, 197, 0.1)",
              animation: "glow-pulse 2s ease-in-out infinite",
            }}
          />
        </div>

        {/* Drifting data symbols */}
        {symbols.map((sym, i) => (
          <div
            key={i}
            className="absolute text-xs"
            style={{
              color: "var(--lumon-text-dim)",
              top: `${15 + Math.sin(i * 0.9) * 35}%`,
              left: `${10 + ((i * 13) % 80)}%`,
              animation: `data-drift ${3 + (i % 3)}s ease-in-out infinite`,
              animationDelay: `${i * 0.4}s`,
            }}
          >
            {sym}
          </div>
        ))}
      </div>

      <div className="text-center">
        <p
          className="text-[var(--lumon-white)] text-sm tracking-[0.2em] uppercase mb-3"
          style={{ animation: "glow-pulse 3s ease-in-out infinite" }}
        >
          Refining Data
        </p>
        <p
          key={message}
          className="text-[var(--lumon-text-dim)] text-xs tracking-wider h-4"
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
        e.preventDefault();
        setPaused(true);
        setTimeout(() => noteRef.current?.focus(), 50);
      } else if (e.code === "Escape" && paused) {
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
    if (!apiKey.trim()) {
      setError("Credential required — configure your access key");
      return;
    }
    setError("");
    setPhase("loading");

    try {
      const ref = parsePRURL(url);
      const diff = await fetchDiff(ref, githubToken || undefined);
      const result = await chunkDiff(diff, apiKey, model);
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
    setShowSettings(false);
  }

  // --- Settings terminal ---
  const settingsPanel = showSettings && (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="w-full max-w-md mx-6 bg-[var(--lumon-panel)] border border-[var(--lumon-border)] p-6">
        <div className="flex items-center gap-3 mb-6 pb-3 border-b border-[var(--lumon-border)]">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: "var(--lumon-cyan)",
              boxShadow: "0 0 6px var(--lumon-cyan-glow)",
            }}
          />
          <h2 className="text-xs tracking-[0.3em] text-[var(--lumon-cyan)] uppercase">
            Terminal Configuration
          </h2>
        </div>

        <p className="text-xs text-[var(--lumon-text-dim)] mb-5 leading-relaxed opacity-70">
          This terminal uses{" "}
          <a
            href="https://openrouter.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--lumon-cyan)] hover:underline"
          >
            OpenRouter
          </a>{" "}
          to access LLM providers. You'll need an OpenRouter API key — create
          one at{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--lumon-cyan)] hover:underline"
          >
            openrouter.ai/keys
          </a>
          .
        </p>

        <label className="block text-xs text-[var(--lumon-text-dim)] mb-1 tracking-wider uppercase">
          OpenRouter API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-or-..."
          className="w-full px-3 py-2 mb-4 bg-[var(--lumon-bg)] border border-[var(--lumon-border)] text-[var(--lumon-white)] text-sm focus:outline-none focus:border-[var(--lumon-cyan)]"
        />

        <label className="block text-xs text-[var(--lumon-text-dim)] mb-1 tracking-wider uppercase">
          Refinement Engine
        </label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full px-3 py-2 mb-4 bg-[var(--lumon-bg)] border border-[var(--lumon-border)] text-[var(--lumon-white)] text-sm focus:outline-none focus:border-[var(--lumon-cyan)]"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <label className="block text-xs text-[var(--lumon-text-dim)] mb-1 tracking-wider uppercase">
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
          className="w-full px-3 py-2 mb-6 bg-[var(--lumon-bg)] border border-[var(--lumon-border)] text-[var(--lumon-white)] text-sm focus:outline-none focus:border-[var(--lumon-cyan)]"
        />

        <p className="text-xs text-[var(--lumon-text-dim)] mb-6 leading-relaxed opacity-60">
          All credentials remain in local storage. No data leaves this
          terminal except to OpenRouter and GitHub.{" "}
          <a
            href="https://github.com/benaskins/revue"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--lumon-text)] underline hover:text-[var(--lumon-cyan)]"
          >
            Inspect source
          </a>
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setShowSettings(false)}
            className="px-4 py-2 text-xs tracking-wider text-[var(--lumon-text-dim)] border border-[var(--lumon-border)] hover:border-[var(--lumon-text-dim)] transition-colors uppercase"
          >
            Dismiss
          </button>
          <button
            onClick={handleSaveSettings}
            className="px-4 py-2 text-xs tracking-wider text-[var(--lumon-bg)] bg-[var(--lumon-cyan)] hover:brightness-110 transition-all uppercase"
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
      className="fixed top-4 right-4 p-2 text-[var(--lumon-text-dim)] hover:text-[var(--lumon-cyan)] transition-colors z-40"
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
              className="text-3xl font-light tracking-[0.4em] text-[var(--lumon-white)] uppercase mb-3"
              style={{ animation: "glow-pulse 4s ease-in-out infinite" }}
            >
              Revue
            </h1>
            <div className="w-16 h-px bg-[var(--lumon-border)] mx-auto mb-3" />
            <p className="text-xs tracking-[0.2em] text-[var(--lumon-text-dim)] uppercase">
              Code Refinement Terminal
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter pull request location"
              required
              className="w-full px-4 py-3 bg-[var(--lumon-panel)] border border-[var(--lumon-border)] text-[var(--lumon-white)] text-sm text-center tracking-wide focus:outline-none focus:border-[var(--lumon-cyan)] transition-colors"
            />
            <button
              type="submit"
              className="px-6 py-3 text-xs tracking-[0.3em] uppercase text-[var(--lumon-bg)] bg-[var(--lumon-cyan)] hover:brightness-110 transition-all"
              style={{
                boxShadow: "0 0 15px rgba(79, 209, 197, 0.15)",
              }}
            >
              Begin Refinement
            </button>
          </form>

          {!apiKey && (
            <p className="mt-6 text-[var(--lumon-text-dim)] text-xs tracking-wider">
              Configure your access key to proceed
            </p>
          )}
          {apiKey && (
            <p className="mt-6 text-[var(--lumon-text-dim)] text-xs tracking-wider opacity-50">
              Engine: {MODELS.find((m) => m.id === model)?.name || model}
            </p>
          )}
          {error && (
            <p className="mt-4 text-[var(--lumon-red)] text-xs tracking-wider">
              {error}
            </p>
          )}

          <div className="mt-16 text-[10px] text-[var(--lumon-text-dim)] opacity-40 tracking-wider leading-relaxed">
            <p>
              This terminal operates entirely within your browser.{" "}
              <a
                href="https://github.com/benaskins/revue"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--lumon-text)]"
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
        <RefinementAnimation />
      </div>
    );
  }

  // --- Ready phase ---
  if (phase === "ready") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--lumon-text-dim)] text-xs tracking-[0.3em] uppercase mb-6">
            Refinement Complete
          </p>
          <div
            className="text-7xl font-light text-[var(--lumon-cyan)] mb-4"
            style={{
              animation: "glow-pulse 3s ease-in-out infinite",
              textShadow:
                "0 0 20px var(--lumon-cyan-glow), 0 0 40px rgba(79, 209, 197, 0.1)",
            }}
          >
            {chunks.length}
          </div>
          <p className="text-[var(--lumon-text)] text-sm tracking-wider mb-2">
            bins ready for review
          </p>
          <p className="text-[var(--lumon-text-dim)] text-xs tracking-wider mb-10">
            estimated duration:{" "}
            {Math.ceil((chunks.length * BASE_MS) / 60_000)} min
          </p>
          <div className="animate-pulse">
            <p className="text-[var(--lumon-cyan)] text-xs tracking-[0.2em] uppercase">
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
            <p className="text-[var(--lumon-text-dim)] text-xs tracking-[0.3em] uppercase mb-3">
              Session Complete
            </p>
            <div className="flex items-center justify-center gap-6">
              <div>
                <div className="text-3xl text-[var(--lumon-cyan)]">
                  {flagged.length}
                </div>
                <div className="text-[10px] text-[var(--lumon-text-dim)] tracking-wider uppercase">
                  Flagged
                </div>
              </div>
              <div className="w-px h-8 bg-[var(--lumon-border)]" />
              <div>
                <div className="text-3xl text-[var(--lumon-text)]">
                  {chunks.length}
                </div>
                <div className="text-[10px] text-[var(--lumon-text-dim)] tracking-wider uppercase">
                  Total
                </div>
              </div>
            </div>
          </div>

          {flagged.length === 0 ? (
            <p className="text-[var(--lumon-text-dim)] text-center text-sm">
              No anomalies detected. All bins refined.
            </p>
          ) : (
            <div className="space-y-3 text-left">
              {flagged.map((f, i) => (
                <div
                  key={i}
                  className="bg-[var(--lumon-panel)] border border-[var(--lumon-border)] p-4"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] text-[var(--lumon-text-dim)] tracking-[0.2em] uppercase">
                      Bin {String(f.index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] text-[var(--lumon-yellow)] tracking-wider uppercase">
                      {f.chunk.category}
                    </span>
                  </div>
                  <p className="text-[var(--lumon-white)] text-sm mb-1">
                    {f.chunk.summary}
                  </p>
                  <p className="text-[var(--lumon-text-dim)] text-xs mb-2">
                    {f.chunk.files}
                  </p>
                  <div
                    className="border-l-2 border-[var(--lumon-yellow)] pl-3 mt-2"
                    style={{
                      background:
                        "linear-gradient(90deg, rgba(212, 170, 92, 0.05), transparent)",
                    }}
                  >
                    <p className="text-[var(--lumon-yellow)] text-sm whitespace-pre-wrap">
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
                className="px-4 py-2 text-xs tracking-wider text-[var(--lumon-cyan)] border border-[var(--lumon-border)] hover:border-[var(--lumon-cyan)] transition-colors uppercase"
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
              className="px-4 py-2 text-xs tracking-wider text-[var(--lumon-text-dim)] border border-[var(--lumon-border)] hover:border-[var(--lumon-text-dim)] transition-colors uppercase"
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

  const duration = chunkDuration(currentChunk.lines);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-6 pt-6">
        <TimerBar
          key={currentIndex}
          durationMs={duration}
          paused={paused}
          onComplete={advance}
        />
      </div>

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

      {/* Paused — anomaly detected */}
      {paused && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center pb-8 z-50">
          <div className="w-full max-w-2xl mx-6 bg-[var(--lumon-panel)] border border-[var(--lumon-yellow)] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{
                    background: "var(--lumon-yellow)",
                    boxShadow: "0 0 8px rgba(212, 170, 92, 0.4)",
                  }}
                />
                <span className="text-xs tracking-[0.2em] text-[var(--lumon-yellow)] uppercase">
                  Anomaly — Bin {String(currentIndex + 1).padStart(2, "0")}
                </span>
              </div>
              <span className="text-[10px] text-[var(--lumon-text-dim)] tracking-wider">
                ENTER to flag · ESC to dismiss
              </span>
            </div>
            <textarea
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tell us why this code scares you..."
              className="w-full bg-[var(--lumon-bg)] border border-[var(--lumon-border)] px-3 py-2 text-[var(--lumon-white)] text-sm focus:outline-none focus:border-[var(--lumon-yellow)] resize-none"
              rows={3}
            />
          </div>
        </div>
      )}

      {/* Bottom status */}
      <div className="text-center pb-4 flex items-center justify-center gap-6">
        {!paused && (
          <span className="text-[10px] text-[var(--lumon-text-dim)] tracking-[0.2em] uppercase">
            Press spacebar if the code scares you
          </span>
        )}
        {flagged.length > 0 && (
          <span className="text-[10px] text-[var(--lumon-yellow)] tracking-wider opacity-60">
            {flagged.length} flagged
          </span>
        )}
      </div>
    </div>
  );
}
