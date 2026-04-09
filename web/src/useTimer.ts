import { useEffect, useState } from "react";

export function useTimer(durationMs: number, paused: boolean) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
  }, [durationMs]);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setElapsed((prev) => Math.min(prev + 50, durationMs));
    }, 50);
    return () => clearInterval(interval);
  }, [paused, durationMs]);

  const progress = Math.min(elapsed / durationMs, 1);
  return { progress, elapsed };
}
