import type { Metadata } from "next";
import { Suspense } from "react";

import { ProtectedRoute } from "@/components/protected-route";
import { PageLoader } from "@/components/states";
import { TicketWallet } from "@/components/ticket-wallet";

export const metadata: Metadata = {
  title: "Biletlərim — Hara",
};

type TicketSearchParams = {
  period?: string | string[];
};

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<TicketSearchParams>;
}) {
  const params = await searchParams;
  const rawPeriod = Array.isArray(params.period) ? params.period[0] : params.period;
  const eventStatus =
    rawPeriod === "upcoming" || rawPeriod === "past" ? rawPeriod : undefined;

  return (
    <Suspense fallback={<PageLoader label="Biletlər yüklənir…" />}>
      <ProtectedRoute>
        <TicketWallet eventStatus={eventStatus} />
      </ProtectedRoute>
    </Suspense>
  );
}
