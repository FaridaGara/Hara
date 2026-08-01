"use client";

import { useEffect, useState } from "react";

import type { Order } from "@/lib/api";

export type ReservationClock = {
  expired: boolean;
  remainingSeconds: number | null;
};

export function reservationClock(
  expiresAt: string | null,
  nowMs = Date.now(),
): ReservationClock {
  if (!expiresAt) {
    return { expired: false, remainingSeconds: null };
  }

  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) {
    return { expired: true, remainingSeconds: 0 };
  }

  const remainingSeconds = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000));
  return { expired: remainingSeconds === 0, remainingSeconds };
}

export function isOrderPayable(order: Order, nowMs = Date.now()) {
  return (
    order.status === "pending" &&
    !reservationClock(order.expires_at, nowMs).expired
  );
}

function displayDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function ReservationCountdown({
  expiresAt,
  onElapsed,
}: {
  expiresAt: string | null;
  onElapsed?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const clock = reservationClock(expiresAt, now);

  useEffect(() => {
    if (!expiresAt || clock.expired) {
      return;
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [clock.expired, expiresAt]);

  useEffect(() => {
    if (clock.expired) {
      onElapsed?.();
    }
  }, [clock.expired, onElapsed]);

  if (clock.remainingSeconds === null) {
    return <span>Rezervasiya üçün vaxt limiti yoxdur</span>;
  }

  if (clock.expired) {
    return <span className="text-red-200">Rezervasiya vaxtı bitib</span>;
  }

  return (
    <span>
      Rezervasiyanın bitməsinə{" "}
      <strong className="tabular-nums text-[#98ff00]">
        {displayDuration(clock.remainingSeconds)}
      </strong>
    </span>
  );
}
