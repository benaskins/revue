import { useEffect, useState } from "react";

interface TimerBarProps {
  durationMs: number;
  paused: boolean;
  onComplete: () => void;
}

export default function TimerBar({
  durationMs,
  paused,
  onComplete,
}: TimerBarProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
  }, [durationMs]);

  useEffect(() => {
    if (paused) return;

    const interval = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 16;
        if (next >= durationMs) {
          clearInterval(interval);
          onComplete();
          return durationMs;
        }
        return next;
      });
    }, 16);

    return () => clearInterval(interval);
  }, [paused, durationMs, onComplete]);

  const progress = Math.min(elapsed / durationMs, 1);
  const remaining = Math.max(0, (1 - progress) * 100);

  return (
    <div className="w-full h-px bg-[var(--lumon-border)] overflow-hidden relative">
      <div
        className="h-full transition-none"
        style={{
          width: `${remaining}%`,
          background: `linear-gradient(90deg, var(--lumon-cyan-glow), var(--lumon-cyan))`,
          boxShadow: `0 0 8px var(--lumon-cyan-glow), 0 0 2px var(--lumon-cyan)`,
        }}
      />
    </div>
  );
}
