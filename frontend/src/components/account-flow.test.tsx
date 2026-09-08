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
    await user.type(screen.getByLabelText("Telefon nömrəsi"), "501112233");
    await user.type(screen.getByLabelText("Şifrə"), "SecurePass1");
    await user.type(screen.getByLabelText("Şifrəni təkrarla"), "SecurePass1");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Qeydiyyatdan keç" }));

    expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ phone_number: "+994501112233" }));
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

describe("email delivery errors", () => {
  const message = "E-poçt göndərmə xidməti hazırda əlçatan deyil. Bir qədər sonra yenidən cəhd edin.";
  function unavailable() {
    return new ApiError({ kind: "http", status: 503, message, payload: { code: "email_delivery_unavailable" } });
  }

  it("keeps registration fields and does not navigate when sending fails", async () => {
    vi.spyOn(authApi, "register").mockRejectedValue(unavailable());
    render(<AuthProvider><RegistrationForm /></AuthProvider>);
    for (const [label, value] of [
      ["Ad", "Aysel"], ["Soyad", "Test"], ["E-poçt", "test@example.com"],
      ["Telefon nömrəsi", "501112233"], ["Şifrə", "SecurePass1"], ["Şifrəni təkrarla", "SecurePass1"],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Qeydiyyatdan keç" })));
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect((screen.getByLabelText("E-poçt") as HTMLInputElement).value).toBe("test@example.com");
    expect((screen.getByLabelText("Şifrə") as HTMLInputElement).value).toBe("SecurePass1");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("shows reset delivery failure instead of opening the code screen", async () => {
    vi.spyOn(authApi, "requestPasswordReset").mockRejectedValue(unavailable());
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("E-poçt ünvanınız"), { target: { value: "test@example.com" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Kodu göndər" })));
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect((screen.getByLabelText("E-poçt ünvanınız") as HTMLInputElement).value).toBe("test@example.com");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("preserves the entered code and clears stale resend success on delivery failure", async () => {
    vi.useFakeTimers();
    navigation.searchParams = new URLSearchParams("purpose=registration&email=test%40example.com&retry_after=60");
    const resend = vi.spyOn(authApi, "resendVerification")
      .mockResolvedValueOnce({ detail: "Yeni kod göndərildi.", retry_after: 60 })
      .mockRejectedValueOnce(unavailable());
    render(<AuthProvider><VerificationForm /></AuthProvider>);
    await act(async () => vi.advanceTimersByTime(60000));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Kodu yenidən göndər" })));
    expect(screen.getByRole("status").textContent).toContain("Yeni kod göndərildi.");
    fireEvent.change(screen.getByLabelText("Kodun 1-ci rəqəmi"), { target: { value: "4" } });
    await act(async () => vi.advanceTimersByTime(60000));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Kodu yenidən göndər" })));
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect(screen.queryByText("Yeni kod göndərildi.")).toBeNull();
    expect((screen.getByLabelText("Kodun 1-ci rəqəmi") as HTMLInputElement).value).toBe("4");
    expect(resend).toHaveBeenCalledTimes(2);
    expect(navigation.replace).not.toHaveBeenCalled();
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
      ["Telefon nömrəsi", "501112233"], ["Şifrə", "SecurePass1"], ["Şifrəni təkrarla", "SecurePass1"],
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


it("does not submit an invalid phone even if form submission is forced", async () => {
  const register = vi.spyOn(authApi, "register");
  render(<AuthProvider><RegistrationForm /></AuthProvider>);
  const phone = screen.getByLabelText("Telefon nömrəsi") as HTMLInputElement;
  fireEvent.change(phone, { target: { value: "123456789" } });
  expect((screen.getByRole("button", { name: "Qeydiyyatdan keç" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fireEvent.submit(phone.form!));
  expect(register).not.toHaveBeenCalled();
});

describe("verification attempt limits", () => {
  function limited(seconds?: number) {
    return new ApiError({ kind: "http", status: 429, message: "Təsdiqləmə cəhdi limiti bitib.", payload: { retry_after: seconds } });
  }

  function enterCode() {
    for (const [index, digit] of ["4", "8", "2", "1"].entries()) {
      fireEvent.change(screen.getByLabelText(`Kodun ${index + 1}-ci rəqəmi`), { target: { value: digit } });
    }
  }

  it.each(["registration", "password_reset"])("%s yoxlama limiti bitəndən sonra eyni kodla davam edir", async (purpose) => {
    vi.useFakeTimers();
    navigation.searchParams = new URLSearchParams(`purpose=${purpose}&email=test%40example.com&retry_after=60`);
    const verify = purpose === "registration"
      ? vi.spyOn(authApi, "verifyEmail").mockRejectedValueOnce(limited(120))
        .mockResolvedValueOnce({ access: "access", refresh: "refresh", user: profile })
      : vi.spyOn(authApi, "verifyPasswordReset").mockRejectedValueOnce(limited(120))
        .mockResolvedValueOnce({ reset_token: "reset-ticket" });
    render(<AuthProvider><VerificationForm /></AuthProvider>);
    enterCode();
    const button = screen.getByRole("button", { name: "Təsdiq et" }) as HTMLButtonElement;
    const resend = screen.getByRole("button", { name: "Kodu yenidən göndər" }) as HTMLButtonElement;
    await act(async () => fireEvent.click(button));
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Kodu yenidən yoxlamaq üçün 02:00");
    expect(screen.getByRole("alert").textContent).toContain("limiti bitib");
    for (const [index, digit] of ["4", "8", "2", "1"].entries()) {
      expect((screen.getByLabelText(`Kodun ${index + 1}-ci rəqəmi`) as HTMLInputElement).value).toBe(digit);
    }
    await act(async () => fireEvent.submit(button.form!));
    expect(verify).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(60000));
    expect(resend.disabled).toBe(false);
    expect(button.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(59000));
    expect(button.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button.disabled).toBe(false);
    await act(async () => fireEvent.click(button));
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenLastCalledWith("test@example.com", "4821");
    expect(navigation.replace).toHaveBeenCalledWith(purpose === "registration" ? "/" : "/reset-password?token=reset-ticket");
  });

  it("yeni kod göndərilməsi yoxlama taymerini sıfırlamır", async () => {
    vi.useFakeTimers();
    navigation.searchParams = new URLSearchParams("purpose=password_reset&email=test%40example.com&retry_after=60");
    const verify = vi.spyOn(authApi, "verifyPasswordReset").mockRejectedValueOnce(limited(180));
    vi.spyOn(authApi, "resendVerification").mockResolvedValue({ detail: "Yeni kod göndərildi.", retry_after: 60 });
    render(<AuthProvider><VerificationForm /></AuthProvider>);
    enterCode();
    const button = screen.getByRole("button", { name: "Təsdiq et" }) as HTMLButtonElement;
    await act(async () => fireEvent.click(button));
    await act(async () => vi.advanceTimersByTime(60000));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Kodu yenidən göndər" })));
    enterCode();
    expect(screen.getByText(/Kodu yenidən yoxlamaq üçün 02:00/)).toBeTruthy();
    expect(button.disabled).toBe(true);
    await act(async () => fireEvent.submit(button.form!));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("səhv kod üçün adi 400 cavabı əlavə gözləmə yaratmır", async () => {
    navigation.searchParams = new URLSearchParams("purpose=password_reset&email=test%40example.com");
    const verify = vi.spyOn(authApi, "verifyPasswordReset").mockRejectedValue(new ApiError({
      kind: "http", status: 400, message: "Təsdiqləmə kodu yanlışdır.",
    }));
    render(<AuthProvider><VerificationForm /></AuthProvider>);
    enterCode();
    const button = screen.getByRole("button", { name: "Təsdiq et" }) as HTMLButtonElement;
    await act(async () => fireEvent.click(button));
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(/Kodu yenidən yoxlamaq üçün/)).toBeNull();
    await act(async () => fireEvent.click(button));
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it.each([120, undefined])("şifrə yeniləmə 429 zamanı məlumatları saxlayır və müddət bitəndə davam edir (%s)", async (seconds) => {
    vi.useFakeTimers();
    navigation.searchParams = new URLSearchParams("token=reset-ticket");
    const confirm = vi.spyOn(authApi, "confirmPasswordReset").mockRejectedValueOnce(limited(seconds))
      .mockResolvedValueOnce({ detail: "updated" });
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText("Yeni şifrə"), { target: { value: "NewSecure2" } });
    fireEvent.change(screen.getByLabelText("Şifrəni təkrarla"), { target: { value: "NewSecure2" } });
    const button = screen.getByRole("button", { name: "Şifrəni yenilə" }) as HTMLButtonElement;
    await act(async () => fireEvent.click(button));
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(`${seconds ?? 60} saniyə`);
    expect((screen.getByLabelText("Yeni şifrə") as HTMLInputElement).value).toBe("NewSecure2");
    await act(async () => fireEvent.submit(button.form!));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(((seconds ?? 60) - 1) * 1000));
    expect(button.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button.disabled).toBe(false);
    await act(async () => fireEvent.click(button));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenLastCalledWith("reset-ticket", "NewSecure2", "NewSecure2");
    expect(navigation.replace).toHaveBeenCalledWith("/login?reset=success");
  });
});
