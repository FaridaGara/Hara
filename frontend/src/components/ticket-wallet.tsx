"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ApiError,
  ticketsApi,
  type Ticket,
  type TicketListFilters,
} from "@/lib/api";
import { formatBakuDate, safePosterUrl } from "@/lib/format";

import { MobileTabBar } from "./mobile-tab-bar";

type LoadTickets = (
  filters: TicketListFilters,
  signal?: AbortSignal,
) => Promise<Ticket[]>;

type WalletState =
  | { kind: "loading" }
  | { kind: "success"; tickets: Ticket[] }
  | { kind: "error"; message: string };

const filterLinks: Array<{
  value: NonNullable<TicketListFilters["event_status"]>;
  label: string;
  href: string;
}> = [
  { value: "upcoming", label: "Gələcək", href: "/tickets" },
  { value: "past", label: "Keçmiş", href: "/tickets?period=past" },
];

function ticketNumber(ticketId: string) {
  return `#TKT-${ticketId.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
}

function ticketPrice(amount: string, currency: string) {
  return `${amount.replace(/\.00$/, "")} ${currency}`;
}

function ticketStatus(ticket: Ticket) {
  if (ticket.is_checked_in || ticket.status === "used") return "İstifadə edilib";
  if (ticket.status === "cancelled") return "Ləğv edilib";
  if (ticket.status === "refunded") return "Geri qaytarılıb";
  return "Aktiv";
}

function TicketQr({
  value,
  size,
  label,
}: {
  value: string;
  size: number;
  label: string;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function generateQr() {
      try {
        const { default: QRCode } = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(value, {
          width: size,
          margin: 0,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (mounted) setSrc(dataUrl);
      } catch {
        if (mounted) setFailed(true);
      }
    }

    void generateQr();

    return () => {
      mounted = false;
    };
  }, [size, value]);

  if (failed) {
    return (
      <span
        role="alert"
        className="grid place-items-center rounded-lg bg-[#f3f5f7] px-3 text-center text-xs text-black/50"
        style={{ width: size, height: size }}
      >
        QR kod hazırlanmadı
      </span>
    );
  }

  if (!src) {
    return (
      <span
        role="status"
        aria-label="QR kod hazırlanır"
        className="block animate-pulse rounded-lg bg-[#e9eaee]"
        style={{ width: size, height: size }}
      />
    );
  }

  // QR is generated from the authenticated user's real ticket payload.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt={label} />;
}

function TicketCountdownModal({
  ticket,
  onClose,
}: {
  ticket: Ticket;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const remaining = Math.max(0, new Date(ticket.event_start_at).getTime() - now);
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const timeParts = [
    { value: days, label: "Gün" },
    { value: hours, label: "Saat" },
    { value: minutes, label: "Dəqiqə" },
  ];

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center px-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="QR pəncərəsini bağla"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-qr-title"
        className="relative z-10 w-full max-w-[354px] rounded-3xl bg-white p-6 text-center text-[#18181a] shadow-[0_24px_80px_rgba(0,0,0,0.24)]"
      >
        <h2 id="ticket-qr-title" className="text-[22px] leading-7 font-bold">
          Başlamağa az qaldı!
        </h2>
        <div
          className="mt-5 flex items-start justify-center gap-3"
          aria-label="Tədbirə qalan vaxt"
        >
          {timeParts.map((part, index) => (
            <div key={part.label} className="contents">
              {index > 0 ? (
                <span className="pt-1 text-[28px] font-semibold">:</span>
              ) : null}
              <div className="w-[54px]">
                <strong className="block text-[34px] leading-10 tracking-[-0.5px]">
                  {String(part.value).padStart(2, "0")}
                </strong>
                <span className="mt-0.5 block text-xs text-black/45">
                  {part.label}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="my-6 border-t border-dashed border-black/15" />
        <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-[0_4px_18px_rgba(0,0,0,0.08)]">
          <TicketQr
            value={ticket.qr_code}
            size={226}
            label={`${ticket.event_title} üçün bilet QR kodu`}
          />
        </div>
        <p className="mt-4 text-sm font-medium text-black/55">
          QR Kodu skan edin
        </p>
      </section>
    </div>
  );
}

async function shareTicket(ticket: Ticket) {
  const url = `${window.location.origin}/tickets/${encodeURIComponent(ticket.id)}`;
  const data = { title: ticket.event_title, text: ticket.event_title, url };

  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
    await navigator.clipboard?.writeText(url);
  } catch {
    // Closing the native share sheet is a normal no-op.
  }
}

function TicketCard({
  ticket,
  onOpenQr,
  priority = false,
}: {
  ticket: Ticket;
  onOpenQr: () => void;
  priority?: boolean;
}) {
  const poster = safePosterUrl(ticket.event_cover_image_url ?? "");

  return (
    <article className="overflow-hidden rounded-tl-3xl rounded-tr-lg rounded-br-3xl rounded-bl-lg border border-[#f2f2f2] bg-[#f3f5f7] text-[#18181a]">
      <div className="flex gap-3 p-3">
        <div className="relative size-[120px] shrink-0 overflow-hidden rounded-3xl bg-[#20212b]">
          {/* Arbitrary HTTPS poster hosts come from the trusted API contract. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster ?? "/figma/jazz.png"}
            alt={`${ticket.event_title} posteri`}
            loading={priority ? "eager" : "lazy"}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="min-w-0 flex-1 py-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/events/${encodeURIComponent(ticket.event_slug)}`}
                className="line-clamp-2 text-[17px] leading-[21px] font-semibold tracking-[-0.2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
              >
                {ticket.event_title}
              </Link>
              <p className="mt-1 text-[13px] leading-[18px] font-medium text-[#565dd8]">
                {formatBakuDate(ticket.event_start_at, true)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void shareTicket(ticket)}
              className="grid size-8 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
              aria-label={`${ticket.event_title} biletini paylaş`}
            >
              <Image
                src="/figma/tickets/share.svg"
                alt=""
                width={24}
                height={24}
              />
            </button>
          </div>

          <div className="mt-3 flex min-w-0 items-center gap-1.5 text-xs text-black/55">
            <Image
              src="/figma/tickets/location.svg"
              alt=""
              width={16}
              height={16}
            />
            <span className="truncate">{ticket.event_location_name}</span>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="rounded-full bg-[#ebe9ff] px-2.5 py-1 text-[11px] font-semibold text-[#565dd8]">
              {ticket.ticket_type_name}
            </span>
            <span className="text-[11px] font-medium text-black/45">
              {ticketStatus(ticket)}
            </span>
          </div>
        </div>
      </div>

      <div className="px-3 pb-3 text-center">
        <p className="mb-3 text-xs font-medium text-black/45">
          Bilet QR Kodu skan edin
        </p>
        <button
          type="button"
          onClick={onOpenQr}
          aria-label={`${ticket.event_title} bilet QR kodunu böyüt`}
          className="mx-auto block rounded-2xl bg-white p-3 shadow-[0_3px_14px_rgba(0,0,0,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
        >
          <TicketQr
            value={ticket.qr_code}
            size={112}
            label={`${ticket.event_title} üçün bilet QR kodu`}
          />
        </button>
      </div>

      <div className="relative flex h-6 items-center">
        <span className="absolute -left-[13px] size-6 rounded-full bg-white" />
        <span className="mx-3 w-full border-t border-dashed border-black/15" />
        <span className="absolute -right-[13px] size-6 rounded-full bg-white" />
      </div>

      <dl className="grid grid-cols-2 gap-4 px-3 pt-2 pb-4">
        <div>
          <dt className="text-[10px] leading-4 font-semibold tracking-[0.08em] text-black/35">
            BİLET NO
          </dt>
          <dd className="mt-0.5 text-[13px] leading-[18px] font-semibold">
            {ticketNumber(ticket.id)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-[10px] leading-4 font-semibold tracking-[0.08em] text-black/35">
            MƏBLƏĞ
          </dt>
          <dd className="mt-0.5 text-[13px] leading-[18px] font-semibold">
            {ticketPrice(ticket.unit_price, ticket.currency)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function TicketWallet({
  eventStatus,
  loadTickets = ticketsApi.list,
}: {
  eventStatus?: NonNullable<TicketListFilters["event_status"]>;
  loadTickets?: LoadTickets;
}) {
  const [state, setState] = useState<WalletState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const activeStatus = eventStatus ?? "upcoming";

  useEffect(() => {
    const controller = new AbortController();

    loadTickets({ event_status: activeStatus }, controller.signal)
      .then((tickets) => setState({ kind: "success", tickets }))
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "cancelled") return;

        setState({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Biletləri yükləmək mümkün olmadı.",
        });
      });

    return () => controller.abort();
  }, [activeStatus, loadTickets, retryKey]);

  return (
    <div className="min-h-screen bg-[#f2f2f2] sm:py-px">
      <main className="hara-home relative mx-auto min-h-screen w-full max-w-[402px] overflow-x-hidden bg-white text-[#18181a]">
        <header className="pt-[var(--hara-safe-top)]">
          <div className="flex h-[72px] items-center px-4">
            <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.35px]">
              Biletlərin
            </h1>
          </div>

          <nav className="px-4 pb-6" aria-label="Bilet dövrü">
            <div className="grid h-12 grid-cols-2 rounded-full bg-[#f3f5f7] p-1">
              {filterLinks.map((filter) => {
                const active = filter.value === activeStatus;
                return (
                  <Link
                    key={filter.value}
                    href={filter.href}
                    aria-current={active ? "page" : undefined}
                    className={`grid place-items-center rounded-full text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8] ${
                      active ? "bg-[#565dd8] text-white" : "text-[#18181a]"
                    }`}
                  >
                    {filter.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </header>

        <section
          className="space-y-2.5 px-4 pb-[calc(74px+var(--hara-safe-bottom))]"
          aria-live="polite"
        >
          {state.kind === "loading" ? (
            <div
              role="status"
              aria-label="Biletlər yüklənir"
              className="space-y-2.5"
            >
              {[0, 1].map((item) => (
                <div
                  key={item}
                  className="h-[430px] animate-pulse rounded-tl-3xl rounded-tr-lg rounded-br-3xl rounded-bl-lg bg-[#f3f5f7]"
                />
              ))}
            </div>
          ) : null}

          {state.kind === "error" ? (
            <div className="rounded-3xl bg-[#f3f5f7] px-6 py-10 text-center">
              <h2 className="text-xl font-bold">Biletləri açmaq mümkün olmadı</h2>
              <p role="alert" className="mt-2 text-sm leading-6 text-black/50">
                {state.message}
              </p>
              <button
                type="button"
                onClick={() => {
                  setState({ kind: "loading" });
                  setRetryKey((value) => value + 1);
                }}
                className="mt-5 min-h-11 rounded-full bg-[#565dd8] px-6 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
              >
                Yenidən cəhd et
              </button>
            </div>
          ) : null}

          {state.kind === "success" && state.tickets.length === 0 ? (
            <div className="rounded-3xl bg-[#f3f5f7] px-6 py-12 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#ebe9ff]">
                <Image
                  src="/figma/tickets/ticket-active.svg"
                  alt=""
                  width={28}
                  height={28}
                />
              </div>
              <h2 className="mt-4 text-xl font-bold">Bilet yoxdur</h2>
              <p className="mt-2 text-sm leading-6 text-black/50">
                {activeStatus === "past"
                  ? "Keçmiş tədbirlərə aid bilet tapılmadı."
                  : "Aldığın gələcək tədbir biletləri burada görünəcək."}
              </p>
              <Link
                href="/"
                className="mt-5 inline-grid min-h-11 place-items-center rounded-full bg-[#565dd8] px-6 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
              >
                Tədbir kəşf et
              </Link>
            </div>
          ) : null}

          {state.kind === "success"
            ? state.tickets.map((ticket, index) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  priority={index === 0}
                  onOpenQr={() => setSelectedTicket(ticket)}
                />
              ))
            : null}
        </section>

        <MobileTabBar active="tickets" />
      </main>

      {selectedTicket ? (
        <TicketCountdownModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
        />
      ) : null}
    </div>
  );
}
