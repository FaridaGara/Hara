"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import {
  ApiError,
  eventsApi,
  type HaraEvent,
  type PublicTicketType,
} from "@/lib/api";
import { formatBakuDate, safePosterUrl } from "@/lib/format";

import { MobileTabBar } from "./mobile-tab-bar";

type LoadEvents = (
  filters?: { search?: string; ordering?: "start_at" },
  signal?: AbortSignal,
) => Promise<HaraEvent[]>;

type HomeState =
  | { kind: "loading" }
  | { kind: "success"; events: HaraEvent[] }
  | { kind: "error"; message: string };

type EventWithTickets = HaraEvent & { ticket_types?: PublicTicketType[] };

function eventPrice(event: HaraEvent, from = false) {
  const tickets = (event as EventWithTickets).ticket_types;
  const cheapest = tickets
    ?.filter((ticket) => Number.isFinite(Number(ticket.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))[0];

  if (!cheapest) return from ? "15 AZN-dən" : "15 AZN";
  const price = Number(cheapest.price);
  const displayedPrice = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return `${displayedPrice} ${cheapest.currency}${from ? "-dən" : ""}`;
}

function EventImage({
  event,
  fallback,
  priority = false,
}: {
  event: HaraEvent;
  fallback: string;
  priority?: boolean;
}) {
  const src = safePosterUrl(event.cover_image_url) ?? fallback;

  return (
    // API poster origins are intentionally unrestricted, so a finite Next Image allowlist is not possible.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function AdaptiveIcon({
  lightSrc,
  darkSrc,
  size,
}: {
  lightSrc: string;
  darkSrc: string;
  size: number;
}) {
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      <Image src={lightSrc} alt="" fill sizes={`${size}px`} className="theme-light-only" />
      <Image src={darkSrc} alt="" fill sizes={`${size}px`} className="theme-dark-only" />
    </span>
  );
}

function FavoriteButton({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  const [selected, setSelected] = useState(false);

  return (
    <button
      type="button"
      aria-label={selected ? "Sevimlilərdən çıxar" : "Sevimlilərə əlavə et"}
      aria-pressed={selected}
      onClick={() => setSelected((value) => !value)}
      className={`relative z-10 grid shrink-0 place-items-center rounded-full transition active:scale-95 ${
        light
          ? "size-8 bg-white/12"
          : compact
            ? "size-8 bg-transparent"
            : "size-10 bg-[var(--hara-surface)]"
      }`}
    >
      {light ? (
        <Image src="/figma/home/heart-light.svg" alt="" width={16} height={16} />
      ) : (
        <AdaptiveIcon
          lightSrc="/figma/home/heart-dark.svg"
          darkSrc={compact ? "/figma/home/heart-light.svg" : "/figma/home-dark/header-heart.svg"}
          size={compact ? 16 : 24}
        />
      )}
    </button>
  );
}

export function Header() {
  return (
    <header className="hara-home-header flex items-center gap-3 px-4 pb-4">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <Image
          src="/figma/home/hara-logo-32.svg"
          alt=""
          width={32}
          height={32}
          className="size-8 shrink-0"
          priority
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] leading-[21px] font-semibold tracking-[-0.31px] text-[var(--hara-primary)]">
            Salam, Monika 👋
          </p>
          <p className="truncate text-[13px] leading-[18px] tracking-[-0.08px] text-[var(--hara-muted)]">
            Bu gün nə etmək istəyirsən?
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <FavoriteButton />
        <button
          type="button"
          className="relative grid size-10 place-items-center rounded-full bg-[var(--hara-surface)] transition active:scale-95"
          aria-label="Bildirişlər"
        >
          <AdaptiveIcon
            lightSrc="/figma/home/notification.svg"
            darkSrc="/figma/home-dark/notification.svg"
            size={24}
          />
          <span className="absolute -top-1 -right-0.5 grid size-5 place-items-center rounded-full border border-[var(--hara-badge-border)] bg-[#ff2c3d] text-[9px] leading-3 font-medium text-white">
            9+
          </span>
        </button>
      </div>
    </header>
  );
}

