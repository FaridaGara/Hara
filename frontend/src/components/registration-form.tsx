"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { retryAfterSeconds, useRetryCountdown } from "@/hooks/use-retry-countdown";

import { ApiError } from "@/lib/api";
import { phoneNumberError, PHONE_PREFIX } from "@/lib/phone-number";
import { authHref, safeLocalRedirect } from "@/lib/routes";

import { emailError, passwordErrors } from "@/lib/registration-validation";
import { readRegistrationDraft, saveRegistrationDraft } from "@/lib/registration-draft";

import { PhoneNumberField } from "./phone-number-field";
import { useAuth } from "./auth-provider";
import { AuthButton, AuthField, AuthFrame, AuthMessage } from "./auth-ui";

export function RegistrationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, status } = useAuth();
  const next = searchParams.get("next");
  const nextRoute = safeLocalRedirect(next);
  const [firstName, setFirstName] = useState(() => readRegistrationDraft()?.first_name ?? "");
  const [lastName, setLastName] = useState(() => readRegistrationDraft()?.last_name ?? "");
  const [email, setEmail] = useState(() => readRegistrationDraft()?.email ?? "");
  const [phone, setPhone] = useState(() => readRegistrationDraft()?.phone_number.replace(/^\+994/, "") ?? "");
  const [password, setPassword] = useState(() => readRegistrationDraft()?.password ?? "");
  const [passwordConfirm, setPasswordConfirm] = useState(() => readRegistrationDraft()?.password_confirm ?? "");
  const [acceptedTerms, setAcceptedTerms] = useState(() => readRegistrationDraft()?.accept_terms ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRetryCountdown();
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errors: Record<string, string | null> = {
    first_name: firstName.trim() ? null : "Adınızı daxil edin.",
    last_name: lastName.trim() ? null : "Soyadınızı daxil edin.",
    email: emailError(email),
    phone_number: phoneNumberError(phone),
    password: password ? passwordErrors(password).join(" ") || null : "Şifrəni daxil edin.",
    password_confirm: !passwordConfirm ? "Şifrəni təkrarlayın." : password !== passwordConfirm ? "Şifrələr eyni deyil." : null,
    accept_terms: acceptedTerms ? null : "Şərtləri qəbul etməlisiniz.",
  };
  const fieldError = (name: string) => attempted || touched[name] ? errors[name] : null;
  useEffect(() => {
    if (status !== "authenticated") saveRegistrationDraft({first_name: firstName, last_name: lastName, email, phone_number: `${PHONE_PREFIX}${phone}`, password, password_confirm: passwordConfirm, accept_terms: acceptedTerms});
  }, [firstName, lastName, email, phone, password, passwordConfirm, acceptedTerms, status]);

  useEffect(() => {
    if (status === "authenticated") router.replace(nextRoute);
  }, [nextRoute, router, status]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || retry.remaining > 0) return;
    setAttempted(true);
    if (Object.values(errors).some(Boolean)) {
      setError("Məlumatları tamamlayın və işarələnmiş sahələri yoxlayın.");
      const firstInvalid = Object.keys(errors).find((name) => errors[name]);
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await register({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone_number: `${PHONE_PREFIX}${phone}`,
        password,
        password_confirm: passwordConfirm,
        accept_terms: acceptedTerms,
      });
      const verificationEmail = response.email || email.trim();
      router.push(
        authHref(`/verify?purpose=registration&email=${encodeURIComponent(verificationEmail)}&retry_after=${retryAfterSeconds(response)}`, next),
      );
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 429) {
        retry.start(retryAfterSeconds(caughtError.payload));
      }
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Qeydiyyat zamanı gözlənilməz xəta baş verdi.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="Qeydiyyat"
      subtitle="Yeni hesab yaradın"
      backHref={authHref("/login", next)}
      footer={
        <p className="text-[var(--hara-auth-secondary)]">
          Artıq hesabın var?{" "}
          <Link className="font-semibold text-[#4e55c5]" href={authHref("/login", next)}>
            Daxil ol
          </Link>
        </p>
      }
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-3 p-6">
        <div className="grid grid-cols-2 gap-3">
          <AuthField
            label="Ad"
            icon="user"
            name="first_name"
            error={fieldError("first_name")}
            onBlur={() => setTouched((current) => ({...current, first_name: true}))}
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            disabled={submitting}
          />
          <AuthField
            label="Soyad"
            icon="user"
            name="last_name"
            error={fieldError("last_name")}
            onBlur={() => setTouched((current) => ({...current, last_name: true}))}
            autoComplete="family-name"
            required
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            disabled={submitting}
          />
        </div>
        <AuthField
          label="E-poçt"
          icon="lock"
          type="email"
          name="email"
            error={fieldError("email")}
            onBlur={() => setTouched((current) => ({...current, email: true}))}
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
        />
        <PhoneNumberField showErrors={attempted} value={phone} onChange={setPhone} disabled={submitting} />
        <AuthField
          label="Şifrə"
          icon="eye"
          type="password"
          name="password"
            error={fieldError("password")}
            onBlur={() => setTouched((current) => ({...current, password: true}))}
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => { setPassword(event.target.value); setTouched((current) => ({...current, password: true})); }}
          disabled={submitting}
        />
        <AuthField
          label="Şifrəni təkrarla"
          icon="eye"
          type="password"
          name="password_confirm"
            error={fieldError("password_confirm")}
            onBlur={() => setTouched((current) => ({...current, password_confirm: true}))}
          autoComplete="new-password"
          required
          value={passwordConfirm}
          onChange={(event) => { setPasswordConfirm(event.target.value); setTouched((current) => ({...current, password_confirm: true})); }}
          disabled={submitting}
        />
        <label className="flex cursor-pointer items-center gap-3 py-2 text-[12px] leading-4 text-[var(--hara-auth-secondary)]">
          <input
            type="checkbox"
            name="accept_terms"
            aria-invalid={Boolean(fieldError("accept_terms"))}
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="peer sr-only"
          />
          <span className="grid size-5 shrink-0 place-items-center rounded bg-[#565dd8]/15 peer-focus-visible:outline-2 peer-focus-visible:outline-[#565dd8]">
            {acceptedTerms ? (
              <Image src="/figma/auth/check.svg" alt="" width={12} height={12} />
            ) : null}
          </span>
          Şərtlər və qaydaları qəbul edirəm
        </label>
        {fieldError("accept_terms") ? <p className="text-[12px] text-red-600 dark:text-red-300">{errors.accept_terms}</p> : null}
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        {retry.remaining > 0 ? <p role="status" className="text-sm text-[var(--hara-auth-secondary)]">Yenidən cəhd üçün {retry.remaining} saniyə gözləyin.</p> : null}
        <AuthButton type="submit" disabled={submitting || retry.remaining > 0}>
          {submitting ? "Hesab yaradılır…" : "Qeydiyyatdan keç"}
        </AuthButton>
      </form>
    </AuthFrame>
  );
}
