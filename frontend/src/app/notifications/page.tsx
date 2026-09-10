import { Suspense } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { Notifications } from "@/components/notifications";

export const metadata = { title: "Bildirişlər — HARA", robots: { index: false, follow: false } };
export default function Page() {
  return <Suspense><ProtectedRoute><Notifications /></ProtectedRoute></Suspense>;
}
