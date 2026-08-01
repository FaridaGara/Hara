import { apiRequest } from "./client";
import type { Ticket, TicketListFilters } from "./contracts";

function ticketListQuery(filters: TicketListFilters) {
  const query = new URLSearchParams();

  if (filters.event_status) query.set("event_status", filters.event_status);
  if (filters.is_checked_in !== undefined) {
    query.set("is_checked_in", String(filters.is_checked_in));
  }

  const value = query.toString();
  return value ? `?${value}` : "";
}

export const ticketsApi = {
  list(filters: TicketListFilters = {}, signal?: AbortSignal) {
    return apiRequest<Ticket[]>(`/api/tickets/${ticketListQuery(filters)}`, {
      auth: "required",
      signal,
    });
  },

  detail(ticketId: string, signal?: AbortSignal) {
    return apiRequest<Ticket>(`/api/tickets/${encodeURIComponent(ticketId)}/`, {
      auth: "required",
      signal,
    });
  },
};
