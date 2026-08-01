import { apiRequest } from "./client";
import type { EventListFilters, HaraEvent } from "./contracts";

function eventListQuery(filters: EventListFilters) {
  const query = new URLSearchParams();

  if (filters.category) query.set("category", filters.category);
  if (filters.city) query.set("city", filters.city);
  if (filters.featured !== undefined) {
    query.set("featured", String(filters.featured));
  }
  if (filters.search) query.set("search", filters.search);
  if (filters.ordering) query.set("ordering", filters.ordering);

  const value = query.toString();
  return value ? `?${value}` : "";
}

export const eventsApi = {
  list(filters: EventListFilters = {}, signal?: AbortSignal) {
    return apiRequest<HaraEvent[]>(`/api/events/${eventListQuery(filters)}`, {
      auth: "none",
      signal,
    });
  },

  detail(slug: string, signal?: AbortSignal) {
    return apiRequest<HaraEvent>(`/api/events/${encodeURIComponent(slug)}/`, {
      auth: "none",
      signal,
    });
  },
};
