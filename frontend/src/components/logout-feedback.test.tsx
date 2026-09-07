import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { getRefreshToken, setSession } from "@/lib/auth/session";
import { AppShell } from "./app-shell";
import { AuthProvider, useAuth } from "./auth-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/more",
  useRouter: () => ({ push: vi.fn() }),
}));

function LogoutControl() {
  const { logout } = useAuth();
  return <button onClick={logout}>Test logout</button>;
}

it("shows failed logout and allows server revocation to be retried", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthProvider><AppShell><LogoutControl /></AppShell></AuthProvider>);
  // Set tokens after mounting so the test isolates logout from profile loading.
  setSession({ access: "access", refresh: "refresh" });
  await userEvent.click(screen.getByRole("button", { name: "Test logout" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(getRefreshToken()).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refresh: "refresh" });
});
