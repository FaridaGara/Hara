import { Suspense } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { TeamReviewDetail } from "@/components/team-event-reviews";
export const metadata = { title: "Tədbirə baxış — HARA", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ProtectedRoute><TeamReviewDetail id={id} /></ProtectedRoute></Suspense>;
}