export function SearchBar({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(query.trim());
  };

  return (
    <form role="search" onSubmit={submit} className="flex h-[72px] gap-2 px-4 py-3">
      <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-3xl bg-[var(--hara-surface)] px-3">
        <span className="sr-only">Tədbir axtar</span>
        <Image src="/figma/home/search.svg" alt="" width={24} height={24} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Caz, rooftop, sərgi..."
          className="min-w-0 flex-1 bg-transparent text-[15px] leading-5 tracking-[-0.23px] text-[var(--hara-secondary)] outline-none placeholder:text-[var(--hara-muted)]"
        />
      </label>
      <button
        type="submit"
        className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--hara-surface)] transition active:scale-95"
        aria-label="Axtar"
      >
        <AdaptiveIcon
          lightSrc="/figma/home/filter.svg"
          darkSrc="/figma/home-dark/filter.svg"
          size={24}
        />
      </button>
    </form>
  );
}

export function FeaturedEventCard({
  event,
  index,
  priority = false,
}: {
  event: HaraEvent;
  index: number;
  priority?: boolean;
}) {
  return (
    <article className="relative h-[200px] w-[324px] shrink-0 snap-start overflow-hidden rounded-tl-3xl rounded-tr-lg rounded-br-3xl rounded-bl-lg bg-[#111] text-white">
      <EventImage event={event} fallback={index % 2 ? "/figma/networking.png" : "/figma/jazz.png"} priority={priority} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-[rgba(12,12,16,.85)]" />
      <div className="relative flex items-center justify-between p-3">
        <span className="rounded-lg bg-[#565dd8]/20 px-2 py-1 text-xs leading-4 text-white">
          {event.category.name}
        </span>
        <FavoriteButton light />
      </div>
      <div className="absolute right-3 bottom-3 left-3">
        <h2 className="line-clamp-2 text-[20px] leading-[25px] font-semibold tracking-[-0.45px]">
          <Link
            href={`/events/${encodeURIComponent(event.slug)}`}
            className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
          >
            {event.title}
          </Link>
        </h2>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-xs leading-4 text-white/65">
            {formatBakuDate(event.start_at, true)}
          </p>
          <span className="rounded-lg bg-[#565dd8] px-2 py-1 text-xs leading-4 text-white">
            {eventPrice(event)}
          </span>
        </div>
      </div>
    </article>
  );
}

export function NearbyMapCard({ count }: { count: number }) {
  return (
    <section id="nearby-map" className="px-4 py-3" aria-labelledby="map-heading">
      <div className="relative h-[150px] overflow-hidden rounded-[20px] border border-[#e5e7eb] bg-white p-5 shadow-[0_4px_12px_rgba(0,0,0,.05)]">
        <Image src="/figma/map.png" alt="" fill sizes="370px" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/40 via-[45%] to-transparent to-[60%]" />
        <Image className="absolute top-[37px] right-[96px]" src="/figma/home/map-line-lg.svg" alt="" width={40} height={1} />
        <Image className="absolute top-[24px] right-[86px]" src="/figma/home/map-dot-lg.svg" alt="" width={28} height={28} />
        <Image className="absolute top-[81px] right-[56px]" src="/figma/home/map-line-sm.svg" alt="" width={28} height={1} />
        <Image className="absolute top-[70px] right-[48px]" src="/figma/home/map-dot-md.svg" alt="" width={22} height={22} />
        <Image className="absolute top-[42px] right-[18px]" src="/figma/home/map-dot-lg.svg" alt="" width={28} height={28} />
        <Image className="absolute top-[82px] right-[8px]" src="/figma/home/map-dot-sm.svg" alt="" width={20} height={20} />
        <div className="relative whitespace-nowrap">
          <h2 id="map-heading" className="text-[20px] leading-6 font-bold text-[#18181a]">
            Ətrafımda nə verir baş?
          </h2>
          <p className="mt-1 text-sm leading-5 text-black/65">Yaxında olan {count} tədbirə göz at</p>
        </div>
        <a
          href="#weekly-events"
          className="absolute bottom-5 left-5 flex h-9 items-center gap-1 rounded-full bg-[#98ff00] px-3.5 text-[16px] font-bold text-[#18181a] transition active:scale-95"
        >
          Xəritədə gör
          <Image src="/figma/home/arrow-right.svg" alt="" width={13} height={13} />
        </a>
      </div>
    </section>
  );
}

