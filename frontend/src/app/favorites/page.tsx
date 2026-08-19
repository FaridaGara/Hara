import type { Metadata } from "next";
import { Suspense } from "react";

import { FavoritesView } from "@/components/favorites-view";
import { ProtectedRoute } from "@/components/protected-route";
import { PageLoader } from "@/components/states";

export const metadata: Metadata = {
  title: "Sevimlilər — Hara",
};

export default function FavoritesPage() {
  return (
    <Suspense fallback={<PageLoader label="Sevimlilər yüklənir…" />}>
      <ProtectedRoute>
        <FavoritesView />
      </ProtectedRoute>
    </Suspense>
  );
}
