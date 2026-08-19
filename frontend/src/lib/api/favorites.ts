import { apiRequest } from "./client";
import type { HaraEvent } from "./contracts";

export const favoritesApi = {
  list(signal?: AbortSignal) {
    return apiRequest<HaraEvent[]>("/api/favorites/", {
      auth: "required",
      signal,
    });
  },

  add(eventId: string) {
    return apiRequest<HaraEvent>("/api/favorites/", {
      method: "POST",
      auth: "required",
      body: { event_id: eventId },
    });
  },

  remove(eventId: string) {
    return apiRequest<void>(`/api/favorites/${encodeURIComponent(eventId)}/`, {
      method: "DELETE",
      auth: "required",
    });
  },
};
