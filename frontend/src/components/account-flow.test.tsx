import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, authApi } from "@/lib/api";

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
    await user.type(screen.getByLabelText("+994 xx xxx xx xx"), "+994501112233");
    await user.type(screen.getByLabelText("Şifrə"), "SecurePass1");
    await user.type(screen.getByLabelText("Şifrəni təkrarla"), "SecurePass1");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Qeydiyyatdan keç" }));

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/verify?purpose=registration&email=aysel%40example.com&retry_after=60",
      ),
    );
  });

  it("şifrə bərpa sorğusundan kod ekranına keçir", async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, "requestPasswordReset").mockResolvedValue({ detail: "sent", retry_after: 90 });
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("E-poçt ünvanınız"), "reset@example.com");
    await user.click(screen.getByRole("button", { name: "Kodu göndər" }));

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/verify?purpose=password_reset&email=reset%40example.com&retry_after=90",
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

describe("code send limits", () => {
  function rateLimited(seconds: number) {
    return new ApiError({ kind: "http", status: 429, message: "Bir qədər gözləyin.", payload: { retry_after: seconds } });
  }

  it("reset 429 gözləmə müddəti bitənə qədər təkrar sorğunu bloklayır", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(authApi, "requestPasswordReset").mockRejectedValue(rateLimited(120));
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("E-poçt ünvanınız"), { target: { value: "test@example.com" } });
    const button = screen.getByRole("button", { name: "Kodu göndər" }) as HTMLButtonElement;
    await act(async () => fireEvent.click(button));
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("120 saniyə");
    fireEvent.click(button);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(119000));
    expect(button.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button.disabled).toBe(false);
  });

  it("qeydiyyat 429 zamanı formu və bildirişi saxlayır", async () => {
    vi.useFakeTimers();
    const register = vi.spyOn(authApi, "register").mockRejectedValue(rateLimited(600));
    render(<AuthProvider><RegistrationForm /></AuthProvider>);
    for (const [label, value] of [
      ["Ad", "Aysel"], ["Soyad", "Test"], ["E-poçt", "test@example.com"],
      ["+994 xx xxx xx xx", "+994501112233"], ["Şifrə", "SecurePass1"], ["Şifrəni təkrarla", "SecurePass1"],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: "Qeydiyyatdan keç" }) as HTMLButtonElement;
    await act(async () => fireEvent.click(button));
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("600 saniyə");
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("resend uğuru və 429 üçün serverin verdiyi müddəti istifadə edir", async () => {
    vi.useFakeTimers();
    navigation.searchParams = new URLSearchParams("purpose=password_reset&email=test%40example.com&retry_after=90");
    const resend = vi.spyOn(authApi, "resendVerification")
      .mockResolvedValueOnce({ detail: "Uyğun hesab varsa, kod göndərildi.", retry_after: 120 })
      .mockRejectedValueOnce(rateLimited(3600));
    render(<AuthProvider><VerificationForm /></AuthProvider>);
    const button = screen.getByRole("button", { name: "Kodu yenidən göndər" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Yenidən göndərmək üçün 01:30/)).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(90000));
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole("status").textContent).toContain("Uyğun hesab varsa");
    expect(screen.getByText(/Yenidən göndərmək üçün 02:00/)).toBeTruthy();
    expect(button.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(120000));
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole("alert").textContent).toContain("gözləyin");
    expect(screen.getByText(/Yenidən göndərmək üçün 60:00/)).toBeTruthy();
    expect(button.disabled).toBe(true);
    expect(resend).toHaveBeenCalledTimes(2);
  });
});
