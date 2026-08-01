import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type Order,
  type OrderCreateRequest,
} from "@/lib/api";
import { setSession } from "@/lib/auth/session";
import { eventFixture, orderFixture } from "@/test/fixtures";

import { AuthProvider } from "./auth-provider";
import { EventDetail } from "./event-detail";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

beforeEach(() => navigation.push.mockReset());

function renderDetail({
  event = eventFixture,
  createOrder = vi.fn<CreateOrder>().mockResolvedValue(orderFixture()),
}: {
  event?: typeof eventFixture;
  createOrder?: CreateOrder;
} = {}) {
  const result = render(
    <AuthProvider>
      <EventDetail
        slug={event.slug}
        loadEvent={vi.fn().mockResolvedValue(event)}
        createOrder={createOrder}
      />
    </AuthProvider>,
  );
  return { createOrder, ...result };
}

type CreateOrder = (
  payload: OrderCreateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) => Promise<Order>;

describe("event detail", () => {
  it("event və public ticket contract sahələrini təhlükəsiz göstərir", async () => {
    const event = {
      ...eventFixture,
      description: "<script>unsafe()</script>\nCanlı proqram",
    };
    const { container } = renderDetail({ event });

    expect(await screen.findByRole("heading", { name: event.title })).toBeTruthy();
    expect(screen.getByText(event.venue.address)).toBeTruthy();
    expect(screen.getByText(/<script>unsafe/)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByRole("heading", { name: "Standard" })).toBeTruthy();
    expect(screen.getByText("20.00 AZN")).toBeTruthy();
    expect(screen.getByText("8 bilet qalıb")).toBeTruthy();
  });

  it("authenticated seçimdən pending order yaradıb checkout-a yönləndirir", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const createOrder = vi.fn<CreateOrder>().mockResolvedValue(orderFixture());
    renderDetail({ createOrder });

    await userEvent.click(
      await screen.findByRole("button", { name: "Standard sayını artır" }),
    );
    expect(screen.getByLabelText("Standard sayı").textContent).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: "Biletləri rezerv et" }));

    await waitFor(() =>
      expect(createOrder).toHaveBeenCalledWith(
        { items: [{ ticket_type_id: 12, quantity: 1 }] },
        expect.any(String),
        undefined,
      ),
    );
    expect(navigation.push).toHaveBeenCalledWith(`/checkout/${orderFixture().id}`);
  });

  it("anonymous seçimi saxlayıb login continuation-a yönləndirir", async () => {
    const { unmount } = renderDetail();
    await userEvent.click(
      await screen.findByRole("button", { name: "Standard sayını artır" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Daxil ol və rezerv et" }));

    expect(navigation.push).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent(`/events/${eventFixture.slug}`)}`,
    );
    expect(window.sessionStorage.getItem(`hara.ticket-selection.${eventFixture.slug}`))
      .toBe('{"12":1}');

    unmount();
    setSession({ access: "access", refresh: "refresh" });
    renderDetail();
    expect((await screen.findByLabelText("Standard sayı")).textContent).toBe("1");
  });

  it("reservation zamanı dəyişən capacity-ni selector-a tətbiq edir", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const createOrder = vi.fn<CreateOrder>().mockRejectedValue(
      new ApiError({
        kind: "http",
        status: 409,
        message: "Yalnız 1 bilet qalıb",
        payload: {
          detail: "Yalnız 1 bilet qalıb",
          code: "INSUFFICIENT_CAPACITY",
          ticket_type_id: 12,
          requested_quantity: 2,
          available_quantity: 1,
        },
      }),
    );
    renderDetail({ createOrder });

    const increase = await screen.findByRole("button", {
      name: "Standard sayını artır",
    });
    await userEvent.click(increase);
    await userEvent.click(increase);
    await userEvent.click(screen.getByRole("button", { name: "Biletləri rezerv et" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Qalan say: 1");
    expect(screen.getByLabelText("Standard sayı").textContent).toBe("1");
  });

  it("satışda olmayan ticket type üçün quantity control göstərmir", async () => {
    const event = {
      ...eventFixture,
      ticket_types: [
        {
          ...eventFixture.ticket_types[0],
          available_quantity: 0,
          max_quantity: 0,
          sales_status: "SOLD_OUT" as const,
          is_available: false,
        },
      ],
    };
    renderDetail({ event });

    expect(await screen.findByText("Biletlər bitib")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Standard sayını artır" })).toBeNull();
  });

  it("404 üçün not-found state göstərir", async () => {
    render(
      <AuthProvider>
        <EventDetail
          slug="yoxdur"
          loadEvent={vi.fn().mockRejectedValue(
            new ApiError({ kind: "http", status: 404, message: "Tapılmadı" }),
          )}
        />
      </AuthProvider>,
    );
    expect(await screen.findByText("Tədbir tapılmadı")).toBeTruthy();
  });
});
