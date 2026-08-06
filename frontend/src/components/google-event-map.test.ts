import { describe, expect, it } from "vitest";

import { eventFixture } from "@/test/fixtures";

import { eventCoordinates } from "./google-event-map";

describe("eventCoordinates", () => {
  it("venue koordinatlarını Google Maps formatına çevirir", () => {
    expect(
      eventCoordinates({
        ...eventFixture,
        venue: {
          ...eventFixture.venue,
          latitude: 40.3777,
          longitude: 49.8415,
        },
      }),
    ).toEqual({ lat: 40.3777, lng: 49.8415 });
  });

  it("çatışmayan və etibarsız koordinatları xəritəyə ötürmür", () => {
    expect(eventCoordinates(eventFixture)).toBeNull();
    expect(
      eventCoordinates({
        ...eventFixture,
        venue: { ...eventFixture.venue, latitude: 140, longitude: 49.8415 },
      }),
    ).toBeNull();
  });
});
