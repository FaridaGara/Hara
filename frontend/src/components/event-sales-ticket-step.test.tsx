import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { EMPTY_EVENT_DRAFT, emptySales, type EventDraft } from "@/lib/event-draft";

import { EventSalesTicketStep } from "./event-sales-ticket-step";

function completeDraft(): EventDraft {
  return {
    ...EMPTY_EVENT_DRAFT,
    title: "Bakı Caz Gecəsi 2026", category: "musiqi", description: "Canlı musiqi", lastStep: 3,
    schedule: { ...EMPTY_EVENT_DRAFT.schedule, startDate: "2099-10-28", startTime: "20:00", endDate: "2099-10-28", endTime: "22:00", venue: {
      id: "venue-1", source: "catalog", name: "Beynəlxalq Muğam Mərkəzi", address: "Bakı",
      city: "Bakı", latitude: 40.4, longitude: 49.8, entry_note: "", plan_id: "plan-1", capacity: 420,
    } },
    sales: emptySales(),
  };
}

function Harness({ onNext }: { onNext?: (draft: EventDraft) => void }) {
  const [draft, setDraft] = useState(completeDraft);
  return <EventSalesTicketStep draft={draft} replaceDraft={setDraft} save={() => true} notice={null} storageError={false} onBack={vi.fn()} onNext={onNext} />;
}

describe("event sales and tickets step", () => {
  it("edits paid and free tickets without losing shared fields", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Standart biletini redaktə et" }));
    await user.type(screen.getByLabelText("Qiymət"), "25");
    await user.type(screen.getByLabelText("Bilet sayı"), "300");
    expect(screen.getByText("HARA (8%): 2 AZN · Qalan: 23 AZN")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pulsuz" }));
    expect((screen.getByLabelText("Biletin adı") as HTMLInputElement).value).toBe("Standart");
    expect((screen.getByLabelText("Bilet sayı") as HTMLInputElement).value).toBe("300");
    await user.click(screen.getByRole("button", { name: "Bileti saxla" }));
    expect(screen.getByText("300 pulsuz qeydiyyat")).toBeTruthy();
  });

  it("shows capacity overflow and restores the last valid quantity", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Standart biletini redaktə et" }));
    await user.type(screen.getByLabelText("Qiymət"), "25");
    await user.type(screen.getByLabelText("Bilet sayı"), "300");
    await user.click(screen.getByRole("button", { name: "Bileti saxla" }));
    await user.click(screen.getByRole("button", { name: "Bilet növü əlavə et" }));
    await user.type(screen.getByLabelText("Biletin adı"), "VIP");
    await user.type(screen.getByLabelText("Qiymət"), "40");
    await user.type(screen.getByLabelText("Bilet sayı"), "50");
    await user.click(screen.getByRole("button", { name: "Bileti saxla" }));
    await user.click(screen.getByRole("button", { name: "VIP biletini redaktə et" }));
    await user.clear(screen.getByLabelText("Bilet sayı"));
    await user.type(screen.getByLabelText("Bilet sayı"), "150");
    expect(screen.getByRole("alert").textContent).toContain("Maksimum: 120 bilet");
    await user.click(screen.getByRole("button", { name: "Əvvəlki 50 biletə qaytar" }));
    expect((screen.getByLabelText("Bilet sayı") as HTMLInputElement).value).toBe("50");
  });

  it("keeps the next action blocked until ticket and paid-sale rules are complete", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(<Harness onNext={onNext} />);
    expect((screen.getByRole("button", { name: "Növbəti addım" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Standart biletini redaktə et" }));
    await user.type(screen.getByLabelText("Qiymət"), "25");
    await user.type(screen.getByLabelText("Bilet sayı"), "300");
    await user.click(screen.getByRole("button", { name: "Bileti saxla" }));
    await user.click(screen.getByRole("button", { name: "Satış vaxtı və qaydalar" }));
    await user.selectOptions(screen.getByLabelText("Geri qaytarılma qaydası"), "until_24h");
    await user.click(screen.getByRole("button", { name: "Qaydaları saxla" }));
    const next = screen.getByRole("button", { name: "Növbəti addım" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await user.click(next);
    expect(onNext).toHaveBeenCalledOnce();
  });
});
