import { describe, expect, it, vi } from "vitest";

import { setSession } from "@/lib/auth/session";
import { orderFixture } from "@/test/fixtures";

import { ordersApi } from "./orders";
import { favoritesApi } from "./favorites";
import { paymentsApi } from "./payments";
import { ticketsApi } from "./tickets";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("domain request contracts", () => {
  it("favorite list, add və remove contract-ları JWT ilə düzgündür", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: "event-id" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await favoritesApi.list();
    await favoritesApi.add("event-id");
    await favoritesApi.remove("event-id");

    const [listUrl, listInit] = fetchMock.mock.calls[0];
    const [addUrl, addInit] = fetchMock.mock.calls[1];
    const [removeUrl, removeInit] = fetchMock.mock.calls[2];

    expect(listUrl).toContain("/api/favorites/");
    expect(new Headers(listInit?.headers).get("Authorization")).toBe("Bearer access");
    expect(addUrl).toContain("/api/favorites/");
    expect(addInit?.method).toBe("POST");
    expect(JSON.parse(addInit?.body as string)).toEqual({ event_id: "event-id" });
    expect(removeUrl).toContain("/api/favorites/event-id/");
    expect(removeInit?.method).toBe("DELETE");
  });

  it("order create contract və Idempotency-Key düzgündür", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(orderFixture()));
    vi.stubGlobal("fetch", fetchMock);

    await ordersApi.create(
      { items: [{ ticket_type_id: 12, quantity: 2 }] },
      "unique-attempt-key",
    );

    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(url).toContain("/api/orders/");
    expect(init?.method).toBe("POST");
    expect(headers.get("Idempotency-Key")).toBe("unique-attempt-key");
    expect(JSON.parse(init?.body as string)).toEqual({
      items: [{ ticket_type_id: 12, quantity: 2 }],
    });
  });

  it.each(["upcoming", "past"] as const)(
    "ticket %s filterini API query-yə ötürür",
    async (period) => {
      setSession({ access: "access", refresh: "refresh" });
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
      vi.stubGlobal("fetch", fetchMock);

      await ticketsApi.list({ event_status: period });

      expect(fetchMock.mock.calls[0][0]).toContain(
        `/api/tickets/?event_status=${period}`,
      );
    },
  );

  it("sandbox completion-u JWT POST body ilə çağırır, webhook-a toxunmur", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const paymentId = "30000000-0000-4000-8000-000000000001";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: paymentId,
        status: "succeeded",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await paymentsApi.completeSandbox(paymentId, "succeeded");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/api/payments/sandbox/${paymentId}/complete/`);
    expect(url).not.toContain("/webhook/");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ result: "succeeded" });
  });
});
