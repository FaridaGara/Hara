import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";
import { PageLoader } from "@/components/states";

export const metadata: Metadata = {
  title: "Giriş — Hara",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<PageLoader label="Giriş səhifəsi yüklənir…" />}>
      <LoginForm />
    </Suspense>
  );
}
