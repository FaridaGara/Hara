"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardEvent, FormEvent, KeyboardEvent, useRef, useState } from "react";

import { retryAfterSeconds, useRetryCountdown } from "@/hooks/use-retry-countdown";

import { ApiError, authApi } from "@/lib/api";
import type { VerificationPurpose } from "@/lib/api";

import { useAuth } from "./auth-provider";
import { AuthButton, AuthFrame, AuthMessage } from "./auth-ui";

const CODE_LENGTH = 4;
const RESEND_SECONDS = 60;

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function VerificationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyEmail } = useAuth();
  const email = searchParams.get("email")?.trim() || "";
  const purpose: VerificationPurpose =
    searchParams.get("purpose") === "password_reset"
      ? "password_reset"
      : "registration";
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const verificationRetry = useRetryCountdown();
  const { remaining, start: startRetry } = useRetryCountdown(
    retryAfterSeconds({ retry_after: Number(searchParams.get("retry_after")) }, RESEND_SECONDS),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const setCode = (value: string) => {
    const nextDigits = value.replace(/\D/g, "").slice(0, CODE_LENGTH).split("");
    setDigits(Array.from({ length: CODE_LENGTH }, (_, index) => nextDigits[index] || ""));
    inputsRef.current[Math.min(nextDigits.length, CODE_LENGTH - 1)]?.focus();
  };

  const handleDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((item, itemIndex) => itemIndex === index ? digit : item));
    if (digit && index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    setCode(event.clipboardData.getData("text"));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = digits.join("");
    if (!email || code.length !== CODE_LENGTH || submitting || verificationRetry.remaining > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      if (purpose === "registration") {
        await verifyEmail(email, code);
        router.replace("/");
      } else {
        const response = await authApi.verifyPasswordReset(email, code);
        router.replace(
          `/reset-password?token=${encodeURIComponent(response.reset_token)}`,
        );
      }
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 429) {
        verificationRetry.start(retryAfterSeconds(caughtError.payload));
      }
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Kod təsdiqlənərkən xəta baş verdi.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!email || remaining > 0 || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authApi.resendVerification(email, purpose);
      startRetry(retryAfterSeconds(response));
      setNotice(response.detail);
      setDigits(["", "", "", ""]);
      inputsRef.current[0]?.focus();
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 429) {
        startRetry(retryAfterSeconds(caughtError.payload));
      }
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Yeni kod göndərilə bilmədi.",
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthFrame
      title="Təsdiqləmə"
      subtitle="Kodu daxil edin"
      backHref={purpose === "registration" ? "/register" : "/forgot-password"}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-6 text-center">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-[13px] font-semibold">
            <Image src="/figma/auth/shield-tick.svg" alt="" width={24} height={24} className="hara-auth-icon" />
            Təsdiqləmə kodu
          </div>
          <p className="text-[12px] leading-4 text-[var(--hara-auth-secondary)]">
            {purpose === "password_reset"
              ? `Uyğun hesab varsa, kod ${email || "e-poçt ünvanınıza"} ünvanına göndərildi.`
              : `Kodu ${email || "e-poçt ünvanınıza"} ünvanına göndərdik`}
          </p>
        </div>

        <div className="flex justify-center gap-3 py-2">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => { inputsRef.current[index] = element; }}
              aria-label={`Kodun ${index + 1}-ci rəqəmi`}
              inputMode="numeric"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              maxLength={1}
              value={digit}
              onChange={(event) => handleDigit(index, event.target.value)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onPaste={handlePaste}
              className="h-14 w-14 rounded-2xl border border-black/10 bg-[var(--hara-auth-field)] text-center text-[17px] outline-none focus:border-[#565dd8] dark:border-white/10"
            />
          ))}
        </div>

        <div className="space-y-1 text-[13px] leading-[18px]">
          <p className="text-[var(--hara-auth-muted)]">
            {remaining > 0
              ? `Yenidən göndərmək üçün ${formatCountdown(remaining)} gözləyin`
              : "Yeni kod göndərə bilərsiniz"}
          </p>
          <button
            type="button"
            onClick={resend}
            disabled={!email || remaining > 0 || resending}
            className="font-semibold text-[#4e55c5] disabled:opacity-50"
          >
            {resending ? "Göndərilir…" : "Kodu yenidən göndər"}
          </button>
        </div>
        {!email ? <AuthMessage>E-poçt ünvanı tapılmadı. Əvvəlki mərhələyə qayıdın.</AuthMessage> : null}
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        {notice ? <p role="status" className="text-sm text-[var(--hara-auth-secondary)]">{notice}</p> : null}
        {verificationRetry.remaining > 0 ? (
          <p role="status" className="text-sm text-[var(--hara-auth-secondary)]">
            Kodu yenidən yoxlamaq üçün {formatCountdown(verificationRetry.remaining)} gözləyin.
          </p>
        ) : null}
        <AuthButton
          type="submit"
          disabled={submitting || verificationRetry.remaining > 0 || !email || digits.some((digit) => !digit)}
        >
          {submitting ? "Təsdiqlənir…" : "Təsdiq et"}
        </AuthButton>
      </form>
    </AuthFrame>
  );
}
