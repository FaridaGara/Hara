"use client";

import { useEffect, useState } from "react";

export function retryAfterSeconds(payload: unknown, fallback = 60): number {
  const value = payload && typeof payload === "object" && "retry_after" in payload
    ? payload.retry_after
    : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(86400, Math.ceil(value))
    : fallback;
}

// Use a deadline so background tabs do not stretch a server-supplied wait.
export function useRetryCountdown(initialSeconds = 0) {
  const [deadline, setDeadline] = useState(() => Date.now() + initialSeconds * 1000);
  const [remaining, setRemaining] = useState(initialSeconds);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) window.clearInterval(interval);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [deadline]);

  function start(seconds: number) {
    setDeadline(Date.now() + seconds * 1000);
    setRemaining(seconds);
  }

  return { remaining, start };
}
