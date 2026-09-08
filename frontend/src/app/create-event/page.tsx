import type { Metadata } from "next";
import { Suspense } from "react";

import { EventWizard } from "@/components/event-wizard";
import { ProtectedRoute } from "@/components/protected-route";
import { PageLoader } from "@/components/states";

export const metadata: Metadata = {
  title: "Tədbir yarat — Hara",
  robots: { index: false, follow: false },
};

export default function CreateEventPage() {
  return (
    <Suspense fallback={<PageLoader label="Tədbir forması yüklənir…" />}>
      <ProtectedRoute>
        <EventWizard />
      </ProtectedRoute>
    </Suspense>
  );
}
