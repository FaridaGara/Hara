import { describe, expect, it, vi } from "vitest";

import { setSession } from "@/lib/auth/session";

import { ApiError, apiRequest } from "./client";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("central API client", () => {
  it("expired access token zamanı refresh edir və original request-i bir dəfə retry edir", async () => {
    setSession({ access: "expired-access", refresh: "valid-refresh" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "Token is invalid" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access: "new-access" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<{ ok: boolean }>("/api/orders/", { auth: "required" }))
      .resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("/api/auth/refresh/");
    const retriedHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(retriedHeaders.get("Authorization")).toBe("Bearer new-access");
  });

  it("refresh uğursuz olduqda session-u təmizləyir və 401 qaytarır", async () => {
    setSession({ access: "expired-access", refresh: "expired-refresh" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
        .mockResolvedValueOnce(jsonResponse({ detail: "refresh expired" }, 401)),
    );

    await expect(
      apiRequest("/api/tickets/", { auth: "required" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("204 response-u JSON parse etmədən qəbul edir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiRequest("/api/example/", { auth: "none" })).resolves.toBeUndefined();
  });

  it("409 error payload-ını təhlükəsiz və structured saxlayır", async () => {
    const payload = {
      detail: "Yalnız 1 bilet qalıb.",
      code: "INSUFFICIENT_CAPACITY",
      available_quantity: 1,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload, 409)));

    try {
      await apiRequest("/api/orders/", { method: "POST", auth: "none", body: {} });
      throw new Error("Expected ApiError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 409,
        message: payload.detail,
        payload,
      });
    }
  });

  it("network failure-i mock success-a çevirmir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(apiRequest("/api/events/", { auth: "none" })).rejects.toMatchObject({
      kind: "network",
      message: "API ilə əlaqə yaratmaq mümkün olmadı.",
    });
  });

  it("external AbortSignal request-i cancellation kimi dayandırır", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
    const controller = new AbortController();
    const request = apiRequest("/api/events/", {
      auth: "none",
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("timeout-u network error-dan ayırır", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );

    const request = apiRequest("/api/events/", {
      auth: "none",
      timeoutMs: 10,
    });
    const assertion = expect(request).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(10);

    await assertion;
  });
});
