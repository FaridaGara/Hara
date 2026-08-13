import type { Metadata } from "next";

import { MoreView } from "@/components/more-view";

export const metadata: Metadata = {
  title: "Profil — Hara",
};

export default function MorePage() {
  return <MoreView />;
}
