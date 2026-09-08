import { describe, expect, it } from "vitest";
import { bakuToday, changeStart, emptySchedule, isScheduleComplete, readSchedule, scheduleError, scheduleMinutes, wallTime } from "./event-schedule";

describe("Baku event scheduling", () => {
  it("rolls a duration over midnight and preserves a manually edited end", () => {
    const automatic = changeStart(emptySchedule(), "2099-12-31", "23:30", "120");
    expect(automatic).toMatchObject({ endDate: "2100-01-01", endTime: "01:30" });
    expect(scheduleMinutes(automatic)).toBe(120);
    expect(changeStart({ ...automatic, endEdited: true }, "2099-12-31", "22:00", "120"))
      .toMatchObject({ endDate: "2100-01-01", endTime: "01:30" });
  });

  it("validates real calendar dates and Baku time independently of browser timezone", () => {
    expect(wallTime("2026-02-30", "22:00")).toBeNull();
    expect(wallTime("2026-10-28", "24:00")).toBeNull();
    expect(bakuToday(Date.parse("2026-10-28T21:00:00Z"))).toBe("2026-10-29");
    const schedule = changeStart(emptySchedule(), "2026-10-28", "20:00", "120");
    expect(scheduleError(schedule, Date.parse("2026-10-28T15:59:00Z"))).toBeNull();
    expect(scheduleError(schedule, Date.parse("2026-10-28T16:00:00Z"))).toContain("gələcəkdə");
    expect(scheduleError({ ...schedule, endTime: "20:00" }, 0)).toContain("sonra");
    expect(scheduleError({ ...schedule, endTime: "19:00" }, 0)).toContain("sonra");
  });

  it("requires a confirmed venue point and rejects damaged saved coordinates", () => {
    const schedule = changeStart(emptySchedule(), "2099-10-28", "20:00", "120");
    expect(isScheduleComplete(schedule, 0)).toBe(false);
    const venue = { id: null, source: "manual" as const, name: "Salon", address: "Ünvan", city: "", entry_note: "", latitude: 0, longitude: 0, plan_id: null, capacity: null };
    expect(isScheduleComplete({ ...schedule, venue }, 0)).toBe(true);
    expect(readSchedule({ ...schedule, venue: { ...venue, latitude: 91 } }).venue).toBeNull();
    expect(readSchedule({ manualVenue: { latitude: null, longitude: 49 } }).manualVenue.latitude).toBeNull();
    expect(readSchedule({ ...schedule, venue: { ...venue, plan_id: "untrusted" } }).venue?.plan_id).toBeNull();
  });
});
