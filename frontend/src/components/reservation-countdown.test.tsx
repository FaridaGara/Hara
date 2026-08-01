import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { orderFixture } from "@/test/fixtures";

import {
  isOrderPayable,
  reservationClock,
  ReservationCountdown,
} from "./reservation-countdown";

afterEach(() => {
  vi.useRealTimers();
});

describe("reservation countdown", () => {
  it("ISO timestamp əsasında qalan saniyəni hesablayır", () => {
    expect(
      reservationClock("2026-08-01T12:01:30.000Z", Date.parse("2026-08-01T12:00:00Z")),
    ).toEqual({ expired: false, remainingSeconds: 90 });
  });

  it("0 olduqda expired display göstərir və frontend order statusunu dəyişmir", () => {
    const order = orderFixture({
      status: "pending",
      expires_at: "2026-08-01T12:00:00Z",
    });
    expect(isOrderPayable(order, Date.parse("2026-08-01T12:00:01Z"))).toBe(false);
    expect(order.status).toBe("pending");
  });

  it("refresh olunmuş expires_at ilə sayıb 0-da dayanır", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    render(<ReservationCountdown expiresAt="2026-08-01T12:00:02Z" />);

    expect(screen.getByText(/00:02/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("Rezervasiya vaxtı bitib")).toBeTruthy();
  });
});
