"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { ApiError, authApi } from "@/lib/api";

import {
  AuthButton,
  AuthField,
  AuthFrame,
  AuthMessage,
  PasswordRequirements,
} from "./auth-ui";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordIsStrong =
    password.length >= 8 && /[A-ZƏÖÜİÇŞĞ]/.test(password) && /\d/.test(password);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !token) return;
    if (password !== passwordConfirm) {
      setError("Şifrələr eyni deyil.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authApi.confirmPasswordReset(token, password, passwordConfirm);
      router.replace("/login?reset=success");
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Şifrə yenilənərkən xəta baş verdi.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame title="Yeni şifrə" subtitle="Şifrənizi yeniləyin" backHref="/forgot-password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-6">
        <div className="space-y-2">
          <h2 className="text-[20px] leading-[25px] font-semibold tracking-[-0.45px]">
            Yeni şifrə təyin edin
          </h2>
          <p className="text-[15px] leading-5 tracking-[-0.23px] text-[var(--hara-auth-secondary)]">
            Şifrəniz əvvəlki şifrələrdən fərqli olmalıdır.
          </p>
        </div>
        <AuthField
          label="Yeni şifrə"
          icon="eye"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
        />
        <AuthField
          label="Şifrəni təkrarla"
          icon="eye"
          type="password"
          name="password_confirm"
          autoComplete="new-password"
          required
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          disabled={submitting}
        />
        <PasswordRequirements password={password} />
        {!token ? <AuthMessage>Bərpa keçidi tapılmadı. Yenidən kod tələb edin.</AuthMessage> : null}
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        <AuthButton
          type="submit"
          disabled={
            submitting ||
            !token ||
            !passwordIsStrong ||
            password !== passwordConfirm
          }
        >
          {submitting ? "Yenilənir…" : "Şifrəni yenilə"}
        </AuthButton>
      </form>
    </AuthFrame>
  );
}
