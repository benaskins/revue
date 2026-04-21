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
  const secondsLeft = Math.ceil((durationMs - elapsed) / 1000);
  const urgent = progress > 0.7;
  const critical = progress > 0.9;

  const barColor = critical
    ? "var(--revue-red)"
    : urgent
      ? "var(--revue-yellow)"
      : "var(--revue-cyan)";

  const glowColor = critical
    ? "rgba(224, 108, 96, 0.6)"
    : urgent
      ? "rgba(212, 170, 92, 0.4)"
      : "var(--revue-cyan-glow)";

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 h-px bg-[var(--revue-border)] overflow-hidden relative">
        <div
          className="h-full transition-none"
          style={{
            width: `${remaining}%`,
            background: `linear-gradient(90deg, ${glowColor}, ${barColor})`,
            boxShadow: `0 0 ${critical ? 12 : urgent ? 8 : 4}px ${glowColor}, 0 0 2px ${barColor}`,
          }}
        />
      </div>
      <span
        className="text-xs tabular-nums w-8 text-right tracking-wider"
        style={{
          color: barColor,
          animation: critical
            ? "glow-pulse 0.5s ease-in-out infinite"
            : urgent
              ? "glow-pulse 1.5s ease-in-out infinite"
              : "none",
        }}
      >
        {secondsLeft}
      </span>
    </div>
  );
}
