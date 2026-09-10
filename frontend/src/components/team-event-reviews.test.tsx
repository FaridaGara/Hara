import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { eventReviewsApi, type EventReviewDetail } from "@/lib/api/event-reviews";
import { ApiError } from "@/lib/api/client";
import { EMPTY_EVENT_DRAFT } from "@/lib/event-draft";
import { TeamReviewDetail, TeamReviewList } from "./team-event-reviews";
const account = vi.hoisted(() => ({ id: 7, can_review_events: true }));
vi.mock("./auth-provider", () => ({ useAuth: () => ({ user: account }) }));
const detail = (): EventReviewDetail => ({
  id: "00000000-0000-4000-8000-000000000007", title: "Caz gecəsi", status: "pending", note: "", event_slug: "caz", sales_start_at: null,
  version: "a".repeat(64), can_moderate: true, submitted_at: "2026-09-10T08:00:00Z", creator: { id: 8, name: "Aysel", email: "aysel@example.com", phone: "+994501234567" }, history: [],
  snapshot: { ...structuredClone(EMPTY_EVENT_DRAFT), title: "Caz gecəsi", category: "music", categoryLabel: "Musiqi", description: "Canlı caz",
    media: { cover: "data:image/jpeg;base64,YQ==", gallery: [] } },
});
beforeEach(() => {
  account.can_review_events = true;
  vi.spyOn(eventReviewsApi, "get").mockResolvedValue(detail());
  vi.spyOn(eventReviewsApi, "list").mockResolvedValue({ count: 1, next: null, previous: null, results: [detail()] });
  vi.spyOn(eventReviewsApi, "act").mockResolvedValue(detail());
});
it("denies accounts without team capability before requesting private data", () => {
  account.can_review_events = false;
  render(<TeamReviewDetail id="7" />);
  expect(screen.getByRole("alert").textContent).toContain("komanda icazəsi");
  expect(eventReviewsApi.get).not.toHaveBeenCalled();
});
it("shows creator contacts, event media and persists internal comments only after success", async () => {
  render(<TeamReviewDetail id={detail().id} />);
  await screen.findByText("Aysel");
  expect(screen.getByRole("link", { name: "aysel@example.com" }).getAttribute("href")).toBe("mailto:aysel@example.com");
  expect(screen.getByRole("link", { name: "+994501234567" }).getAttribute("href")).toBe("tel:+994501234567");
  expect(screen.getByAltText("Caz gecəsi — üz qabığı")).toBeTruthy();
  let resolve!: (data: EventReviewDetail) => void;
  vi.mocked(eventReviewsApi.act).mockImplementation(() => new Promise(r => { resolve = r; }));
  await userEvent.type(screen.getByRole("textbox", { name: "Şərh və ya düzəliş səbəbi" }), "Media yoxlanılıb");
  const button = screen.getByRole("button", { name: "Daxili şərh əlavə et" });
  fireEvent.click(button); fireEvent.click(button);
  expect(eventReviewsApi.act).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Daxili şərh saxlanıldı.")).toBeNull();
  await act(async () => resolve({ ...detail(), history: [{ id: "log", action: "comment", body: "Media yoxlanılıb", author: "Reviewer", created_at: "2026-09-10T09:00:00Z" }] }));
  expect(await screen.findByText("Daxili şərh saxlanıldı.")).toBeTruthy();
  expect(screen.getByText("Media yoxlanılıb")).toBeTruthy();
});
it("requires inspection and decision confirmation before publishing", async () => {
  vi.mocked(eventReviewsApi.act).mockResolvedValue({ ...detail(), status: "published" });
  render(<TeamReviewDetail id={detail().id} />); await screen.findByText("Aysel");
  expect((screen.getByRole("button", { name: "Təsdiqlə və yayımla" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Təsdiqlə və yayımla" }));
  expect(eventReviewsApi.act).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Qərarı təsdiqlə" }));
  await screen.findByText("Tədbir təsdiqləndi və yayımlandı.");
  expect(eventReviewsApi.act).toHaveBeenCalledWith(detail().id, expect.objectContaining({ action: "approved", reviewed: true, version: detail().version }));
});
it("requires a correction note and exposes a read-only mode", async () => {
  const view = render(<TeamReviewDetail id={detail().id} />); await screen.findByText("Aysel");
  expect((screen.getByRole("button", { name: "Düzəliş tələb et" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByRole("textbox", { name: "Şərh və ya düzəliş səbəbi" }), "Ünvanı tamamla");
  await userEvent.click(screen.getByRole("button", { name: "Düzəliş tələb et" }));
  vi.mocked(eventReviewsApi.act).mockResolvedValue({ ...detail(), status: "changes_requested", note: "Ünvanı tamamla" });
  await userEvent.click(screen.getByRole("button", { name: "Qərarı təsdiqlə" }));
  expect(eventReviewsApi.act).toHaveBeenCalledWith(detail().id, expect.objectContaining({ action: "changes_requested", body: "Ünvanı tamamla" }));
  view.unmount();
  vi.mocked(eventReviewsApi.get).mockResolvedValue({ ...detail(), can_moderate: false });
  render(<TeamReviewDetail id={detail().id} />); await screen.findByText("Aysel");
  expect(screen.queryByRole("button", { name: "Daxili şərh əlavə et" })).toBeNull();
});
it("blocks stale decisions until refreshed and retains the unsent text", async () => {
  vi.mocked(eventReviewsApi.act).mockRejectedValue(new ApiError({ kind: "http", status: 409, message: "Tədbir dəyişib" }));
  render(<TeamReviewDetail id={detail().id} />); await screen.findByText("Aysel");
  await userEvent.type(screen.getByRole("textbox", { name: "Şərh və ya düzəliş səbəbi" }), "Yeni qeyd");
  await userEvent.click(screen.getByRole("button", { name: "Daxili şərh əlavə et" }));
  await screen.findByText("Tədbir dəyişib");
  expect((screen.getByRole("button", { name: "Daxili şərh əlavə et" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Məlumatları yenilə" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Daxili şərh əlavə et" }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole("textbox", { name: "Şərh və ya düzəliş səbəbi" }) as HTMLTextAreaElement).value).toBe("Yeni qeyd");
});
it("retries an uncertain write with the same request identity", async () => {
  vi.mocked(eventReviewsApi.act).mockRejectedValueOnce(new ApiError({ kind: "timeout", message: "timeout" }));
  render(<TeamReviewDetail id={detail().id} />); await screen.findByText("Aysel");
  await userEvent.type(screen.getByRole("textbox", { name: "Şərh və ya düzəliş səbəbi" }), "Qeyd");
  await userEvent.click(screen.getByRole("button", { name: "Daxili şərh əlavə et" }));
  await userEvent.click(await screen.findByRole("button", { name: "Eyni sorğunu təkrar yoxla" }));
  await screen.findByText("Daxili şərh saxlanıldı.");
  const calls = vi.mocked(eventReviewsApi.act).mock.calls;
  expect(calls[0][1]).toEqual(calls[1][1]);
});
it("lists the review queue and filters by creator email", async () => {
  render(<TeamReviewList />); await screen.findByText("Aysel");
  expect(screen.getByRole("link", { name: "Tədbirə bax və yoxla" }).getAttribute("href")).toContain(detail().id);
  await userEvent.type(screen.getByRole("textbox"), "aysel@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Axtar" }));
  expect(eventReviewsApi.list).toHaveBeenLastCalledWith("pending", "aysel@example.com", 1, expect.any(AbortSignal));
});

it("requires a reason and explicit cancellation confirmation, then shows pending refunds", async () => {
  vi.mocked(eventReviewsApi.get).mockResolvedValue({ ...detail(), status: "published" });
  vi.mocked(eventReviewsApi.act).mockResolvedValue({ ...detail(), status: "cancelled", note: "Məkan bağlanıb",
    refund_requests: [{ id: "refund", order_id: "order-123", amount: "25.00", currency: "AZN", status: "pending", created_at: "2026-09-10T10:00:00Z" }] });
  render(<TeamReviewDetail id={detail().id} />); await screen.findByText("Aysel");
  expect((screen.getByRole("button", { name: "Tədbiri dayandır" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByRole("textbox", { name: "Şərh və ya dayandırma səbəbi" }), "Məkan bağlanıb");
  await userEvent.click(screen.getByRole("button", { name: "Tədbiri dayandır" }));
  expect(eventReviewsApi.act).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").textContent).toContain("Pul avtomatik qaytarılmır");
  await userEvent.click(screen.getByRole("button", { name: "Qərarı təsdiqlə" }));
  await screen.findByText("25.00 AZN · Gözlənilir");
  expect(eventReviewsApi.act).toHaveBeenCalledWith(detail().id, expect.objectContaining({ action: "cancelled", body: "Məkan bağlanıb", version: detail().version }));
  expect(screen.queryByRole("button", { name: "Tədbiri dayandır" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Yayımlanmış tədbirə bax" })).toBeNull();
});
