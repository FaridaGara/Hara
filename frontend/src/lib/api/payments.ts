import { apiRequest } from "./client";
import type { Payment } from "./contracts";

export const paymentsApi = {
  initiate(orderId: string, signal?: AbortSignal) {
    return apiRequest<Payment>(
      `/api/orders/${encodeURIComponent(orderId)}/payments/`,
      {
        method: "POST",
        auth: "required",
        signal,
      },
    );
  },

  completeSandbox(
    paymentId: string,
    result: "succeeded" | "failed",
    signal?: AbortSignal,
  ) {
    return apiRequest<Payment>(
      `/api/payments/sandbox/${encodeURIComponent(paymentId)}/complete/`,
      {
        method: "POST",
        auth: "required",
        body: { result },
        signal,
      },
    );
  },
};
