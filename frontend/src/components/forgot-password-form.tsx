"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { ApiError, authApi } from "@/lib/api";

import { AuthButton, AuthField, AuthFrame, AuthMessage } from "./auth-ui";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.requestPasswordReset(email.trim());
      router.push(
        `/verify?purpose=password_reset&email=${encodeURIComponent(email.trim())}`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Bərpa kodu göndərilə bilmədi.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame title="Şifrə bərpası" subtitle="Şifrəni sıfırlayın" backHref="/login">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Image src="/figma/auth/key.svg" alt="" width={24} height={24} className="hara-auth-icon" />
            <h2 className="text-[20px] leading-[25px] font-semibold tracking-[-0.45px]">
              Şifrəni unutmusunuz?
            </h2>
          </div>
          <p className="text-[15px] leading-5 tracking-[-0.23px] text-[var(--hara-auth-secondary)]">
            E-poçt ünvanınızı daxil edin.<br />
            Şifrənizi sıfırlamaq üçün sizə təsdiqləmə kodu göndərəcəyik.
          </p>
        </div>
        <AuthField
          label="E-poçt ünvanınız"
          icon="lock"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
        />
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        <AuthButton type="submit" disabled={submitting || !email.trim()}>
          {submitting ? "Göndərilir…" : "Kodu göndər"}
        </AuthButton>
      </form>
    </AuthFrame>
  );
}
