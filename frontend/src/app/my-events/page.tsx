import { Suspense } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { MyEventSubmissions } from "@/components/my-event-submissions";
export const metadata = { title: "Tədbirlərim — Hara", robots: { index: false, follow: false } };
export default function MyEventsPage() { return <Suspense><ProtectedRoute><MyEventSubmissions /></ProtectedRoute></Suspense>; }
