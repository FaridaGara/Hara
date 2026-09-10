import { Suspense } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { TeamReviewList } from "@/components/team-event-reviews";
export const metadata = { title: "Tədbir yoxlaması — HARA", robots: { index: false, follow: false } };
export default function Page() { return <Suspense><ProtectedRoute><TeamReviewList /></ProtectedRoute></Suspense>; }
