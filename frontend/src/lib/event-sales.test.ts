import { describe, expect, it } from "vitest";

import { EMPTY_EVENT_DRAFT, emptySales } from "./event-draft";
import { commissionBreakdown, salesCapacity, ticketError } from "./event-sales";

function draftWithCapacity(capacity: number) {
  return {
    ...EMPTY_EVENT_DRAFT,
    schedule: { ...EMPTY_EVENT_DRAFT.schedule, venue: {
      id: "venue-1", source: "catalog" as const, name: "Zal", address: "Bakı",
      city: "Bakı", latitude: 40.4, longitude: 49.8, entry_note: "", plan_id: null, capacity,
    } },
    sales: emptySales(),
  };
}

describe("event sales rules", () => {
  it("calculates the documented 8% organizer commission preview", () => {
    expect(commissionBreakdown("25")).toEqual({ commission: 2, remainder: 23 });
    expect(commissionBreakdown("40")).toEqual({ commission: 3.2, remainder: 36.8 });
  });

  it("uses the venue capacity as the source of truth", () => {
    const draft = draftWithCapacity(420);
    draft.sales.capacity = "999";
    expect(salesCapacity(draft)).toBe(420);
  });

  it("rejects a ticket quantity that pushes the total over capacity", () => {
    const draft = draftWithCapacity(420);
    draft.sales.tickets = [
      { id: "standard", name: "Standart", paymentType: "paid", price: "25", quantity: "300", includes: "", lastValidQuantity: "300" },
      { id: "vip", name: "VIP", paymentType: "paid", price: "40", quantity: "150", includes: "", lastValidQuantity: "50" },
    ];
    expect(ticketError(draft.sales.tickets[1], draft)).toBe("150 bilet üçün yer yoxdur. Maksimum: 120 bilet.");
  });
});
