"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { retryAfterSeconds, useRetryCountdown } from "@/hooks/use-retry-countdown";

import { ApiError } from "@/lib/api";
import { authHref, safeLocalRedirect } from "@/lib/routes";

import { useAuth } from "./auth-provider";
import {
  AuthButton,
  AuthField,
  AuthFrame,
  AuthMessage,
} from "./auth-ui";
import { SocialLoginButtons } from "./social-login-buttons";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRetryCountdown();
  const nextRoute = safeLocalRedirect(searchParams.get("next"));

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(nextRoute);
    }
  }, [nextRoute, router, status]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || retry.remaining > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 429) retry.start(retryAfterSeconds(caughtError.payload));
      if (
        caughtError instanceof ApiError &&
        (caughtError.status === 400 || caughtError.status === 401)
      ) {
        setError("E-poçt, telefon və ya şifrə yanlışdır.");
      } else {
        setError(
          caughtError instanceof ApiError
            ? caughtError.message
            : "Giriş zamanı gözlənilməz xəta baş verdi.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="Daxil ol"
      subtitle="Hesabınıza daxil olun"
      footer={
        <p className="text-[var(--hara-auth-secondary)]">
          Hesabın yoxdur?{" "}
          <Link className="font-semibold text-[#4e55c5]" href={authHref("/register", searchParams.get("next"))}>
            Qeydiyyatdan keç
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-4 p-6">
        {searchParams.get("reset") === "success" ? (
          <AuthMessage tone="success">Şifrəniz yeniləndi. Yeni şifrə ilə daxil olun.</AuthMessage>
        ) : null}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AuthField
            label="E-poçt və ya telefon"
            icon="lock"
            name="identifier"
            autoComplete="username"
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            disabled={submitting}
          />
          <AuthField
            label="Şifrə"
            icon="eye"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-[13px] leading-[18px] font-semibold tracking-[-0.08px] text-[#4e55c5]"
            >
              Şifrəni unutdun?
            </Link>
          </div>
          {error ? <AuthMessage title={retry.remaining > 0 ? "Bir qədər gözləyin" : "Daxil olmaq mümkün olmadı"}>{error}</AuthMessage> : null}
          <AuthButton
            type="submit"
            disabled={submitting || retry.remaining > 0 || !identifier.trim() || !password}
          >
            {submitting ? "Daxil olunur…" : retry.remaining > 0 ? `Yenidən cəhd • ${retry.remaining} san` : error ? "Yenidən cəhd et" : "Daxil ol"}
          </AuthButton>
        </form>

        <div className="flex items-center gap-3 py-2 text-[13px] text-[var(--hara-auth-muted)]">
          <span className="h-px flex-1 bg-[var(--hara-auth-field)]" />
          <span>və ya</span>
          <span className="h-px flex-1 bg-[var(--hara-auth-field)]" />
        </div>
        <SocialLoginButtons />
      </div>
    </AuthFrame>
  );
}
