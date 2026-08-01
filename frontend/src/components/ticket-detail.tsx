"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, ticketsApi, type Ticket } from "@/lib/api";
import { formatBakuDate } from "@/lib/format";

import { InlineError, PageLoader, StatePanel } from "./states";

type LoadTicket = (ticketId: string, signal?: AbortSignal) => Promise<Ticket>;

type DetailState =
  | { kind: "loading" }
  | { kind: "success"; ticket: Ticket }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export function TicketDetail({
  ticketId,
  loadTicket = ticketsApi.detail,
}: {
  ticketId: string;
  loadTicket?: LoadTicket;
}) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    loadTicket(ticketId, controller.signal)
      .then((ticket) => setState({ kind: "success", ticket }))
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
              : "Bilet məlumatını yükləmək mümkün olmadı.",
        });
      });

    return () => controller.abort();
  }, [loadTicket, retryKey, ticketId]);

  if (state.kind === "loading") {
    return <PageLoader label="Bilet yüklənir…" />;
  }

  if (state.kind === "not-found") {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <StatePanel
          title="Bilet tapılmadı"
          message="Bu bilet mövcud deyil və ya başqa istifadəçiyə aiddir."
          action={
            <Link
              href="/tickets"
              className="inline-grid min-h-11 place-items-center rounded-xl bg-white px-5 text-sm font-bold text-[#18181a]"
            >
              Biletlərimə qayıt
            </Link>
          }
        />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 sm:px-6">
        <InlineError message={state.message} />
        <button
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            setRetryKey((value) => value + 1);
          }}
          className="min-h-11 rounded-xl bg-white px-5 text-sm font-bold text-[#18181a]"
        >
          Yenidən cəhd et
        </button>
      </main>
    );
  }

  const ticket = state.ticket;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href="/tickets"
        className="inline-grid min-h-11 place-items-center rounded-xl px-2 text-sm font-semibold text-white/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
      >
        ← Biletlərimə qayıt
      </Link>

      <article className="mt-3 overflow-hidden rounded-3xl border border-white/10 bg-[#111118]">
        <div className="border-b border-dashed border-white/15 bg-[radial-gradient(circle_at_20%_10%,rgba(86,93,216,0.35),transparent_52%)] p-6 sm:p-8">
          <p className="text-xs font-bold tracking-[0.16em] text-[#98ff00] uppercase">
            {ticket.ticket_type_name}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{ticket.event_title}</h1>
          <p className="mt-4 text-sm font-semibold">
            {formatBakuDate(ticket.event_start_at)}
          </p>
          <p className="mt-1 text-sm text-white/50">{ticket.event_location_name}</p>
        </div>

        <div className="p-6 sm:p-8">
          <dl className="grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-bold text-white/35 uppercase">İştirakçı</dt>
              <dd className="mt-1 font-semibold">{ticket.owner_display_name}</dd>
            </div>
            <div>
              <dt className="font-bold text-white/35 uppercase">Məbləğ</dt>
              <dd className="mt-1 font-semibold">{ticket.unit_price}</dd>
              <dd className="mt-1 text-xs text-white/40">
                Valyuta Ticket API response-unda yoxdur
              </dd>
            </div>
            <div>
              <dt className="font-bold text-white/35 uppercase">Check-in</dt>
              <dd className="mt-1 font-semibold">
                {ticket.is_checked_in ? "Check-in edilib" : "Check-in edilməyib"}
              </dd>
              {ticket.checked_in_at ? (
                <dd className="mt-1 text-white/45">{formatBakuDate(ticket.checked_in_at)}</dd>
              ) : null}
            </div>
            <div>
              <dt className="font-bold text-white/35 uppercase">Bitmə vaxtı</dt>
              <dd className="mt-1 font-semibold">{formatBakuDate(ticket.event_end_at)}</dd>
            </div>
          </dl>

          <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="font-bold">QR payload</h2>
            <p className="mt-1 text-xs leading-5 text-white/45">
              API yalnız unikal UUID payload qaytarır; saxta QR şəkli yaradılmır.
              Girişdə bu dəyəri səlahiyyətli check-in sisteminə təqdim et.
            </p>
            <code className="mt-4 block overflow-x-auto rounded-xl bg-black/30 p-4 text-sm text-[#b9bcff]">
              {ticket.qr_code}
            </code>
          </section>
        </div>
      </article>
    </main>
  );
}
