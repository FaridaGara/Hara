import type { Metadata } from "next";
import { Suspense } from "react";

import { PersonalInfoForm } from "@/components/personal-info-form";
import { ProtectedRoute } from "@/components/protected-route";
import { PageLoader } from "@/components/states";

export const metadata: Metadata = {
  title: "Şəxsi məlumatlar — Hara",
};

export default function PersonalInfoPage() {
  return (
    <Suspense fallback={<PageLoader label="Profil yüklənir…" />}>
      <ProtectedRoute>
        <PersonalInfoForm />
      </ProtectedRoute>
    </Suspense>
  );
}
