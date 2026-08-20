import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/reset-password-form";
import { PageLoader } from "@/components/states";

export const metadata: Metadata = {
  title: "Yeni şifrə — Hara",
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PageLoader label="Şifrə səhifəsi yüklənir…" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
