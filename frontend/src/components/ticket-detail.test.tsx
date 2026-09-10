import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Ticket } from "@/lib/api/contracts";
import { TicketDetail } from "./ticket-detail";

const ticket: Ticket = {
  id: "owned-ticket", qr_code: "8a5e026b-d7c2-4345-9c19-e2522f40d03e", event_slug: "caz", event_title: "Caz gecəsi",
  event_start_at: "2026-10-28T16:00:00Z", event_end_at: "2026-10-28T18:00:00Z", event_location_name: "Bakı",
  ticket_type_name: "Standart", unit_price: "25.00", currency: "AZN", status: "valid", owner_display_name: "Aysel",
  is_checked_in: false, checked_in_at: null, created_at: "2026-09-10T10:00:00Z",
};

it("shows only the actual active entry code, and discards the previous ticket on navigation", async () => {
  let finish!: (ticket: Ticket) => void;
  const load = vi.fn().mockResolvedValueOnce(ticket).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<TicketDetail ticketId="one" loadTicket={load} />);
  await screen.findByText(ticket.qr_code);
  view.rerender(<TicketDetail ticketId="two" loadTicket={load} />);
  expect(screen.queryByText(ticket.qr_code)).toBeNull();
  await act(async () => finish({ ...ticket, id: "two", status: "cancelled", refund_status: "pending" }));
  await screen.findByText("Geri ödəniş gözlənilir");
  expect(screen.queryByText(ticket.qr_code)).toBeNull();
  expect(screen.getByText(/Məbləğ hələ qaytarılmayıb/)).toBeTruthy();
});

it.each([
  { name: "free", unit_price: "0.00", status: "cancelled", refund_status: null, message: /geri ödəniş tələb olunmur/ },
  { name: "missing refund request", unit_price: "25.00", status: "cancelled", refund_status: null, message: /məlumatı bildirişlərinizdən izləyin/ },
  { name: "refunded", unit_price: "25.00", status: "refunded", refund_status: "refunded", message: /Geri ödəniş tamamlanıb/ },
  { name: "used", unit_price: "25.00", status: "used", refund_status: null, message: /artıq istifadə edilib/ },
] as const)("does not expose an entry code or invent a pending refund for $name tickets", async ({ message, unit_price, status, refund_status }) => {
  render(<TicketDetail ticketId="one" loadTicket={async () => ({ ...ticket, unit_price, status, refund_status })} />);
  await screen.findByText(message);
  expect(screen.queryByText(ticket.qr_code)).toBeNull();
  expect(screen.queryByText("Geri ödəniş gözlənilir")).toBeNull();
});
