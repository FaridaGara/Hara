import type { Metadata } from "next";
import { Suspense } from "react";

import { PageLoader } from "@/components/states";
import { VerificationForm } from "@/components/verification-form";

export const metadata: Metadata = {
  title: "Təsdiqləmə — Hara",
};

export default function VerifyPage() {
  return (
    <Suspense fallback={<PageLoader label="Təsdiqləmə səhifəsi yüklənir…" />}>
      <VerificationForm />
    </Suspense>
  );
}