export function EventRow({ event, index }: { event: HaraEvent; index: number }) {
  return (
    <article className="relative flex h-[136px] gap-3 overflow-hidden">
      <div className="relative size-[120px] shrink-0 overflow-hidden rounded-3xl bg-[#111]">
        <EventImage event={event} fallback={index % 2 ? "/figma/networking.png" : "/figma/jazz.png"} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col border-b border-[var(--hara-divider)]">
        <div className="flex h-10 items-start gap-2">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-5 font-semibold tracking-[-0.23px] text-[var(--hara-primary)]">
            <Link
              href={`/events/${encodeURIComponent(event.slug)}`}
              className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
            >
              {event.title}
            </Link>
          </h3>
          <FavoriteButton compact />
        </div>
        <div className="mt-3 min-w-0 text-[11px] leading-[13px] tracking-[0.06px]">
          <p className="truncate text-[#4e55c5]">{formatBakuDate(event.start_at, true)}</p>
          <p className="mt-1 truncate text-[var(--hara-secondary)]">{event.venue.name}</p>
        </div>
        <span className="mt-3 w-fit rounded-lg bg-[var(--hara-weekly-price)] px-2 py-1 text-xs leading-4 text-[var(--hara-weekly-price-text)]">
          {eventPrice(event, true)}
        </span>
      </div>
    </article>
  );
}

export function HaraHome({ loadEvents = eventsApi.list }: { loadEvents?: LoadEvents }) {
  const [search, setSearch] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<HomeState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadEvents(
      { ordering: "start_at", ...(search ? { search } : {}) },
      controller.signal,
    )
      .then((events) => setState({ kind: "success", events }))
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "cancelled") return;
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Tədbirləri yükləmək mümkün olmadı.",
        });
      });
    return () => controller.abort();
  }, [loadEvents, retryKey, search]);

  const events = state.kind === "success" ? state.events : [];
  const featured = events.filter((event) => event.is_featured);
  const featuredEvents = [...featured, ...events.filter((event) => !event.is_featured)];

  const searchAgain = (query: string) => {
    setState({ kind: "loading" });
    if (query === search) setRetryKey((value) => value + 1);
    else setSearch(query);
  };

  return (
    <main className="hara-home relative mx-auto min-h-dvh w-full max-w-[402px] overflow-x-hidden pb-[108px] transition-colors sm:my-6 sm:min-h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <Header />
      <SearchBar onSearch={searchAgain} />

      <section className="flex flex-col gap-3 py-3" aria-labelledby="featured-heading">
        <h1 id="featured-heading" className="px-4 text-[34px] leading-[41px] font-bold tracking-[0.4px] text-[var(--hara-primary)]">
          Popular events
        </h1>

        {state.kind === "loading" ? (
          <div className="mx-4 h-[200px] animate-pulse rounded-tl-3xl rounded-tr-lg rounded-br-3xl rounded-bl-lg bg-[var(--hara-surface)]">
            <span className="sr-only">Tədbirlər yüklənir…</span>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="mx-4 flex h-[200px] flex-col items-start justify-center rounded-3xl bg-[var(--hara-surface)] p-5" role="alert">
            <p className="text-sm text-[var(--hara-secondary)]">{state.message}</p>
            <button
              type="button"
              onClick={() => {
                setState({ kind: "loading" });
                setRetryKey((value) => value + 1);
              }}
              className="mt-3 min-h-10 rounded-full bg-[var(--hara-retry-bg)] px-4 text-sm font-bold text-[var(--hara-retry-text)]"
            >
              Yenidən cəhd et
            </button>
          </div>
        ) : null}

        {state.kind === "success" && events.length === 0 ? (
          <div className="mx-4 grid h-[200px] place-items-center rounded-3xl bg-[var(--hara-surface)] px-5 text-sm text-[var(--hara-muted)]">
            Uyğun tədbir tapılmadı.
          </div>
        ) : null}

        {featuredEvents.length ? (
          <div className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 touch-pan-x">
            {featuredEvents.map((event, index) => (
              <FeaturedEventCard key={event.id} event={event} index={index} priority={index === 0} />
            ))}
          </div>
        ) : null}
      </section>

      <NearbyMapCard count={events.length || 14} />

      <section id="weekly-events" className="flex flex-col gap-3 px-4 py-3" aria-labelledby="weekly-heading">
        <h2 id="weekly-heading" className="text-[20px] leading-[25px] font-semibold tracking-[-0.45px] text-[var(--hara-primary)]">
          Bu həftə nə var?
        </h2>
        <div className="flex flex-col gap-3">
          {events.map((event, index) => (
            <EventRow key={event.id} event={event} index={index} />
          ))}
        </div>
      </section>

      <MobileTabBar active="home" theme="adaptive" />
    </main>
  );
}
