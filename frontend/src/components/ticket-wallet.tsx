"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ApiError,
  ticketsApi,
  type Ticket,
  type TicketListFilters,
} from "@/lib/api";
import { formatBakuDate } from "@/lib/format";

import { InlineError, PageLoader, StatePanel } from "./states";

type LoadTickets = (
  filters: TicketListFilters,
  signal?: AbortSignal,
) => Promise<Ticket[]>;

type WalletState =
  | { kind: "loading" }
  | { kind: "success"; tickets: Ticket[] }
  | { kind: "error"; message: string };

const filterLinks: Array<{
  value: TicketListFilters["event_status"];
  label: string;
  href: string;
}> = [
  { value: undefined, label: "Hamısı", href: "/tickets" },
  { value: "upcoming", label: "Qarşıdan gələn", href: "/tickets?period=upcoming" },
  { value: "past", label: "Keçmiş", href: "/tickets?period=past" },
];

function TicketCard({ ticket }: { ticket: Ticket }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-[#15151d] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-[#98ff00] uppercase">
            {ticket.ticket_type_name}
          </p>
          <h2 className="mt-1 text-xl font-bold">{ticket.event_title}</h2>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
            ticket.is_checked_in
              ? "bg-white/10 text-white/50"
              : "bg-[#565dd8]/20 text-[#bfc1ff]"
          }`}
        >
          {ticket.is_checked_in ? "Check-in edilib" : "Check-in edilməyib"}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold">
        {formatBakuDate(ticket.event_start_at)}
      </p>
      <p className="mt-1 text-sm text-white/50">{ticket.event_location_name}</p>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
        <span className="text-sm font-semibold text-white/65">
          {ticket.unit_price}
        </span>
        <Link
          href={`/tickets/${encodeURIComponent(ticket.id)}`}
          className="grid min-h-11 place-items-center rounded-xl bg-white px-4 text-sm font-bold text-[#18181a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
        >
          Bileti aç
        </Link>
      </div>
    </article>
  );
}

export function TicketWallet({
  eventStatus,
  loadTickets = ticketsApi.list,
}: {
  eventStatus?: TicketListFilters["event_status"];
  loadTickets?: LoadTickets;
}) {
  const [state, setState] = useState<WalletState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    loadTickets(
      eventStatus ? { event_status: eventStatus } : {},
      controller.signal,
    )
      .then((tickets) => setState({ kind: "success", tickets }))
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "cancelled") {
          return;
        }
        setState({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Biletləri yükləmək mümkün olmadı.",
        });
      });

    return () => controller.abort();
  }, [eventStatus, loadTickets, retryKey]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold tracking-[0.16em] text-[#98ff00] uppercase">
        Wallet
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Biletlərim</h1>
      <p className="mt-2 text-sm leading-6 text-white/50">
        Yalnız hesabına aid biletlər backend ownership qaydası ilə qaytarılır.
      </p>

      <nav className="scrollbar-none mt-6 flex gap-2 overflow-x-auto" aria-label="Bilet dövrü">
        {filterLinks.map((filter) => {
          const active = filter.value === eventStatus;
          return (
            <Link
              key={filter.label}
              href={filter.href}
              aria-current={active ? "page" : undefined}
              className={`grid min-h-11 shrink-0 place-items-center rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00] ${
                active
                  ? "border-[#98ff00] bg-[#98ff00] text-[#18181a]"
                  : "border-white/15 text-white/60"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      <section className="mt-7" aria-live="polite">
        {state.kind === "loading" ? <PageLoader label="Biletlər yüklənir…" /> : null}

        {state.kind === "error" ? (
          <div className="space-y-4">
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
          </div>
        ) : null}

        {state.kind === "success" && state.tickets.length === 0 ? (
          <StatePanel
            title="Bilet yoxdur"
            message={
              eventStatus
                ? "Bu dövrə uyğun bilet tapılmadı."
                : "Payment backend tərəfindən təsdiqləndikdən sonra biletlər burada görünəcək."
            }
            action={
              <Link
                href="/"
                className="inline-grid min-h-11 place-items-center rounded-xl bg-white px-5 text-sm font-bold text-[#18181a]"
              >
                Tədbir kəşf et
              </Link>
            }
          />
        ) : null}

        {state.kind === "success" && state.tickets.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {state.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        ) : null}
      </section>

      <p className="mt-7 text-xs leading-5 text-white/35">
        Ticket API ayrıca lifecycle statusu və currency qaytarmır. UI yalnız
        faktiki check-in statusunu göstərir; unit price hazırkı backend
        currency qaytarmadığı üçün UI valyuta adı uydurmur.
      </p>
    </main>
  );
}
