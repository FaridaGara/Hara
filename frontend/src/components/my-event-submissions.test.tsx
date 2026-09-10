import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { eventSubmissionsApi, type EventSubmission } from "@/lib/api/event-submissions";
import { EMPTY_EVENT_DRAFT, readEventDraft, saveEventDraft } from "@/lib/event-draft";
import { MyEventSubmissions } from "./my-event-submissions";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./auth-provider", () => ({ useAuth: () => ({ user: { id: 7 } }) }));
const pending: EventSubmission = { id: "00000000-0000-4000-8000-000000000001", title: "Pulsuz caz", status: "pending", note: "", event_slug: "pulsuz-caz", sales_start_at: null, submitted_at: "2026-09-10T09:00:00Z", updated_at: "2026-09-10T09:00:00Z" };
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(eventSubmissionsApi, "list").mockResolvedValue([pending]);
});
it("shows server receipt, status and updates to published without replacing a draft", async () => {
  saveEventDraft(7, { ...structuredClone(EMPTY_EVENT_DRAFT), title: "Başqa qaralama" });
  render(<MyEventSubmissions />);
  await screen.findByText("Yoxlanılır");
  expect(screen.getByText("Göndərildi · Bakı vaxtı")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Tədbirə bax" })).toBeNull();
  vi.mocked(eventSubmissionsApi.list).mockResolvedValue([{ ...pending, status: "published" }]);
  await userEvent.click(screen.getByRole("button", { name: "Statusları yenilə" }));
  await screen.findByText("Yayımlanıb");
  expect(screen.getByRole("link", { name: "Tədbirə bax" }).getAttribute("href")).toBe("/events/pulsuz-caz");
  expect(readEventDraft(7).title).toBe("Başqa qaralama");
});
it("shows moderator notes on focus refresh and opens the requested correction", async () => {
  render(<MyEventSubmissions />); await screen.findByText("Yoxlanılır");
  const correction: EventSubmission = { ...pending, status: "changes_requested", note: "Ünvanı tamamla", snapshot: { ...structuredClone(EMPTY_EVENT_DRAFT), title: pending.title } };
  vi.mocked(eventSubmissionsApi.list).mockResolvedValue([correction]);
  vi.spyOn(eventSubmissionsApi, "get").mockResolvedValue(correction);
  fireEvent(window, new Event("focus"));
  await screen.findByText("Ünvanı tamamla");
  await userEvent.click(screen.getByRole("button", { name: "Düzəliş et və yenidən göndər" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/create-event?step=5"));
  expect(readEventDraft(7).submissionId).toBe(pending.id);
});
it("explains an empty list and preserves known status when refresh fails", async () => {
  vi.mocked(eventSubmissionsApi.list).mockResolvedValueOnce([]);
  render(<MyEventSubmissions />); await screen.findByText("Hələ tədbir göndərilməyib");
  expect(screen.getByText(/Qaralama saxlamaq tədbiri yoxlamaya göndərmir/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Statusları yenilə" }));
  await screen.findByText("Yoxlanılır");
  vi.mocked(eventSubmissionsApi.list).mockRejectedValue(new Error("offline"));
  await userEvent.click(screen.getByRole("button", { name: "Statusları yenilə" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Yoxlanılır")).toBeTruthy();
});
