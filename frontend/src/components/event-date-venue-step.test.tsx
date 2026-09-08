import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventDraft } from "@/hooks/use-event-draft";
import { venuesApi } from "@/lib/api";
import { EMPTY_EVENT_DRAFT, readEventDraft, saveEventDraft } from "@/lib/event-draft";
import { changeStart, emptySchedule } from "@/lib/event-schedule";
import { EventDateVenueStep } from "./event-date-venue-step";

// A deliberate map interaction confirms coordinates; loading the map alone cannot.
vi.mock("next/dynamic", () => ({ default: () => function MapDouble({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  return <button type="button" onClick={() => onSelect(40.4, 49.8)}>Test: select entrance</button>;
} }));

const venue = { id: "venue-1", name: "Caz məkanı", city: "Bakı", address: "Test ünvanı", latitude: 40.4, longitude: 49.8, plan_id: "plan-1", capacity: 120 };
function Harness({ onNext }: { onNext?: () => void }) {
  const state = useEventDraft(7);
  return <EventDateVenueStep {...state} onBack={vi.fn()} onNext={onNext} />;
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
beforeEach(() => {
  window.localStorage.clear();
  saveEventDraft(7, { ...EMPTY_EVENT_DRAFT, title: "Caz gecəsi", category: "musiqi", description: "Canlı musiqi", duration: "120", lastStep: 2,
    schedule: changeStart(emptySchedule(), "2099-10-28", "20:00", "120") });
  vi.spyOn(venuesApi, "search").mockResolvedValue([venue]);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});

describe("date and venue states", () => {
  it("searches, selects a published venue plan and preserves it on reopening", async () => {
    const onNext = vi.fn();
    const view = render(<Harness onNext={onNext} />);
    expect((screen.getByRole("button", { name: "Növbəti addım" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Məkan seç" }));
    change("Məkan axtar", "Caz");
    await userEvent.click(await screen.findByRole("button", { name: "Caz məkanı məkanını seç" }));
    expect(venuesApi.search).toHaveBeenLastCalledWith("Caz", expect.any(AbortSignal));
    expect(screen.getByText("Hazır məkan planı mövcuddur")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Növbəti addım" }));
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ schedule: expect.objectContaining({ venue: expect.objectContaining({ id: "venue-1", plan_id: "plan-1" }) }) }));
    view.unmount(); render(<Harness />);
    expect(screen.getByText("Caz məkanı")).toBeTruthy();
    expect((screen.getByLabelText("Başlama saatı") as HTMLInputElement).value).toBe("20:00");
  });

  it("keeps a manual end, shows its error on blur and offers a valid correction", async () => {
    render(<Harness />);
    change("Başlama saatı", "21:00");
    expect((screen.getByLabelText("Bitmə saatı") as HTMLInputElement).value).toBe("23:00");
    change("Bitmə saatı", "23:30");
    change("Başlama saatı", "22:00");
    expect((screen.getByLabelText("Bitmə saatı") as HTMLInputElement).value).toBe("23:30");
    change("Bitmə saatı", "21:00");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Bitmə saatı"));
    expect(screen.getByRole("alert").textContent).toContain("Bitmə vaxtı başlamadan sonra olmalıdır.");
    await userEvent.click(screen.getByRole("button", { name: /23:30-a düzəlt/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(readEventDraft(7).schedule.endEdited).toBe(false);
    expect(readEventDraft(7).duration).toBe("90");
  });

  it("requires a map interaction for a manual venue and keeps unfinished input after Back", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Məkan seç" }));
    await userEvent.click(screen.getByRole("button", { name: "Ünvanı əl ilə əlavə et" }));
    change("Məkanın adı", "Yeni salon"); change("Ünvan", "Yeni ünvan"); change("Giriş qeydi (istəyə bağlı)", "Arxa giriş");
    expect((screen.getByRole("button", { name: "Təsdiqlə və əlavə et" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Əvvəlki mərhələyə qayıt" }));
    await userEvent.click(screen.getByRole("button", { name: "Ünvanı əl ilə əlavə et" }));
    expect((screen.getByLabelText("Məkanın adı") as HTMLInputElement).value).toBe("Yeni salon");
    await userEvent.click(screen.getByRole("button", { name: "Test: select entrance" }));
    await userEvent.click(screen.getByRole("button", { name: "Təsdiqlə və əlavə et" }));
    expect(screen.getByText("Giriş: Arxa giriş")).toBeTruthy();
    expect(readEventDraft(7).schedule).toMatchObject({ startTime: "20:00", endTime: "22:00", venue: { source: "manual", id: null, latitude: 40.4, longitude: 49.8 } });
  });

  it("cancels calendar edits without changing the draft and confirms midnight rollover", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Başlama tarixi" }));
    change("Saat · Bakı (UTC+4)", "23:30");
    expect(screen.getByText(/Bitmə vaxtı:.*29.*01:30/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Tarix seçimini bağla" }));
    expect((screen.getByLabelText("Başlama saatı") as HTMLInputElement).value).toBe("20:00");
    await userEvent.click(screen.getByRole("button", { name: "Başlama tarixi" }));
    change("Saat · Bakı (UTC+4)", "23:30");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Təsdiqlə" }));
    expect(readEventDraft(7).schedule).toMatchObject({ startTime: "23:30", endDate: "2099-10-29", endTime: "01:30" });
    expect(document.body.style.overflow).toBe("");
  });

  it("allows retrying search and storage failures without losing entered data", async () => {
    vi.mocked(venuesApi.search).mockRejectedValueOnce(new Error("offline"));
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Məkan seç" }));
    await userEvent.click(await screen.findByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByRole("button", { name: "Caz məkanı məkanını seç" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Əvvəlki mərhələyə qayıt" }));
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    change("Başlama saatı", "21:00");
    fireEvent.blur(screen.getByLabelText("Başlama saatı"));
    expect(screen.getByRole("alert").textContent).toContain("saxlanılmadı");
    storage.mockRestore();
    await userEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(readEventDraft(7).schedule.startTime).toBe("21:00");
  });

  it("migrates a first-step draft without inventing dates or venues", () => {
    window.localStorage.clear();
    window.localStorage.setItem("hara.event-draft.v1:7", JSON.stringify({ title: "Əvvəlki tədbir", category: "musiqi", description: "Təsvir", duration: "120" }));
    expect(readEventDraft(7)).toMatchObject({ title: "Əvvəlki tədbir", schedule: emptySchedule(), lastStep: 1 });
  });
});
