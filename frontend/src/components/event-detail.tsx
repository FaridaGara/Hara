"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, eventsApi, type HaraEvent } from "@/lib/api";
import { formatBakuDate } from "@/lib/format";

import { EventPoster } from "./event-poster";
import { InlineError, PageLoader, StatePanel } from "./states";

type EventDetailState =
  | { kind: "loading" }
  | { kind: "success"; event: HaraEvent }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type LoadEvent = (slug: string, signal?: AbortSignal) => Promise<HaraEvent>;

export function EventDetail({
  slug,
  loadEvent = eventsApi.detail,
}: {
  slug: string;
  loadEvent?: LoadEvent;
}) {
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<EventDetailState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    loadEvent(slug, controller.signal)
      .then((event) => setState({ kind: "success", event }))
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "cancelled") {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "not-found" });
          return;
        }
        setState({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Tədbir məlumatını yükləmək mümkün olmadı.",
        });
      });

    return () => controller.abort();
  }, [loadEvent, retryKey, slug]);

  if (state.kind === "loading") {
    return <PageLoader label="Tədbir yüklənir…" />;
  }

  if (state.kind === "not-found") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <StatePanel
          title="Tədbir tapılmadı"
          message="Bu tədbir mövcud deyil və ya hazırda public yayımlanmayıb."
          action={
            <Link
              href="/"
              className="inline-grid min-h-11 place-items-center rounded-xl bg-white px-5 text-sm font-bold text-[#18181a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
            >
              Tədbirlərə qayıt
            </Link>
          }
        />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        <InlineError message={state.message} />
        <StatePanel
          title="Məlumat açılmadı"
          message="API bağlantısını yoxlayın və yenidən cəhd edin."
          action={
            <button
              type="button"
              onClick={() => {
                setState({ kind: "loading" });
                setRetryKey((value) => value + 1);
              }}
              className="min-h-11 rounded-xl bg-white px-5 text-sm font-bold text-[#18181a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
            >
              Yenidən cəhd et
            </button>
          }
        />
      </main>
    );
  }

  const event = state.event;
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6 sm:py-10">
      <Link
        href="/"
        className="inline-grid min-h-11 place-items-center rounded-xl px-2 text-sm font-semibold text-white/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
      >
        ← Tədbirlərə qayıt
      </Link>

      <article className="mt-3 overflow-hidden rounded-3xl border border-white/10 bg-[#111118]">
        <EventPoster
          src={event.cover_image_url}
          title={event.title}
          priority
          className="aspect-[16/9] max-h-[430px]"
        />
        <div className="grid gap-7 p-5 sm:p-8 md:grid-cols-[1fr_280px]">
          <div>
            <span className="rounded-lg bg-[#565dd8]/20 px-2.5 py-1 text-xs font-bold text-[#aeb1ff]">
              {event.category.name}
            </span>
            <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
              {event.title}
            </h1>
            <dl className="mt-6 space-y-4 text-sm">
              <div>
                <dt className="font-bold text-white/35 uppercase">Başlama vaxtı</dt>
                <dd className="mt-1 font-semibold">{formatBakuDate(event.start_at)}</dd>
              </div>
              <div>
                <dt className="font-bold text-white/35 uppercase">Bitmə vaxtı</dt>
                <dd className="mt-1 font-semibold">{formatBakuDate(event.end_at)}</dd>
              </div>
              <div>
                <dt className="font-bold text-white/35 uppercase">Məkan</dt>
                <dd className="mt-1 font-semibold">
                  {event.venue.name}
                  {event.venue.city ? `, ${event.venue.city}` : ""}
                </dd>
                <dd className="mt-1 text-white/50">{event.venue.address}</dd>
              </div>
            </dl>

            {event.description ? (
              <section className="mt-8" aria-labelledby="description-heading">
                <h2 id="description-heading" className="text-xl font-bold">
                  Tədbir haqqında
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/65">
                  {event.description}
                </p>
              </section>
            ) : null}
          </div>

          <aside className="h-fit rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-5">
            <h2 className="text-lg font-bold text-amber-100">Bilet satışı</h2>
            <p className="mt-2 text-sm leading-6 text-amber-50/65">
              Public event API-si ticket type, qiymət və mövcud say qaytarmır.
              Buna görə bilet seçimi və order yaratma bu səhifədə təhlükəsiz
              şəkildə aktiv edilə bilmir.
            </p>
            <p className="mt-3 text-xs leading-5 text-white/40">
              Organizer endpoint-i attendee üçün istifadə edilmir və saxta
              qiymət göstərilmir.
            </p>
          </aside>
        </div>
      </article>
    </main>
  );
}
