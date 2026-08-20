"use client";

import Image from "next/image";
import Link from "next/link";
import { InputHTMLAttributes, ReactNode, useState } from "react";

type AuthFrameProps = {
  title: string;
  subtitle: string;
  backHref?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthFrame({
  title,
  subtitle,
  backHref = "/",
  children,
  footer,
}: AuthFrameProps) {
  return (
    <main className="hara-auth flex min-h-[100dvh] justify-center bg-[var(--hara-auth-outer)] sm:px-6 sm:py-8">
      <section className="flex min-h-[100dvh] w-full max-w-[402px] flex-col overflow-hidden bg-[var(--hara-auth-page)] text-[var(--hara-auth-text)] sm:min-h-[874px] sm:rounded-[32px]">
        <div className="flex flex-1 flex-col pt-[var(--hara-safe-top)]">
          <div className="flex h-[52px] shrink-0 items-center justify-center pb-2 pt-3">
            <Image
              src="/figma/home/hara-logo-32.svg"
              alt="HARA"
              width={32}
              height={32}
              priority
            />
          </div>
          <header className="relative flex h-[72px] shrink-0 items-center px-4">
            <Link
              href={backHref}
              aria-label="Geri qayıt"
              className="grid size-10 place-items-center rounded-full bg-[var(--hara-auth-field)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
            >
              <Image
                src="/figma/auth/back.svg"
                alt=""
                width={24}
                height={24}
                className="hara-auth-icon"
              />
            </Link>
            <div className="pointer-events-none absolute inset-x-[68px] top-1/2 -translate-y-1/2 text-center">
              <h1 className="truncate text-[16px] leading-[21px] font-semibold tracking-[-0.31px]">
                {title}
              </h1>
              <p className="truncate text-[13px] leading-[18px] tracking-[-0.08px] text-[var(--hara-auth-secondary)]">
                {subtitle}
              </p>
            </div>
          </header>
          {children}
        </div>
        {footer ? (
          <footer className="shrink-0 px-6 pb-[calc(16px+var(--hara-safe-bottom))] pt-4 text-center text-[13px] leading-[18px] tracking-[-0.08px]">
            {footer}
          </footer>
        ) : (
          <div className="h-[var(--hara-safe-bottom)] shrink-0" />
        )}
      </section>
    </main>
  );
}

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: "lock" | "user" | "eye";
};

export function AuthField({ label, icon, type, className, ...props }: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && visible ? "text" : type;

  return (
    <label className={`flex h-14 min-w-0 items-center gap-2 rounded-2xl bg-[var(--hara-auth-field)] px-4 ${className || ""}`}>
      <span className="sr-only">{label}</span>
      <Image
        src={`/figma/auth/${icon}.svg`}
        alt=""
        width={24}
        height={24}
        className="hara-auth-icon size-6 shrink-0"
      />
      <input
        {...props}
        type={inputType}
        aria-label={label}
        placeholder={props.placeholder || label}
        className="min-w-0 flex-1 border-0 bg-transparent text-[17px] leading-[22px] tracking-[-0.43px] text-[var(--hara-auth-text)] outline-none placeholder:text-[var(--hara-auth-secondary)] disabled:opacity-60"
      />
      {isPassword ? (
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Şifrəni gizlət" : "Şifrəni göstər"}
          className="grid size-8 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-[#565dd8]"
        >
          <Image
            src={`/figma/auth/${visible ? "eye" : "eye-slash"}.svg`}
            alt=""
            width={24}
            height={24}
            className="hara-auth-icon"
          />
        </button>
      ) : null}
    </label>
  );
}

export function AuthButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#565dd8] px-4 text-[16px] leading-[21px] font-semibold tracking-[-0.31px] text-white transition hover:bg-[#4e55c5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hara-auth-text)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function AuthMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl px-3 py-2 text-[13px] leading-5 ${
        tone === "error"
          ? "bg-red-500/10 text-red-600 dark:text-red-300"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      }`}
    >
      {children}
    </p>
  );
}

export function PasswordRequirements({ password }: { password: string }) {
  const requirements = [
    [password.length >= 8, "Ən azı 8 simvol"],
    [/[A-ZƏÖÜİÇŞĞ]/.test(password), "Ən azı bir böyük hərf"],
    [/\d/.test(password), "Ən azı bir rəqəm"],
  ] as const;

  return (
    <ul className="space-y-2 pl-2">
      {requirements.map(([met, label]) => (
        <li
          key={label}
          className={`flex items-center gap-2 text-[12px] leading-4 ${
            met ? "text-[var(--hara-auth-secondary)]" : "text-[var(--hara-auth-muted)]"
          }`}
        >
          <Image
            src="/figma/auth/tick-circle.svg"
            alt=""
            width={24}
            height={24}
            className={`hara-auth-icon size-6 ${met ? "opacity-100" : "opacity-45"}`}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
