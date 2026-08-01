import type { Metadata } from "next";

import { EventDetail } from "@/components/event-detail";

export const metadata: Metadata = {
  title: "Tədbir — Hara",
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <EventDetail slug={slug} />;
}
