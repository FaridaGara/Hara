import { apiRequest } from "./client";

export type AppNotification = {
  id: number; type: string; title: string; body: string;
  event_slug?: string | null; event_title?: string | null; event_status?: string | null;
  cancellation_reason?: string | null; organizer_name: string;
  read_at: string | null; created_at: string;
};
export const notificationsApi = {
  list(page = 1, signal?: AbortSignal) {
    return apiRequest<{ results: AppNotification[]; count: number; next: string | null; previous: string | null; unread_count: number }>(`/api/notifications/inbox/?page=${page}`, { auth: "required", signal });
  },
  count(signal?: AbortSignal) {
    return apiRequest<{ unread_count: number }>("/api/notifications/unread-count/", { auth: "required", signal });
  },
  read(id: number) {
    return apiRequest<{ id: number; read_at: string }>(`/api/notifications/${id}/read/`, { auth: "required", method: "POST" });
  },
};
