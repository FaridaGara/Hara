import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { orderFixture, paymentFixture } from "@/test/fixtures";

import { CheckoutView, type CheckoutApis } from "./checkout-view";

function checkoutApis(
  order = orderFixture(),
  overrides: Partial<CheckoutApis> = {},
): CheckoutApis {
  return {
    loadOrder: vi.fn().mockResolvedValue(order),
    cancelOrder: vi.fn().mockResolvedValue(orderFixture({ status: "cancelled" })),
    initiatePayment: vi.fn().mockResolvedValue(paymentFixture()),
    completeSandbox: vi.fn().mockResolvedValue(paymentFixture({ status: "succeeded" })),
    ...overrides,
  };
}

describe("checkout backend states", () => {
  it("pending order və backend reservation countdown göstərir", async () => {
    render(<CheckoutView orderId={orderFixture().id} apis={checkoutApis()} />);

    expect(await screen.findByText("Ödəniş gözlənilir")).toBeTruthy();
    expect(screen.getByText(/Rezervasiyanın bitməsinə/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Payment başlat" })).toBeTruthy();
  });

  it("paid order üçün payment action göstərmir", async () => {
    const apis = checkoutApis(orderFixture({ status: "paid", expires_at: null }));
    render(<CheckoutView orderId={orderFixture().id} apis={apis} />);

    expect(await screen.findByText("Ödənilib")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Payment başlat" })).toBeNull();
    expect(screen.getByRole("link", { name: "Biletlərimi aç" })).toBeTruthy();
  });

  it("failed order state-ni ayrıca göstərir", async () => {
    render(
      <CheckoutView
        orderId={orderFixture().id}
        apis={checkoutApis(orderFixture({ status: "failed" }))}
      />,
    );

    expect(await screen.findByText("Ödəniş uğursuzdur")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Payment başlat" })).toBeNull();
  });

  it("vaxtı keçmiş pending order üçün payment-i deaktiv edir", async () => {
    render(
      <CheckoutView
        orderId={orderFixture().id}
        apis={checkoutApis(
          orderFixture({
            status: "pending",
            expires_at: new Date(Date.now() - 1_000).toISOString(),
          }),
        )}
      />,
    );

    expect(await screen.findByText("Rezervasiya bitib")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Payment başlat" })).toBeNull();
  });

  it("payment initiation double-submit zamanı yalnız bir request yaradır", async () => {
    let resolvePayment!: (value: ReturnType<typeof paymentFixture>) => void;
    const pending = new Promise<ReturnType<typeof paymentFixture>>((resolve) => {
      resolvePayment = resolve;
    });
    const initiatePayment = vi.fn(() => pending);
    const apis = checkoutApis(orderFixture(), { initiatePayment });
    render(<CheckoutView orderId={orderFixture().id} apis={apis} />);

    const button = await screen.findByRole("button", { name: "Payment başlat" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(initiatePayment).toHaveBeenCalledTimes(1);

    resolvePayment(paymentFixture());
    expect(await screen.findByText("Payment başladılıb")).toBeTruthy();
  });

  it("sandbox success-u yalnız backend response-dan sonra paid order kimi göstərir", async () => {
    const pendingOrder = orderFixture();
    const paidOrder = orderFixture({ status: "paid" });
    const loadOrder = vi
      .fn()
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce(paidOrder);
    const apis = checkoutApis(pendingOrder, {
      loadOrder,
      initiatePayment: vi.fn().mockResolvedValue(paymentFixture()),
      completeSandbox: vi
        .fn()
        .mockResolvedValue(paymentFixture({ status: "succeeded" })),
    });
    render(<CheckoutView orderId={pendingOrder.id} apis={apis} />);

    fireEvent.click(await screen.findByRole("button", { name: "Payment başlat" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Uğurlu payment simulyasiyası" }),
    );

    expect(await screen.findByText("Ödənilib")).toBeTruthy();
    expect(screen.getByText(/backend tərəfindən təsdiqlənib/)).toBeTruthy();
  });

  it("sandbox failed backend state-ni ayrıca göstərir", async () => {
    const pendingOrder = orderFixture();
    const failedOrder = orderFixture({ status: "failed" });
    const apis = checkoutApis(pendingOrder, {
      loadOrder: vi
        .fn()
        .mockResolvedValueOnce(pendingOrder)
        .mockResolvedValueOnce(failedOrder),
      initiatePayment: vi.fn().mockResolvedValue(paymentFixture()),
      completeSandbox: vi.fn().mockResolvedValue(paymentFixture({ status: "failed" })),
    });
    render(<CheckoutView orderId={pendingOrder.id} apis={apis} />);

    fireEvent.click(await screen.findByRole("button", { name: "Payment başlat" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Uğursuz payment simulyasiyası" }),
    );

    await waitFor(() => expect(screen.getByText("Ödəniş uğursuzdur")).toBeTruthy());
    expect(screen.getByText(/backend tərəfindən uğursuz/)).toBeTruthy();
  });
});
