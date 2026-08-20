import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, authApi } from "@/lib/api";

import { AuthProvider } from "./auth-provider";
import { LoginForm } from "./login-form";
import { ProtectedRoute } from "./protected-route";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  pathname: "/tickets",
  searchParams: new URLSearchParams(),
}));

const profile = {
  id: 7,
  email: "aysel@example.com",
  display_name: "Aysel Məmmədova",
  first_name: "Aysel",
  last_name: "Məmmədova",
  phone_number: "+994501112233",
  avatar_url: "",
  birth_date: null,
  interests: [],
  account_type: "user" as const,
  role: "user" as const,
  providers: [],
  is_email_verified: true,
};

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
}));

beforeEach(() => {
  navigation.pathname = "/tickets";
  navigation.searchParams = new URLSearchParams();
});

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
}

async function fillLogin() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-poçt və ya telefon"), "aysel@example.com");
  await user.type(screen.getByLabelText("Şifrə"), "secret");
  await user.click(screen.getByRole("button", { name: "Daxil ol" }));
  return user;
}

describe("login", () => {
  it("uğurlu login-dən sonra təhlükəsiz local route-a qayıdır", async () => {
    navigation.searchParams = new URLSearchParams("next=%2Ftickets%3Fperiod%3Dupcoming");
    vi.spyOn(authApi, "login").mockResolvedValue({
      access: "access",
      refresh: "refresh",
      user: profile,
    });
    renderLogin();

    await fillLogin();

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/tickets?period=upcoming"),
    );
  });

  it("invalid credentials üçün aydın error göstərir", async () => {
    vi.spyOn(authApi, "login").mockRejectedValue(
      new ApiError({ kind: "http", status: 401, message: "No active account" }),
    );
    renderLogin();

    await fillLogin();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "E-poçt, telefon və ya şifrə yanlışdır",
    );
  });

  it("external next ilə open redirect yaratmır", async () => {
    navigation.searchParams = new URLSearchParams("next=https%3A%2F%2Fevil.example");
    vi.spyOn(authApi, "login").mockResolvedValue({
      access: "access",
      refresh: "refresh",
      user: profile,
    });
    renderLogin();

    await fillLogin();

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
    expect(navigation.replace).not.toHaveBeenCalledWith("https://evil.example");
  });
});

describe("protected route", () => {
  it("anonymous user-i login-ə local return route ilə yönləndirir", async () => {
    navigation.pathname = "/tickets";
    navigation.searchParams = new URLSearchParams("period=past");
    render(
      <AuthProvider>
        <ProtectedRoute>
          <p>Gizli məlumat</p>
        </ProtectedRoute>
      </AuthProvider>,
    );

    expect(screen.queryByText("Gizli məlumat")).toBeNull();
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/login?next=%2Ftickets%3Fperiod%3Dpast",
      ),
    );
  });
});
