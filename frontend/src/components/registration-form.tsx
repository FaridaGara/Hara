"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { ApiError } from "@/lib/api";

import { useAuth } from "./auth-provider";
import { AuthButton, AuthField, AuthFrame, AuthMessage } from "./auth-ui";

export function RegistrationForm() {
  const router = useRouter();
  const { register } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (password !== passwordConfirm) {
      setError("Şifrələr eyni deyil.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await register({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone_number: phone.trim(),
        password,
        password_confirm: passwordConfirm,
        accept_terms: acceptedTerms,
      });
      const verificationEmail = response.email || email.trim();
      router.push(
        `/verify?purpose=registration&email=${encodeURIComponent(verificationEmail)}`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Qeydiyyat zamanı gözlənilməz xəta baş verdi.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const valid =
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    phone.trim() &&
    password &&
    passwordConfirm &&
    acceptedTerms;

  return (
    <AuthFrame
      title="Qeydiyyat"
      subtitle="Yeni hesab yaradın"
      backHref="/login"
      footer={
        <p className="text-[var(--hara-auth-secondary)]">
          Artıq hesabın var?{" "}
          <Link className="font-semibold text-[#4e55c5]" href="/login">
            Daxil ol
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-6">
        <div className="grid grid-cols-2 gap-3">
          <AuthField
            label="Ad"
            icon="user"
            name="first_name"
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
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
        />
        <AuthField
          label="+994 50 756 90 83"
          icon="lock"
          type="tel"
          name="phone_number"
          autoComplete="tel"
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          disabled={submitting}
        />
        <AuthField
          label="Şifrə"
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
        <label className="flex cursor-pointer items-center gap-3 py-2 text-[12px] leading-4 text-[var(--hara-auth-secondary)]">
          <input
            type="checkbox"
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
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        <AuthButton type="submit" disabled={submitting || !valid}>
          {submitting ? "Hesab yaradılır…" : "Qeydiyyatdan keç"}
        </AuthButton>
      </form>
    </AuthFrame>
  );
}
