import { apiRequest } from "./client";
import type { VenueChoice } from "./contracts";

export const venuesApi = {
  search(search: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ search: search.trim() });
    return apiRequest<VenueChoice[]>(`/api/venues/?${query}`, { auth: "required", signal });
  },
};
