import { Suspense } from "react";
import { OrganizerProfile } from "@/components/organizer-profile";
import { ProtectedRoute } from "@/components/protected-route";
import { PageLoader } from "@/components/states";
export const metadata = { title: "Təşkilatçı məlumatları — Hara" };
export default function OrganizerProfilePage() {
  return <Suspense fallback={<PageLoader label="Profil yüklənir…" />}><ProtectedRoute><OrganizerProfile /></ProtectedRoute></Suspense>;
}
