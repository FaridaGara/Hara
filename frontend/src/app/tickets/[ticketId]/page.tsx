import type { Metadata } from "next";
import { Suspense } from "react";

import { ProtectedRoute } from "@/components/protected-route";
import { PageLoader } from "@/components/states";
import { TicketDetail } from "@/components/ticket-detail";

export const metadata: Metadata = {
  title: "Bilet — Hara",
};

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return (
    <Suspense fallback={<PageLoader label="Bilet yüklənir…" />}>
      <ProtectedRoute>
        <TicketDetail ticketId={ticketId} />
      </ProtectedRoute>
    </Suspense>
  );
}
