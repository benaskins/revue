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

// Scanning animation for loading phase
function ScanAnimation() {
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="relative w-64 h-64">
        <div className="absolute inset-0 border-2 border-neutral-800 rounded-full animate-[spin_8s_linear_infinite]" />
        <div className="absolute inset-4 border border-neutral-700 rounded-full animate-[spin_6s_linear_infinite_reverse]" />
        <div className="absolute inset-8 border border-neutral-700/50 rounded-full animate-[spin_4s_linear_infinite]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[pulse_2s_ease-in-out_infinite]" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 bg-white/60 rounded-full animate-[pulse_1.5s_ease-in-out_infinite]" />
        </div>
        {["+", "-", "@@", "+", "-", "+"].map((sym, i) => (
          <div
            key={i}
            className="absolute text-xs animate-[float_3s_ease-in-out_infinite]"
            style={{
              color:
                sym === "+"
                  ? "rgb(74 222 128 / 0.4)"
                  : sym === "-"
                    ? "rgb(248 113 113 / 0.4)"
                    : "rgb(148 163 184 / 0.3)",
              top: `${20 + Math.sin(i * 1.2) * 30}%`,
              left: `${15 + ((i * 17) % 70)}%`,
              animationDelay: `${i * 0.5}s`,
            }}
          >
            {sym}
          </div>
        ))}
      </div>
      <div className="text-center">
        <p className="text-white text-lg font-medium mb-2">Analysing diff</p>
        <p className="text-neutral-500 text-sm">
          Grouping changes into reviewable chunks...
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

  // Settings
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

  // Keyboard handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture keys when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        // Only handle Enter in the note textarea when paused
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
      setError("OpenRouter API key required — click the gear icon");
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

  // --- Settings panel ---
  const settingsPanel = showSettings && (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="w-full max-w-md mx-6 bg-neutral-900 border border-neutral-700 rounded-lg p-6">
        <h2 className="text-lg font-bold text-white mb-4">Settings</h2>

        <label className="block text-sm text-neutral-400 mb-1">
          OpenRouter API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-or-..."
          className="w-full px-3 py-2 mb-4 bg-neutral-800 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 text-sm"
        />

        <label className="block text-sm text-neutral-400 mb-1">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full px-3 py-2 mb-4 bg-neutral-800 border border-neutral-700 rounded text-white focus:outline-none focus:border-neutral-500 text-sm"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <label className="block text-sm text-neutral-400 mb-1">
          GitHub Token{" "}
          <span className="text-neutral-600">(optional, for private repos)</span>
        </label>
        <input
          type="password"
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          placeholder="ghp_..."
          className="w-full px-3 py-2 mb-6 bg-neutral-800 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 text-sm"
        />

        <p className="text-xs text-neutral-600 mb-6 leading-relaxed">
          Your keys stay in your browser (localStorage). This app has no
          backend — all requests go directly to OpenRouter and GitHub.{" "}
          <a
            href="https://github.com/benaskins/revue"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-500 underline hover:text-neutral-400"
          >
            View source
          </a>
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setShowSettings(false)}
            className="px-4 py-2 text-sm text-neutral-400 border border-neutral-700 rounded hover:border-neutral-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveSettings}
            className="px-4 py-2 text-sm text-black bg-white rounded hover:bg-neutral-200 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  // --- Settings gear (always visible on input phase) ---
  const settingsButton = (
    <button
      onClick={() => setShowSettings(true)}
      className="fixed top-4 right-4 p-2 text-neutral-600 hover:text-neutral-400 transition-colors z-40"
      title="Settings"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" />
        <path d="M16.4 12.4a1.2 1.2 0 00.24 1.32l.04.04a1.44 1.44 0 11-2.04 2.04l-.04-.04a1.2 1.2 0 00-1.32-.24 1.2 1.2 0 00-.72 1.08v.12a1.44 1.44 0 11-2.88 0v-.06a1.2 1.2 0 00-.78-1.08 1.2 1.2 0 00-1.32.24l-.04.04a1.44 1.44 0 11-2.04-2.04l.04-.04a1.2 1.2 0 00.24-1.32 1.2 1.2 0 00-1.08-.72h-.12a1.44 1.44 0 110-2.88h.06a1.2 1.2 0 001.08-.78 1.2 1.2 0 00-.24-1.32l-.04-.04a1.44 1.44 0 112.04-2.04l.04.04a1.2 1.2 0 001.32.24h.06a1.2 1.2 0 00.72-1.08v-.12a1.44 1.44 0 112.88 0v.06a1.2 1.2 0 00.78 1.08 1.2 1.2 0 001.32-.24l.04-.04a1.44 1.44 0 112.04 2.04l-.04.04a1.2 1.2 0 00-.24 1.32v.06a1.2 1.2 0 001.08.72h.12a1.44 1.44 0 110 2.88h-.06a1.2 1.2 0 00-1.08.78z" />
      </svg>
    </button>
  );

  // --- Input phase ---
  if (phase === "input") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {settingsButton}
        {settingsPanel}
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
            />
            <button
              type="submit"
              className="px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-neutral-200 transition-colors"
            >
              Start Review
            </button>
          </form>
          {!apiKey && (
            <p className="mt-4 text-neutral-600 text-sm">
              Set your OpenRouter API key in settings to get started
            </p>
          )}
          {apiKey && (
            <p className="mt-4 text-neutral-700 text-xs">
              Using {MODELS.find((m) => m.id === model)?.name || model}
            </p>
          )}
          {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}

          <div className="mt-12 text-xs text-neutral-700 leading-relaxed">
            <p>
              Runs entirely in your browser. No backend, no tracking, no
              cookies.{" "}
              <a
                href="https://github.com/benaskins/revue"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-600 underline hover:text-neutral-500"
              >
                Source on GitHub
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
        <ScanAnimation />
      </div>
    );
  }

  // --- Ready phase ---
  if (phase === "ready") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl font-bold text-white mb-4">
            {chunks.length}
          </div>
          <p className="text-neutral-400 text-lg mb-2">
            chunks ready for review
          </p>
          <p className="text-neutral-600 text-sm mb-8">
            ~{Math.ceil((chunks.length * BASE_MS) / 60_000)} min at 1 min per
            card
          </p>
          <div className="animate-pulse">
            <p className="text-white text-sm">Press spacebar to begin</p>
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
          <h1 className="text-3xl font-bold mb-2 text-white">
            Review Complete
          </h1>
          <p className="text-neutral-400 mb-6">
            {flagged.length} of {chunks.length} chunks flagged
          </p>

          {flagged.length === 0 ? (
            <p className="text-neutral-500">No chunks flagged. Clean PR!</p>
          ) : (
            <div className="space-y-4 text-left">
              {flagged.map((f, i) => (
                <div
                  key={i}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-neutral-500">
                      Chunk {f.index + 1}
                    </span>
                    <span className="text-xs text-yellow-400/70">
                      {f.chunk.category}
                    </span>
                  </div>
                  <p className="text-white text-sm mb-1">{f.chunk.summary}</p>
                  <p className="text-neutral-500 text-xs mb-2">
                    {f.chunk.files}
                  </p>
                  <div className="bg-neutral-800 rounded px-3 py-2">
                    <p className="text-yellow-300 text-sm whitespace-pre-wrap">
                      {f.note}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            {flagged.length > 0 && (
              <button
                onClick={() => {
                  const text = flagged
                    .map(
                      (f) =>
                        `## Chunk ${f.index + 1}: ${f.chunk.summary}\n**Files:** ${f.chunk.files}\n**Category:** ${f.chunk.category}\n\n> ${f.note}\n`,
                    )
                    .join("\n---\n\n");
                  navigator.clipboard.writeText(text);
                }}
                className="px-4 py-2 text-sm text-white bg-neutral-800 border border-neutral-700 rounded hover:border-neutral-500 transition-colors"
              >
                Copy to Clipboard
              </button>
            )}
            <button
              onClick={() => {
                setPhase("input");
                setChunks([]);
                setFlagged([]);
              }}
              className="px-4 py-2 text-sm text-neutral-400 border border-neutral-700 rounded hover:border-neutral-500 transition-colors"
            >
              New Review
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
      <div className="px-6 pt-4">
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

      <div className="text-center pb-4 flex items-center justify-center gap-4">
        {!paused && (
          <span className="text-xs text-neutral-600">
            spacebar to pause and examine
          </span>
        )}
        {flagged.length > 0 && (
          <span className="text-xs text-yellow-400/60">
            {flagged.length} flagged
          </span>
        )}
      </div>
    </div>
  );
}
