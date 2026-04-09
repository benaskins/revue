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

  return (
    <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-white/40 transition-none"
        style={{ width: `${(1 - progress) * 100}%` }}
      />
    </div>
  );
}
