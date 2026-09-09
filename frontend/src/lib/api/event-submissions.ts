import { apiRequest } from "./client";
import type { EventDraft } from "../event-draft";

export type EventSubmission = {
  id: string; status: "pending" | "changes_requested" | "published" | "cancelled" | "completed";
  title: string; note: string; event_slug: string; sales_start_at: string | null;
  snapshot?: EventDraft;
};
export type SubmissionEligibility = { eligible: boolean; detail: string };
export const eventSubmissionsApi = {
  eligibility(signal?: AbortSignal) { return apiRequest<SubmissionEligibility>("/api/event-submissions/eligibility/", { auth: "required", signal }); },
  list() { return apiRequest<EventSubmission[]>("/api/event-submissions/", { auth: "required" }); },
  get(id: string, signal?: AbortSignal) { return apiRequest<EventSubmission>(`/api/event-submissions/${id}/`, { auth: "required", signal }); },
  submit(id: string, snapshot: EventDraft) { return apiRequest<EventSubmission>(`/api/event-submissions/${id}/`, { auth: "required", method: "PUT", body: { snapshot }, timeoutMs: 30_000 }); },
};
