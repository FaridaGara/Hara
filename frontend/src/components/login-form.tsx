"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { ApiError } from "@/lib/api";
import { safeLocalRedirect } from "@/lib/routes";

import { useAuth } from "./auth-provider";
import { InlineError } from "./states";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRoute = safeLocalRedirect(searchParams.get("next"));

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(nextRoute);
    }
  }, [nextRoute, router, status]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        setError("Email və ya şifrə yanlışdır.");
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
    <main className="mx-auto grid min-h-[calc(100vh-65px)] w-full max-w-md place-items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-3xl border border-white/10 bg-[#111118] p-6 sm:p-8">
        <p className="text-xs font-bold tracking-[0.16em] text-[#98ff00] uppercase">
          Xoş gəldin
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Hesabına daxil ol</h1>
        <p className="mt-2 text-sm leading-6 text-white/50">
          Mövcud HARA hesabının email və şifrəsini istifadə et.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <label className="block">
            <span className="text-sm font-semibold text-white/75">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-base outline-none focus:border-[#98ff00] disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-white/75">Şifrə</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-base outline-none focus:border-[#98ff00] disabled:opacity-60"
            />
          </label>

          {error ? <InlineError message={error} /> : null}

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="min-h-12 w-full rounded-xl bg-[#98ff00] px-5 font-bold text-[#18181a] transition hover:bg-[#b0ff3d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Daxil olunur…" : "Daxil ol"}
          </button>
        </form>

        <p className="mt-6 rounded-xl bg-white/[0.04] px-4 py-3 text-xs leading-5 text-white/40">
          Qeydiyyat API-si hələ mövcud deyil. Yeni hesab yaratmaq növbəti backend
          mərhələsinə daxildir.
        </p>
        <Link
          href="/"
          className="mt-3 grid min-h-11 place-items-center rounded-xl text-sm font-semibold text-white/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
        >
          Kəşfə qayıt
        </Link>
      </section>
    </main>
  );
}
