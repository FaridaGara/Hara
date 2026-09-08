import type { VenueChoice } from "./api/contracts";

export type EventVenueDraft = Omit<VenueChoice, "id"> & {
  id: string | null;
  source: "catalog" | "manual";
  entry_note: string;
};
export type ManualVenueDraft = {
  name: string; address: string; entryNote: string;
  latitude: number | null; longitude: number | null;
};
export type EventSchedule = {
  startDate: string; startTime: string; endDate: string; endTime: string;
  endEdited: boolean;
  venue: EventVenueDraft | null;
  manualVenue: ManualVenueDraft;
};

export function emptySchedule(): EventSchedule {
  return {
    startDate: "", startTime: "", endDate: "", endTime: "", endEdited: false, venue: null,
    manualVenue: { name: "", address: "", entryNote: "", latitude: null, longitude: null },
  };
}

// These are wall-clock values in Baku, not dates in the browser's local timezone.
export function wallTime(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const parsed = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 16) !== `${date}T${time}`) return null;
  return parsed;
}

export function bakuToday(now = Date.now()) {
  return new Date(now + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function suggestedEnd(schedule: EventSchedule, duration: string) {
  const start = wallTime(schedule.startDate, schedule.startTime);
  const minutes = /^\d{1,5}$/.test(duration) ? Number(duration) : 0;
  if (start === null || minutes <= 0) return null;
  const end = new Date(start + minutes * 60_000).toISOString();
  return { endDate: end.slice(0, 10), endTime: end.slice(11, 16) };
}

export function changeStart(schedule: EventSchedule, date: string, time: string, duration: string): EventSchedule {
  const next = { ...schedule, startDate: date, startTime: time };
  const suggestion = !schedule.endEdited ? suggestedEnd(next, duration) : null;
  return suggestion ? { ...next, ...suggestion } : next;
}

export function scheduleMinutes(schedule: EventSchedule) {
  const start = wallTime(schedule.startDate, schedule.startTime);
  const end = wallTime(schedule.endDate, schedule.endTime);
  return start === null || end === null || end <= start ? null : (end - start) / 60_000;
}

export function formatDuration(minutes: number | null) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} saat` : "", remainder ? `${remainder} dəqiqə` : ""].filter(Boolean).join(" ");
}

export function formatWizardDate(value: string) {
  if (wallTime(value, "00:00") === null) return "Tarix seç";
  return new Intl.DateTimeFormat("az-AZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function scheduleError(schedule: EventSchedule, now = Date.now()) {
  const start = wallTime(schedule.startDate, schedule.startTime);
  const end = wallTime(schedule.endDate, schedule.endTime);
  if (start === null) return "Başlama tarixini və saatını seç.";
  if (start - 4 * 60 * 60 * 1000 <= now) return "Başlama vaxtı gələcəkdə olmalıdır.";
  if (end === null) return "Bitmə tarixini və saatını seç.";
  if (end <= start) return "Bitmə vaxtı başlamadan sonra olmalıdır.";
  return null;
}

export function isScheduleComplete(schedule: EventSchedule, now = Date.now()) {
  const venue = schedule.venue;
  return !scheduleError(schedule, now) && Boolean(venue?.name.trim() && venue.address.trim() &&
    validCoordinates(venue.latitude, venue.longitude));
}

export function readSchedule(value: unknown): EventSchedule {
  const empty = emptySchedule();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const data = value as Record<string, unknown>;
  const text = (obj: Record<string, unknown>, key: string, max: number) => typeof obj[key] === "string" ? obj[key].slice(0, max) : "";
  const manual = data.manualVenue && typeof data.manualVenue === "object" ? data.manualVenue as Record<string, unknown> : {};
  const manualHasPoint = validCoordinates(manual.latitude, manual.longitude);
  let venue: EventVenueDraft | null = null;
  if (data.venue && typeof data.venue === "object") {
    const saved = data.venue as Record<string, unknown>;
    const name = text(saved, "name", 200); const address = text(saved, "address", 300);
    const id = text(saved, "id", 64);
    if (name.trim() && address.trim() && validCoordinates(saved.latitude, saved.longitude) &&
      (saved.source === "manual" || (saved.source === "catalog" && id))) {
      venue = {
        id: saved.source === "manual" ? null : id, source: saved.source, name, address,
        city: text(saved, "city", 100), entry_note: text(saved, "entry_note", 300),
        latitude: saved.latitude as number, longitude: saved.longitude as number,
        plan_id: saved.source === "catalog" ? text(saved, "plan_id", 64) || null : null,
        capacity: saved.source === "catalog" && typeof saved.capacity === "number" && Number.isFinite(saved.capacity) && saved.capacity >= 0 ? Math.floor(saved.capacity) : null,
      };
    }
  }
  return {
    startDate: wallTime(text(data, "startDate", 10), "00:00") !== null ? text(data, "startDate", 10) : "",
    endDate: wallTime(text(data, "endDate", 10), "00:00") !== null ? text(data, "endDate", 10) : "",
    startTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.startTime)) ? String(data.startTime) : "",
    endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.endTime)) ? String(data.endTime) : "",
    endEdited: data.endEdited === true, venue,
    manualVenue: { name: text(manual, "name", 200), address: text(manual, "address", 300), entryNote: text(manual, "entryNote", 300),
      latitude: manualHasPoint ? manual.latitude as number : null, longitude: manualHasPoint ? manual.longitude as number : null },
  };
}
