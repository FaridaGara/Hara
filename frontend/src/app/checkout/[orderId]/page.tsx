import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckoutView } from "@/components/checkout-view";
import { ProtectedRoute } from "@/components/protected-route";
import { PageLoader } from "@/components/states";

export const metadata: Metadata = {
  title: "Checkout — Hara",
};

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <Suspense fallback={<PageLoader label="Checkout yüklənir…" />}>
      <ProtectedRoute>
        <CheckoutView orderId={orderId} />
      </ProtectedRoute>
    </Suspense>
  );
}
