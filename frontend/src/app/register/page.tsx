import type { Metadata } from "next";
import { Suspense } from "react";

import { RegistrationForm } from "@/components/registration-form";
import { PageLoader } from "@/components/states";

export const metadata: Metadata = {
  title: "Qeydiyyat — Hara",
};

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageLoader label="Qeydiyyat səhifəsi yüklənir…" />}>
      <RegistrationForm />
    </Suspense>
  );
}
