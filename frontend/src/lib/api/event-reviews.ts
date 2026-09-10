import { apiRequest } from "./client";
import type { EventSubmission } from "./event-submissions";
import type { EventDraft } from "../event-draft";
export type ReviewAction = "comment" | "changes_requested" | "approved";
export type EventReview = EventSubmission & {
  version: string; can_moderate: boolean;
  creator: { id: number; name: string; email: string; phone: string };
};
export type EventReviewDetail = EventReview & {
  snapshot: EventDraft;
  history: { id: string; action: ReviewAction; body: string; author: string; created_at: string }[];
};
export type ReviewRequest = { request_id: string; version: string; action: ReviewAction; body: string; reviewed: boolean };
export const eventReviewsApi = {
  list(status: string, search: string, page: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ status, search, page: String(page) });
    return apiRequest<{ count: number; next: string | null; previous: string | null; results: EventReview[] }>(`/api/team/event-reviews/?${query}`, { auth: "required", signal });
  },
  get(id: string, signal?: AbortSignal) { return apiRequest<EventReviewDetail>(`/api/team/event-reviews/${id}/`, { auth: "required", signal }); },
  act(id: string, body: ReviewRequest) { return apiRequest<EventReviewDetail>(`/api/team/event-reviews/${id}/`, { auth: "required", method: "POST", body, timeoutMs: 30_000 }); },
};
