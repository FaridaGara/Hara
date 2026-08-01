import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError, ticketsApi } from "@/lib/api";
import { ticketFixture } from "@/test/fixtures";

import { TicketDetail } from "./ticket-detail";
import { TicketWallet } from "./ticket-wallet";

describe("ticket wallet", () => {
  it("owned ticket-ləri və check-in statusunu göstərir", async () => {
    render(
      <TicketWallet loadTickets={vi.fn().mockResolvedValue([ticketFixture])} />,
    );

    expect(await screen.findByText(ticketFixture.event_title)).toBeTruthy();
    expect(screen.getByText("Check-in edilməyib")).toBeTruthy();
  });

  it("upcoming/past seçimini faktiki API filter contract-ına ötürür", async () => {
    const loadTickets = vi.fn().mockResolvedValue([]);
    render(<TicketWallet eventStatus="past" loadTickets={loadTickets} />);

    await screen.findByText("Bilet yoxdur");
    expect(loadTickets).toHaveBeenCalledWith(
      { event_status: "past" },
      expect.any(AbortSignal),
    );
  });

  it("API unavailable olduqda error göstərir, ticket uydurmur", async () => {
    render(
      <TicketWallet
        loadTickets={vi.fn().mockRejectedValue(
          new ApiError({ kind: "network", message: "API əlçatan deyil" }),
        )}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain("API əlçatan deyil");
    expect(screen.queryByText(ticketFixture.event_title)).toBeNull();
  });

  it("session yoxdursa Ticket API request-dən əvvəl 401 verir", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ticketsApi.list()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ticket detail", () => {
  it("QR payload və minimal attendee sahələrini göstərir, əlavə PII göstərmir", async () => {
    const { container } = render(
      <TicketDetail
        ticketId={ticketFixture.id}
        loadTicket={vi.fn().mockResolvedValue(ticketFixture)}
      />,
    );

    expect(await screen.findByText(ticketFixture.qr_code)).toBeTruthy();
    expect(screen.getByText(ticketFixture.owner_display_name)).toBeTruthy();
    expect(container.textContent).not.toContain("aysel@example.com");
    expect(container.textContent).not.toContain("+994");
    expect(container.textContent).not.toContain("AZN");
  });

  it("404 üçün not-found state göstərir", async () => {
    render(
      <TicketDetail
        ticketId="missing"
        loadTicket={vi.fn().mockRejectedValue(
          new ApiError({ kind: "http", status: 404, message: "Tapılmadı" }),
        )}
      />,
    );

    await waitFor(() => expect(screen.getByText("Bilet tapılmadı")).toBeTruthy());
  });
});
