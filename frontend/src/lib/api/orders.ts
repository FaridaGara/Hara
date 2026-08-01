import { apiRequest } from "./client";
import type { Order, OrderCreateRequest } from "./contracts";

export const ordersApi = {
  list(signal?: AbortSignal) {
    return apiRequest<Order[]>("/api/orders/", {
      auth: "required",
      signal,
    });
  },

  detail(orderId: string, signal?: AbortSignal) {
    return apiRequest<Order>(`/api/orders/${encodeURIComponent(orderId)}/`, {
      auth: "required",
      signal,
    });
  },

  create(payload: OrderCreateRequest, idempotencyKey: string, signal?: AbortSignal) {
    return apiRequest<Order>("/api/orders/", {
      method: "POST",
      auth: "required",
      headers: { "Idempotency-Key": idempotencyKey },
      body: payload,
      signal,
    });
  },

  cancel(orderId: string, signal?: AbortSignal) {
    return apiRequest<Order>(
      `/api/orders/${encodeURIComponent(orderId)}/cancel/`,
      {
        method: "POST",
        auth: "required",
        signal,
      },
    );
  },
};
