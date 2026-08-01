import { describe, expect, it, vi } from "vitest";

import { ApiError, type OrderCreateRequest } from "@/lib/api";
import { orderFixture } from "@/test/fixtures";

import {
  OrderCheckoutAttempt,
  orderCreationError,
  validateQuantity,
} from "./checkout-attempt";

describe("quantity validation", () => {
  it.each([
    [0, 4, undefined, "ən azı 1"],
    [1.5, 4, undefined, "ən azı 1"],
    [5, 4, undefined, "maksimum 4"],
    [3, 4, 2, "yalnız 2"],
  ])("quantity=%s üçün düzgün validation verir", (quantity, max, available, fragment) => {
    expect(validateQuantity(quantity, max, available)).toContain(fragment);
  });

  it("valid quantity qəbul edir", () => {
    expect(validateQuantity(2, 4, 3)).toBeNull();
  });
});

describe("atomic order attempt", () => {
  it("double-submit zamanı yalnız bir order request yaradır", async () => {
    let resolveOrder!: (value: ReturnType<typeof orderFixture>) => void;
    const pending = new Promise<ReturnType<typeof orderFixture>>((resolve) => {
      resolveOrder = resolve;
    });
    const createOrder = vi.fn(() => pending);
    const attempt = new OrderCheckoutAttempt(createOrder);
    const items = [{ ticket_type_id: 12, quantity: 2 }];

    const first = attempt.submit(items);
    const second = attempt.submit(items);

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    resolveOrder(orderFixture());
    await first;
  });

  it("retry zamanı eyni Idempotency-Key qorunur", async () => {
    const createOrder = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ kind: "network", message: "offline" }))
      .mockResolvedValueOnce(orderFixture());
    const attempt = new OrderCheckoutAttempt(createOrder, "checkout-key");
    const items = [{ ticket_type_id: 12, quantity: 2 }];

    await expect(attempt.submit(items)).rejects.toBeInstanceOf(ApiError);
    await expect(attempt.submit(items)).resolves.toMatchObject({
      id: orderFixture().id,
      status: "pending",
    });

    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls.map((call) => call[1])).toEqual([
      "checkout-key",
      "checkout-key",
    ]);
  });

  it("request payload-a client price və total əlavə etmir", async () => {
    const createOrder = vi.fn().mockResolvedValue(orderFixture());
    const attempt = new OrderCheckoutAttempt(createOrder, "checkout-key");
    await attempt.submit([{ ticket_type_id: 12, quantity: 2 }]);

    expect(createOrder.mock.calls[0][0] satisfies OrderCreateRequest).toEqual({
      items: [{ ticket_type_id: 12, quantity: 2 }],
    });
  });

  it("hər yeni checkout attempt üçün yeni key yaradır", () => {
    const createOrder = vi.fn().mockResolvedValue(orderFixture());
    const first = new OrderCheckoutAttempt(createOrder);
    const second = new OrderCheckoutAttempt(createOrder);

    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("capacity 409-dan available quantity-ni çıxarır", () => {
    const result = orderCreationError(
      new ApiError({
        kind: "http",
        status: 409,
        message: "Yalnız 1 bilet qalıb.",
        payload: {
          detail: "Yalnız 1 bilet qalıb.",
          code: "INSUFFICIENT_CAPACITY",
          ticket_type_id: 12,
          available_quantity: 1,
        },
      }),
    );

    expect(result).toEqual({
      message: "Seçilən bilet sayı artıq mövcud deyil. Qalan say: 1.",
      ticketTypeId: 12,
      availableQuantity: 1,
    });
  });
});
