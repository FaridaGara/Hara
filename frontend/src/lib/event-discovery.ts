import type { HaraEvent, PublicTicketType } from "@/lib/api/contracts";

export function eventPriceValue(event: HaraEvent): number | null {
  if (event.min_price !== undefined) {
    const value = event.min_price === null ? NaN : Number(event.min_price);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const prices = (event as HaraEvent & {ticket_types?: PublicTicketType[]}).ticket_types
    ?.map((ticket) => Number(ticket.price)).filter((price) => Number.isFinite(price) && price >= 0);
  return prices?.length ? Math.min(...prices) : null;
}

export function eventPrice(event: HaraEvent, from = true) {
  const value = eventPriceValue(event);
  if (value === null) return "Bilet məlumatı yoxdur";
  if (value === 0) return "Ödənişsiz";
  return `${Number.isInteger(value) ? value : value.toFixed(2)} AZN${from ? "-dən" : ""}`;
}

const DAY = 86400000;
const BAKU_OFFSET = 4 * 3600000;
export type DiscoveryPeriod = "all" | "today" | "week" | "month";
export function matchesPeriod(event: HaraEvent, period: DiscoveryPeriod, now = Date.now()) {
  const start = Date.parse(event.start_at), end = Date.parse(event.end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now) return false;
  if (period === "all") return true;
  const local = new Date(now + BAKU_OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const boundary = period === "today" ? midnight + DAY
    : period === "week" ? midnight + (7 - ((local.getUTCDay() + 6) % 7)) * DAY
    : Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
  return start < boundary - BAKU_OFFSET;
}

export type Coordinates = {latitude: number; longitude: number};
export function isNearby(event: HaraEvent, position: Coordinates, radiusKm = 5) {
  const {latitude, longitude} = event.venue;
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const a = Math.sin(rad(latitude - position.latitude) / 2) ** 2 +
    Math.cos(rad(position.latitude)) * Math.cos(rad(latitude)) * Math.sin(rad(longitude - position.longitude) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <= radiusKm;
}
