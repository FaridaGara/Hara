import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authApi } from "@/lib/api";

import { AuthProvider } from "./auth-provider";
import { ForgotPasswordForm } from "./forgot-password-form";
import { RegistrationForm } from "./registration-form";
import { ResetPasswordForm } from "./reset-password-form";
import { VerificationForm } from "./verification-form";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.searchParams,
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

beforeEach(() => {
  navigation.searchParams = new URLSearchParams();
});

describe("account flow", () => {
  it("qeydiyyatdan sonra email təsdiqinə keçir", async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, "register").mockResolvedValue({
      detail: "sent",
      email: "aysel@example.com",
    });
    render(
      <AuthProvider>
        <RegistrationForm />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText("Ad"), "Aysel");
    await user.type(screen.getByLabelText("Soyad"), "Məmmədova");
    await user.type(screen.getByLabelText("E-poçt"), "aysel@example.com");
    await user.type(screen.getByLabelText("+994 50 756 90 83"), "+994501112233");
    await user.type(screen.getByLabelText("Şifrə"), "SecurePass1");
    await user.type(screen.getByLabelText("Şifrəni təkrarla"), "SecurePass1");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Qeydiyyatdan keç" }));

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/verify?purpose=registration&email=aysel%40example.com",
      ),
    );
  });

  it("şifrə bərpa sorğusundan kod ekranına keçir", async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, "requestPasswordReset").mockResolvedValue({ detail: "sent" });
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("E-poçt ünvanınız"), "reset@example.com");
    await user.click(screen.getByRole("button", { name: "Kodu göndər" }));

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/verify?purpose=password_reset&email=reset%40example.com",
      ),
    );
  });

  it("qeydiyyat kodunu təsdiqləyib istifadəçini daxil edir", async () => {
    const user = userEvent.setup();
    navigation.searchParams = new URLSearchParams(
      "purpose=registration&email=aysel%40example.com",
    );
    vi.spyOn(authApi, "verifyEmail").mockResolvedValue({
      access: "access",
      refresh: "refresh",
      user: profile,
    });
    render(
      <AuthProvider>
        <VerificationForm />
      </AuthProvider>,
    );

    for (const [index, digit] of ["4", "8", "2", "1"].entries()) {
      await user.type(screen.getByLabelText(`Kodun ${index + 1}-ci rəqəmi`), digit);
    }
    await user.click(screen.getByRole("button", { name: "Təsdiq et" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  });

  it("yeni güclü şifrəni API-yə göndərir", async () => {
    const user = userEvent.setup();
    navigation.searchParams = new URLSearchParams("token=reset-ticket");
    vi.spyOn(authApi, "confirmPasswordReset").mockResolvedValue({ detail: "updated" });
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("Yeni şifrə"), "NewSecure2");
    await user.type(screen.getByLabelText("Şifrəni təkrarla"), "NewSecure2");
    await user.click(screen.getByRole("button", { name: "Şifrəni yenilə" }));

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/login?reset=success"),
    );
  });
});
