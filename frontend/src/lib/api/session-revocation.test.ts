import { describe, expect, it, vi } from "vitest";

import { getAccessToken, getRefreshToken, setSession } from "@/lib/auth/session";
import { authApi } from "./auth";
import { apiRequest } from "./client";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("server session revocation", () => {
  it("clears local credentials immediately and revokes using the refresh token", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const response = deferredResponse();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetchMock);
    const logout = authApi.logout();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toContain("/api/auth/logout/");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh: "refresh" });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has("Authorization")).toBe(false);
    response.resolve(new Response(null, { status: 204 }));
    await logout;
    await authApi.logout();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces failed revocation and permits retry after local tokens are removed", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(authApi.logout()).rejects.toMatchObject({ kind: "network" });
    expect(getRefreshToken()).toBeNull();
    await authApi.logout();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refresh: "refresh" });
  });

  it("late refresh success cannot restore a logged-out session", async () => {
    setSession({ access: "", refresh: "old-refresh" });
    const refresh = deferredResponse();
    const fetchMock = vi.fn().mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = apiRequest("/api/auth/me/", { auth: "required" });
    const rejected = expect(request).rejects.toMatchObject({ kind: "cancelled" });
    await authApi.logout();
    refresh.resolve(jsonResponse({ access: "late-access", refresh: "late-refresh" }));
    await rejected;
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("old refresh failure cannot clear a newer login", async () => {
    setSession({ access: "", refresh: "old-refresh" });
    const refresh = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(refresh.promise));
    const request = apiRequest("/api/auth/me/", { auth: "required" });
    const rejected = expect(request).rejects.toMatchObject({ status: 401 });
    setSession({ access: "new-login-access", refresh: "new-login-refresh" });
    refresh.resolve(jsonResponse({ detail: "Expired" }, 401));
    await rejected;
    expect(getAccessToken()).toBe("new-login-access");
    expect(getRefreshToken()).toBe("new-login-refresh");
  });

  it("concurrent requests share one refresh and persist the rotated token", async () => {
    setSession({ access: "", refresh: "old-refresh" });
    const refresh = deferredResponse();
    const fetchMock = vi.fn().mockReturnValueOnce(refresh.promise)
      .mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const first = apiRequest("/api/first/", { auth: "required" });
    const second = apiRequest("/api/second/", { auth: "required" });
    expect(fetchMock).toHaveBeenCalledOnce();
    refresh.resolve(jsonResponse({ access: "new-access", refresh: "new-refresh" }));
    await Promise.all([first, second]);
    expect(getRefreshToken()).toBe("new-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("late authenticated data is discarded after logout", async () => {
    setSession({ access: "access", refresh: "refresh" });
    const profile = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(profile.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    const request = apiRequest("/api/auth/me/", { auth: "required" });
    const rejected = expect(request).rejects.toMatchObject({ kind: "cancelled" });
    await authApi.logout();
    profile.resolve(jsonResponse({ email: "old-user@example.com" }));
    await rejected;
  });
});
