import { describe, expect, it } from "vitest";
import { eventFixture } from "@/test/fixtures";
import { eventPrice, isNearby, matchesPeriod } from "./event-discovery";

describe("database discovery values", () => {
  it("never fabricates a price and preserves free and decimal tickets", () => {
    expect(eventPrice({...eventFixture, min_price: "12.00"})).toBe("12 AZN-dən");
    expect(eventPrice({...eventFixture, min_price: "0.00"})).toBe("Ödənişsiz");
    expect(eventPrice({...eventFixture, min_price: "12.50"})).toBe("12.50 AZN-dən");
    expect(eventPrice({...eventFixture, min_price: null})).toBe("Bilet məlumatı yoxdur");
  });
  it("uses Baku midnight and the entire Sunday for the calendar week", () => {
    const now = Date.parse("2026-09-13T10:00:00Z");
    const event = {...eventFixture, start_at: "2026-09-13T19:30:00Z", end_at: "2026-09-13T19:59:00Z"};
    expect(matchesPeriod(event, "week", now)).toBe(true);
    expect(matchesPeriod({...event, start_at: "2026-09-13T20:00:00Z", end_at: "2026-09-13T21:00:00Z"}, "week", now)).toBe(false);
    expect(matchesPeriod(eventFixture, "all", now)).toBe(false);
  });
  it("counts only real coordinates within 5 km", () => {
    const position = {latitude: 40.4, longitude: 49.8};
    expect(isNearby({...eventFixture, venue: {...eventFixture.venue, ...position}}, position)).toBe(true);
    expect(isNearby({...eventFixture, venue: {...eventFixture.venue, latitude: 41.2, longitude: 47.1}}, position)).toBe(false);
    expect(isNearby(eventFixture, position)).toBe(false);
  });
});
