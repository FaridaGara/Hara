import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EVENT_DRAFT, readEventDraft, saveEventDraft, type EventDraft } from "@/lib/event-draft";
import { eventSubmissionsApi, type EventSubmission } from "@/lib/api/event-submissions";
import { ApiError } from "@/lib/api/client";
import { reviewIssues } from "@/lib/event-review";
import { useEventDraft } from "@/hooks/use-event-draft";
import { EventReviewStep } from "./event-review-step";

const onEdit = vi.fn();
function validDraft(): EventDraft {
  return { ...structuredClone(EMPTY_EVENT_DRAFT), title: "Bakı Caz Gecəsi", category: "musiqi", description: "Canlı caz", age: "18+", language: "az", lastStep: 5,
    schedule: { ...EMPTY_EVENT_DRAFT.schedule, startDate: "2099-10-28", startTime: "20:00", endDate: "2099-10-28", endTime: "22:00", venue: { id: null, source: "manual", name: "Zal", address: "Bakı", city: "Bakı", latitude: 40.4, longitude: 49.8, capacity: null, plan_id: null, entry_note: "" } },
    sales: { ...structuredClone(EMPTY_EVENT_DRAFT.sales), capacity: "420", tickets: [{ id: "standard", name: "Standart", paymentType: "paid", price: "25", quantity: "300", includes: "Giriş", lastValidQuantity: "300" }], refundPolicy: "until_24h" },
    media: { cover: "data:image/jpeg;base64,YQ==", gallery: ["data:image/jpeg;base64,Yg=="] },
  };
}
function Harness() { return <EventReviewStep {...useEventDraft(7)} onEdit={onEdit} onBack={vi.fn()} />; }
const pending = (id: string): EventSubmission => ({ id, status: "pending", title: "Bakı Caz Gecəsi", note: "", event_slug: "caz", sales_start_at: null });
beforeEach(() => {
  vi.restoreAllMocks(); onEdit.mockClear(); localStorage.clear(); saveEventDraft(7, validDraft());
  vi.spyOn(eventSubmissionsApi, "eligibility").mockResolvedValue({ eligible: true, detail: "Hazırdır" });
  vi.spyOn(eventSubmissionsApi, "get").mockRejectedValue(new ApiError({ kind: "http", status: 404, message: "Tapılmadı" }));
});
async function confirm() {
  await screen.findByText("Təşkilatçı hesabı hazırdır");
  await userEvent.click(screen.getByRole("button", { name: "Yoxlamaya göndər" }));
  await userEvent.click(screen.getByRole("button", { name: "Təsdiqlə və göndər" }));
}
describe("step five review", () => {
  it("previews the selected image and settings and returns without losing them", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "İştirakçı kimi önbaxış" }));
    expect(screen.getByRole("heading", { name: "Bakı Caz Gecəsi" })).toBeTruthy();
    expect(screen.getByAltText("Bakı Caz Gecəsi").getAttribute("src")).toBe(validDraft().media!.cover);
    expect(screen.getByText("18+")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Yekun yoxlamaya qayıt" }));
    expect(readEventDraft(7).media).toEqual(validDraft().media);
  });
  it("routes a missing cover to media and blocks submission", async () => {
    saveEventDraft(7, { ...validDraft(), media: { cover: "", gallery: [] } }); render(<Harness />);
    await screen.findByText("Təşkilatçı hesabı hazırdır");
    expect((screen.getByRole("button", { name: "Yoxlamaya göndər" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Düzəliş et" })); expect(onEdit).toHaveBeenCalledWith(4);
  });
  it("persists request identity before sending and ignores repeated confirmation", async () => {
    let resolve!: (value: EventSubmission) => void;
    const submit = vi.spyOn(eventSubmissionsApi, "submit").mockImplementation((id) => { expect(readEventDraft(7).submissionId).toBe(id); return new Promise(r => { resolve = r; }); });
    render(<Harness />); await screen.findByText("Təşkilatçı hesabı hazırdır");
    await userEvent.click(screen.getByRole("button", { name: "Yoxlamaya göndər" }));
    const button = screen.getByRole("button", { name: "Təsdiqlə və göndər" }); fireEvent.click(button); fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => resolve(pending(readEventDraft(7).submissionId!)));
    expect(await screen.findByRole("heading", { name: "Tədbirin yoxlanılır" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Tədbirə bax" })).toBeNull();
  });
  it("resolves a lost response with GET without resubmitting", async () => {
    const submit = vi.spyOn(eventSubmissionsApi, "submit").mockRejectedValue(new ApiError({ kind: "timeout", message: "timeout" }));
    render(<Harness />); await confirm(); await screen.findByText(/Göndərilmə təsdiqi gözlənilir/);
    vi.mocked(eventSubmissionsApi.get).mockResolvedValue(pending(readEventDraft(7).submissionId!));
    await userEvent.click(screen.getByRole("button", { name: "Statusu yoxla" }));
    expect(await screen.findByRole("heading", { name: "Tədbirin yoxlanılır" })).toBeTruthy(); expect(submit).toHaveBeenCalledTimes(1);
  });
  it("does not send if durable request storage fails", async () => {
    const submit = vi.spyOn(eventSubmissionsApi, "submit"); render(<Harness />);
    await screen.findByText("Təşkilatçı hesabı hazırdır");
    await userEvent.click(screen.getByRole("button", { name: "Yoxlamaya göndər" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await userEvent.click(screen.getByRole("button", { name: "Təsdiqlə və göndər" }));
    expect(submit).not.toHaveBeenCalled(); expect(screen.getByText(/Sorğunu bərpa etmək/)).toBeTruthy();
  });
  it("reopens real moderation status after a reload", async () => {
    const id = crypto.randomUUID(); saveEventDraft(7, { ...validDraft(), submissionId: id });
    vi.mocked(eventSubmissionsApi.get).mockResolvedValue(pending(id)); render(<Harness />);
    expect(await screen.findByRole("heading", { name: "Tədbirin yoxlanılır" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yoxlamaya göndər" })).toBeNull();
  });
  it("blocks unqualified accounts without claiming verification", async () => {
    vi.mocked(eventSubmissionsApi.eligibility).mockResolvedValue({ eligible: false, detail: "Təşkilatçı hesabı tələb olunur." });
    render(<Harness />); await screen.findByText("Təşkilatçı hesabı tələb olunur.");
    expect((screen.getByRole("button", { name: "Yoxlamaya göndər" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Təşkilatçı təsdiqlənib")).toBeNull();
  });
  it("revalidates Baku time and capacity", () => {
    const draft = validDraft(); draft.sales.tickets[0].quantity = "450";
    const issues = reviewIssues(draft, Date.parse("2099-10-28T16:01:00Z"));
    expect(issues.some(issue => issue.step === 2)).toBe(true); expect(issues.some(issue => issue.step === 3)).toBe(true);
    expect(reviewIssues(validDraft(), Date.parse("2099-10-28T15:59:00Z"))).toEqual([]);
  });
});
