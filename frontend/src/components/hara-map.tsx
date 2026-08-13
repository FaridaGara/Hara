"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, eventsApi, type HaraEvent, type PublicTicketType } from "@/lib/api";
import { formatBakuDate, safePosterUrl } from "@/lib/format";

import { GoogleEventMap } from "./google-event-map";
import { MobileTabBar } from "./mobile-tab-bar";

type LoadEvents = (
  filters?: { ordering?: "start_at" },
  signal?: AbortSignal,
) => Promise<HaraEvent[]>;

type MapMode =
  | { kind: "none" }
  | { kind: "single"; eventId: string }
  | { kind: "cluster"; eventIds: string[] };

type ViewMode = "map" | "list";

type EventWithTickets = HaraEvent & { ticket_types?: PublicTicketType[] };

type DateFilter = "today" | "week" | "month" | "custom";

type AdvancedFilters = {
  date: DateFilter | null;
  customDate: string;
  minPrice: number;
  maxPrice: number;
};

const INITIAL_FILTERS: AdvancedFilters = {
  date: null,
  customDate: "",
  minPrice: 20,
  maxPrice: 100,
};

const CLEARED_FILTERS: AdvancedFilters = { date: null, customDate: "", minPrice: 0, maxPrice: 200 };

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID";

const CATEGORIES = ["Hamısı", "Musiqi", "Teatr", "Workshop", "İdman"] as const;

const CATEGORY_MATCHES: Record<(typeof CATEGORIES)[number], string[]> = {
  Hamısı: [],
  Musiqi: ["music", "musiqi"],
  Teatr: ["teatr", "theatre", "theater"],
  Workshop: ["workshop", "təlim", "telim"],
  İdman: ["idman", "sport"],
};

const CLOSE_PINS = [
  { left: 125, top: 206, icon: "/figma/map/pin-music.svg" },
  { left: 209, top: 339, icon: "/figma/map/pin-game.svg" },
  { left: 137, top: 363, icon: "/figma/map/pin-briefcase.svg" },
  { left: 136, top: 493, icon: "/figma/map/pin-routing.svg" },
  { left: 169, top: 307, icon: "/figma/map/pin-weight.svg" },
  { left: 328, top: 334, icon: "/figma/map/pin-bank.svg" },
] as const;

const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

function eventPrice(event: HaraEvent) {
  const tickets = (event as EventWithTickets).ticket_types;
  const cheapest = tickets
    ?.filter((ticket) => Number.isFinite(Number(ticket.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))[0];

  if (!cheapest) return "15 AZN-dən";
  const price = Number(cheapest.price);
  const displayedPrice = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return `${displayedPrice} ${cheapest.currency}-dən`;
}

function eventPriceValue(event: HaraEvent) {
  const tickets = (event as EventWithTickets).ticket_types;
  const prices = tickets
    ?.map((ticket) => Number(ticket.price))
    .filter((price) => Number.isFinite(price));
  return prices?.length ? Math.min(...prices) : 15;
}

function matchesAdvancedFilters(event: HaraEvent, filters: AdvancedFilters) {
  const price = eventPriceValue(event);
  const matchesPrice =
    price >= filters.minPrice && (filters.maxPrice === 200 || price <= filters.maxPrice);

  if (!matchesPrice || !filters.date) return matchesPrice;

  const nowInBaku = new Date(Date.now() + BAKU_OFFSET_MS);
  const eventInBaku = new Date(new Date(event.start_at).getTime() + BAKU_OFFSET_MS);
  const sameDay =
    eventInBaku.getUTCFullYear() === nowInBaku.getUTCFullYear() &&
    eventInBaku.getUTCMonth() === nowInBaku.getUTCMonth() &&
    eventInBaku.getUTCDate() === nowInBaku.getUTCDate();

  if (filters.date === "today") return sameDay;
  if (filters.date === "month") {
    return (
      eventInBaku.getUTCFullYear() === nowInBaku.getUTCFullYear() &&
      eventInBaku.getUTCMonth() === nowInBaku.getUTCMonth()
    );
  }
  if (filters.date === "custom") {
    const eventDate = eventInBaku.toISOString().slice(0, 10);
    return Boolean(filters.customDate) && eventDate === filters.customDate;
  }

  const dayUntilSunday = (7 - nowInBaku.getUTCDay()) % 7;
  const endOfWeek = new Date(nowInBaku);
  endOfWeek.setUTCDate(nowInBaku.getUTCDate() + dayUntilSunday);
  return eventInBaku >= nowInBaku && eventInBaku <= endOfWeek;
}

function FavoriteButton() {
  const [selected, setSelected] = useState(false);

  return (
    <button
      type="button"
      aria-label={selected ? "Sevimlilərdən çıxar" : "Sevimlilərə əlavə et"}
      aria-pressed={selected}
      onClick={() => setSelected((value) => !value)}
      className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full transition active:scale-95"
    >
      <Image src="/figma/map/heart.svg" alt="" width={16} height={16} />
    </button>
  );
}

function EventPoster({ event }: { event: HaraEvent }) {
  const src = safePosterUrl(event.cover_image_url) ?? "/figma/jazz.png";

  return (
    // Event posters can come from arbitrary API-configured origins.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-full w-full object-cover" />
  );
}

function MapEventCard({ event, compact = false }: { event: HaraEvent; compact?: boolean }) {
  return (
    <article
      className={`relative flex shrink-0 gap-3 overflow-hidden rounded-tl-3xl rounded-tr-lg rounded-br-3xl rounded-bl-lg border border-[#f2f2f2] bg-[#f3f5f7] p-3 ${
        compact ? "w-[354px]" : "w-full"
      }`}
    >
      <div className="size-[120px] shrink-0 overflow-hidden rounded-3xl bg-[#ddd]">
        <EventPoster event={event} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex h-10 items-start gap-2">
          <h2 className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-5 font-semibold tracking-[-0.23px] text-black/90">
            <Link
              href={`/events/${encodeURIComponent(event.slug)}`}
              className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
            >
              {event.title}
            </Link>
          </h2>
          <FavoriteButton />
        </div>
        <div className="min-w-0 text-[11px] leading-[13px] tracking-[0.06px]">
          <p className="truncate text-[#4e55c5]">{formatBakuDate(event.start_at, true)}</p>
          <p className="mt-1 truncate text-black/65">{event.venue.name}</p>
        </div>
        <span className="w-fit rounded-lg bg-[#565dd8] px-2 py-1 text-xs leading-4 text-white">
          {eventPrice(event)}
        </span>
      </div>
    </article>
  );
}

function ListEventCard({ event }: { event: HaraEvent }) {
  return (
    <article className="relative flex h-[136px] w-full gap-3 overflow-hidden">
      <div className="size-[120px] shrink-0 overflow-hidden rounded-3xl bg-[#ddd]">
        <EventPoster event={event} />
      </div>
      <div className="flex h-[136px] min-w-0 flex-1 flex-col border-b border-[#f2f2f2]">
        <div className="flex flex-col gap-3">
          <div className="flex h-10 items-start gap-2">
            <h2 className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-5 font-semibold tracking-[-0.23px] text-black/90">
              <Link
                href={`/events/${encodeURIComponent(event.slug)}`}
                className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
              >
                {event.title}
              </Link>
            </h2>
            <FavoriteButton />
          </div>
          <div className="min-w-0 text-[11px] leading-[13px] tracking-[0.06px]">
            <p className="truncate text-[#4e55c5]">{formatBakuDate(event.start_at, true)}</p>
            <p className="mt-1 truncate text-black/65">{event.venue.name}</p>
          </div>
          <span className="w-fit rounded-lg bg-[#565dd8] px-2 py-1 text-xs leading-4 text-white">
            {eventPrice(event)}
          </span>
        </div>
      </div>
    </article>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-9 shrink-0 rounded-xl border px-3 text-[13px] leading-[18px] tracking-[-0.08px] transition active:scale-95 ${
        active
          ? "border-[#98ff00] bg-[#98ff00] text-black/90"
          : "border-[#f2f2f2] bg-[#f3f5f7] text-black/90"
      }`}
    >
      {children}
    </button>
  );
}

function MapFilterSheet({
  open,
  filters,
  resultCount,
  onChange,
  onClose,
  onReset,
  onApply,
}: {
  open: boolean;
  filters: AdvancedFilters;
  resultCount: number;
  onChange: (filters: AdvancedFilters) => void;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const setDate = (date: DateFilter) => {
    onChange({
      ...filters,
      date: filters.date === date ? null : date,
      customDate: date === "custom" ? filters.customDate : "",
    });
  };

  const setPrice = (minPrice: number, maxPrice: number) => {
    onChange({ ...filters, minPrice, maxPrice });
  };

  const rangeStart = `${(filters.minPrice / 200) * 100}%`;
  const rangeEnd = `${100 - (filters.maxPrice / 200) * 100}%`;

  return (
    <div
      className={`absolute inset-0 z-50 flex items-end justify-center p-1 transition-opacity duration-200 ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
      inert={!open}
    >
      <button
        type="button"
        aria-label="Filter pəncərəsinin xaricini bağla"
        onClick={onClose}
        className="absolute inset-0 bg-black/48"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-filter-title"
        className={`relative z-10 flex max-h-[calc(100%-4px)] w-full max-w-[394px] flex-col overflow-y-auto rounded-[32px] bg-white shadow-[0_0_24px_rgba(0,0,0,.32)] transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <header className="flex items-start gap-4 pt-4 pr-4 pb-2 pl-6">
          <div className="flex min-w-0 flex-1 items-center">
            <h2
              id="map-filter-title"
              className="text-[22px] leading-7 font-bold tracking-[-0.26px] text-black/90"
            >
              Filter
            </h2>
          </div>
          <button
            type="button"
            aria-label="Filteri bağla"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
          >
            <Image src="/figma/map/close.svg" alt="" width={24} height={24} className="size-6" />
          </button>
        </header>

        <div className="mx-4 flex min-h-[120px] flex-col gap-6 border-y border-[#f2f2f2] pt-3 pb-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-[13px] leading-[18px] tracking-[-0.08px] text-black/65">
              Tarix
            </legend>
            <div className="scrollbar-none flex gap-3 overflow-x-auto">
              <FilterChip active={filters.date === "today"} onClick={() => setDate("today")}>
                Bugün
              </FilterChip>
              <FilterChip active={filters.date === "week"} onClick={() => setDate("week")}>
                Bu həftə
              </FilterChip>
              <FilterChip active={filters.date === "month"} onClick={() => setDate("month")}>
                Bu ay
              </FilterChip>
              <label
                className={`relative flex h-9 shrink-0 cursor-pointer items-center rounded-xl border px-3 text-[13px] leading-[18px] tracking-[-0.08px] ${
                  filters.date === "custom"
                    ? "border-[#98ff00] bg-[#98ff00] text-black/90"
                    : "border-[#f2f2f2] bg-[#f3f5f7] text-black/90"
                }`}
              >
                {filters.customDate || "Tarix seç"}
                <input
                  type="date"
                  aria-label="Tarix seç"
                  value={filters.customDate}
                  onChange={(event) =>
                    onChange({ ...filters, date: "custom", customDate: event.target.value })
                  }
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="flex w-full items-center justify-between text-[13px] leading-[18px] tracking-[-0.08px]">
              <span className="text-black/65">Qiymət aralığı</span>
              <span className="font-semibold text-black/90">
                {filters.minPrice} - {filters.maxPrice === 200 ? "200+" : filters.maxPrice} AZN
              </span>
            </legend>
            <div className="flex flex-col gap-2">
              <div className="relative h-5 w-full">
                <div className="absolute inset-x-0 top-1.5 h-2 rounded-full bg-[#f2f2f2]" />
                <div
                  className="absolute top-1.5 h-2 rounded-full bg-[#565dd8]"
                  style={{ left: rangeStart, right: rangeEnd }}
                />
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value={filters.minPrice}
                  aria-label="Minimum qiymət"
                  onChange={(event) =>
                    setPrice(Math.min(Number(event.target.value), filters.maxPrice), filters.maxPrice)
                  }
                  className="hara-price-slider inset-0"
                />
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value={filters.maxPrice}
                  aria-label="Maksimum qiymət"
                  onChange={(event) =>
                    setPrice(filters.minPrice, Math.max(Number(event.target.value), filters.minPrice))
                  }
                  className="hara-price-slider inset-0"
                />
              </div>
              <div className="flex items-center justify-between text-[13px] leading-[18px] tracking-[-0.08px] text-black/[0.38]">
                <span>0 AZN</span>
                <span>200+ AZN</span>
              </div>
            </div>
            <div className="flex gap-3">
              <FilterChip active={filters.minPrice === 0 && filters.maxPrice === 0} onClick={() => setPrice(0, 0)}>
                Pulsuz
              </FilterChip>
              <FilterChip active={filters.minPrice === 1 && filters.maxPrice === 50} onClick={() => setPrice(1, 50)}>
                1-50 AZN
              </FilterChip>
              <FilterChip active={filters.minPrice === 50 && filters.maxPrice === 200} onClick={() => setPrice(50, 200)}>
                50+ AZN
              </FilterChip>
            </div>
          </fieldset>
        </div>

        <footer className="flex flex-col gap-2 px-4 pt-6 pb-[max(24px,var(--hara-safe-bottom))]">
          <button
            type="button"
            onClick={onReset}
            className="h-12 rounded-2xl bg-[#565dd8]/12 text-base leading-[21px] font-semibold tracking-[-0.31px] text-[#565dd8] transition active:scale-[.99]"
          >
            Filteri sıfırla
          </button>
          <button
            type="button"
            onClick={onApply}
            className="h-12 rounded-2xl bg-[#565dd8] text-base leading-[21px] font-semibold tracking-[-0.31px] text-white transition active:scale-[.99]"
          >
            Tədbirləri göstər
          </button>
          <p className="text-center text-[13px] leading-[18px] tracking-[-0.08px] text-black/[0.38]">
            {resultCount} tədbir tapıldı
          </p>
        </footer>
      </section>
    </div>
  );
}

function ClusterMarker({
  label,
  tone,
  className,
  onClick,
  ariaLabel,
}: {
  label: string;
  tone: "purple" | "green" | "dark";
  className: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  const assetTone = tone === "purple" ? "purple" : tone;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`absolute grid size-8 place-items-center rounded-full text-xs leading-4 font-semibold text-white shadow-[0_0_12px_rgba(0,0,0,.24)] transition active:scale-95 ${className}`}
    >
      <Image
        src={`/figma/map/cluster-${assetTone}-outer.svg`}
        alt=""
        width={30}
        height={30}
        className="absolute inset-px"
      />
      <Image
        src={`/figma/map/cluster-${assetTone}-inner.svg`}
        alt=""
        width={28}
        height={28}
        className="absolute inset-0.5"
      />
      <span className="relative">{label}</span>
    </button>
  );
}

function MapBackground({ clustered }: { clustered: boolean }) {
  return (
    <>
      <Image
        src={clustered ? "/figma/map/map-cluster.png" : "/figma/map/map-close.png"}
        alt="Bakı tədbir xəritəsi"
        width={1804}
        height={1701}
        sizes="929px"
        priority
        className="absolute max-w-none"
        style={
          clustered
            ? { left: -329, top: -212, width: 929, height: 876 }
            : { left: -765, top: -756, width: 1804, height: 1701 }
        }
      />
      <div className="absolute inset-0 bg-white/32" />
    </>
  );
}

export function HaraMap({ loadEvents = eventsApi.list }: { loadEvents?: LoadEvents }) {
  const [events, setEvents] = useState<HaraEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Hamısı");
  const [mode, setMode] = useState<MapMode>({ kind: "none" });
  const [centerRequest, setCenterRequest] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<AdvancedFilters>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AdvancedFilters | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadEvents({ ordering: "start_at" }, controller.signal)
      .then((result) => {
        setEvents(result);
        setError("");
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.kind === "cancelled") return;
        setError(reason instanceof ApiError ? reason.message : "Tədbirləri yükləmək mümkün olmadı.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [loadEvents]);

  useEffect(() => {
    if (!filterOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [filterOpen]);

  const discoveryEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("az");
    const categoryMatches = CATEGORY_MATCHES[category];

    return events.filter((event) => {
      const categoryValue = `${event.category.name} ${event.category.slug}`.toLocaleLowerCase("az");
      const matchesCategory =
        category === "Hamısı" || categoryMatches.some((value) => categoryValue.includes(value));
      const searchable = `${event.title} ${event.category.name} ${event.venue.name}`.toLocaleLowerCase("az");
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, events, query]);

  const visibleEvents = useMemo(
    () =>
      appliedFilters
        ? discoveryEvents.filter((event) => matchesAdvancedFilters(event, appliedFilters))
        : discoveryEvents,
    [appliedFilters, discoveryEvents],
  );

  const filterResultCount = useMemo(
    () => discoveryEvents.filter((event) => matchesAdvancedFilters(event, draftFilters)).length,
    [discoveryEvents, draftFilters],
  );

  const visibleEventsById = useMemo(
    () => new Map(visibleEvents.map((event) => [event.id, event])),
    [visibleEvents],
  );

  const selectedEvent =
    mode.kind === "single"
      ? visibleEventsById.get(mode.eventId) ?? null
      : null;
  const clusterEvents =
    mode.kind === "cluster"
      ? mode.eventIds.flatMap((eventId) => {
          const event = visibleEventsById.get(eventId);
          return event ? [event] : [];
        })
      : [];
  const clusterLabel = events.length > 9 ? "9+" : String(Math.max(events.length, 1));

  const selectEvent = useCallback((event: HaraEvent) => {
    setMode({ kind: "single", eventId: event.id });
  }, []);

  const selectCluster = useCallback((clusteredEvents: HaraEvent[]) => {
    setMode({ kind: "cluster", eventIds: clusteredEvents.map((event) => event.id) });
  }, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setMode({ kind: "none" });
    setCenterRequest((value) => value + 1);
  };

  const openFilters = () => {
    setDraftFilters(appliedFilters ?? INITIAL_FILTERS);
    setFilterOpen(true);
  };

  const resetFilters = () => {
    setDraftFilters(CLEARED_FILTERS);
    setAppliedFilters(null);
    setMode({ kind: "none" });
  };

  const applyFilters = () => {
    const isCleared =
      !draftFilters.date && draftFilters.minPrice === 0 && draftFilters.maxPrice === 200;
    setAppliedFilters(isCleared ? null : { ...draftFilters });
    setMode({ kind: "none" });
    setCenterRequest((value) => value + 1);
    setFilterOpen(false);
  };

  return (
    <main className="hara-home relative mx-auto h-dvh min-h-[620px] w-full max-w-[402px] overflow-hidden bg-white text-[#18181a] sm:my-6 sm:h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <div
        className={`absolute inset-0 overflow-hidden transition-[opacity,transform] duration-300 ease-out ${viewMode === "map" ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-8 opacity-0"}`}
        data-testid="map-canvas"
        aria-hidden={viewMode !== "map"}
        inert={viewMode !== "map"}
      >
        {GOOGLE_MAPS_API_KEY ? (
          <GoogleEventMap
            apiKey={GOOGLE_MAPS_API_KEY}
            mapId={GOOGLE_MAPS_MAP_ID}
            events={visibleEvents}
            selectedEventId={selectedEvent?.id ?? null}
            centerRequest={centerRequest}
            onSelectEvent={selectEvent}
            onSelectCluster={selectCluster}
          />
        ) : (
          <>
            <MapBackground clustered={mode.kind === "cluster"} />

            {mode.kind === "cluster" ? (
              <div className="absolute inset-0">
                <ClusterMarker
                  label="9+"
                  tone="dark"
                  className="left-[32%] top-[55%]"
                  onClick={() => selectCluster(visibleEvents)}
                  ariaLabel="Digər tədbir klasteri"
                />
                <ClusterMarker
                  label={clusterLabel}
                  tone="green"
                  className="left-[44%] top-[60%]"
                  onClick={() => selectCluster(visibleEvents)}
                  ariaLabel="Seçilmiş tədbir klasteri"
                />
              </div>
            ) : (
              <div className="absolute inset-0">
                {CLOSE_PINS.map((pin, index) => {
                  const event = visibleEvents.length ? visibleEvents[index % visibleEvents.length] : null;
                  const selected = mode.kind === "single" && mode.eventId === event?.id;

                  return (
                    <button
                      key={pin.icon}
                      type="button"
                      onClick={() => event && selectEvent(event)}
                      aria-label={event ? `${event.title} pinini seç ${index + 1}` : `Tədbir pini ${index + 1}`}
                      className={`absolute grid size-8 place-items-center rounded-full shadow-[0_0_8px_rgba(0,0,0,.16)] transition active:scale-95 ${
                        selected ? "bg-[#6cb500]" : "bg-[#4e55c5]"
                      }`}
                      style={{
                        left: `${(pin.left / 402) * 100}%`,
                        top: `${(pin.top / 616) * 100}%`,
                      }}
                    >
                      <Image src={pin.icon} alt="" width={16} height={16} />
                    </button>
                  );
                })}

                <ClusterMarker
                  label={clusterLabel}
                  tone="purple"
                  className="left-[46%] top-[69%]"
                  onClick={() => selectCluster(visibleEvents)}
                  ariaLabel="Tədbir klasterini aç"
                />
              </div>
            )}
          </>
        )}
      </div>

      <section
        className={`hara-map-list scrollbar-none absolute right-0 left-0 z-10 overflow-y-auto bg-white px-4 py-3 transition-[opacity,transform] duration-300 ease-out ${viewMode === "list" ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-full opacity-0"}`}
        aria-label="Tədbirlərin siyahısı"
        aria-hidden={viewMode !== "list"}
        data-testid="event-list-view"
        inert={viewMode !== "list"}
      >
        {!loading && !error && visibleEvents.length ? (
          <div className="flex flex-col gap-3">
            {visibleEvents.map((event) => (
              <ListEventCard key={event.id} event={event} />
            ))}
          </div>
        ) : null}
      </section>

      <div className="hara-map-controls absolute inset-x-0 top-0 z-30 flex flex-col drop-shadow-[0_12px_10px_rgba(0,0,0,.12)]">
        <form role="search" onSubmit={submitSearch} className="flex h-16 items-start gap-2 px-4 py-2">
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-3xl bg-[#f3f5f7] px-3 py-2">
            <span className="sr-only">Xəritədə tədbir axtar</span>
            <Image src="/figma/home/search.svg" alt="" width={24} height={24} className="size-6 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setMode({ kind: "none" });
              }}
              placeholder="Caz, rooftop, sərgi..."
              className="min-w-0 flex-1 bg-transparent text-[15px] leading-5 tracking-[-0.23px] text-black/70 outline-none placeholder:text-black/[0.38]"
            />
          </label>
          <button
            type="button"
            aria-label={viewMode === "map" ? "Siyahı görünüşünə keç" : "Xəritə görünüşünə keç"}
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode((current) => (current === "map" ? "list" : "map"))}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
          >
            <Image
              src={viewMode === "map" ? "/figma/map/filter.svg" : "/figma/home/map.svg"}
              alt=""
              width={24}
              height={24}
              className={`size-6 ${viewMode === "list" ? "brightness-0" : ""}`}
            />
          </button>
          <button
            type="button"
            aria-label="Filterləri aç"
            aria-expanded={filterOpen}
            onClick={openFilters}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
          >
            <Image src="/figma/map/setting.svg" alt="" width={24} height={24} className="size-6" />
          </button>
        </form>

        <div className="scrollbar-none flex h-[52px] gap-2 overflow-x-auto px-4 py-2">
          {CATEGORIES.map((item) => {
            const active = category === item;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCategory(item);
                  setMode({ kind: "none" });
                  setCenterRequest((value) => value + 1);
                }}
                className={`h-9 shrink-0 rounded-xl border px-3 text-[13px] leading-[18px] tracking-[-0.08px] transition active:scale-95 ${
                  active
                    ? "border-[#98ff00] bg-[#98ff00] text-black/90"
                    : "border-[#f2f2f2] bg-[#f3f5f7] text-black/90"
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="hara-map-feedback absolute left-4 z-20 rounded-full bg-white/85 px-3 py-2 text-xs text-black/55 shadow-sm">
          Tədbirlər yüklənir…
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="hara-map-feedback absolute right-4 left-4 z-20 rounded-2xl bg-white/90 p-3 text-xs text-black/65 shadow-sm">
          {error}
        </div>
      ) : null}

      {!loading && !error && visibleEvents.length === 0 ? (
        <div className="hara-map-feedback absolute right-4 left-4 z-20 rounded-2xl bg-white/90 p-3 text-xs text-black/65 shadow-sm">
          Uyğun tədbir tapılmadı.
        </div>
      ) : null}

      {viewMode === "map" && selectedEvent ? (
        <section
          className="hara-map-card-tray absolute right-0 left-0 z-30 bg-white/32 px-4 py-3 backdrop-blur-[10px]"
          aria-label="Seçilmiş tədbir"
        >
          <MapEventCard event={selectedEvent} />
        </section>
      ) : null}

      {viewMode === "map" && mode.kind === "cluster" && clusterEvents.length ? (
        <section
          className="hara-map-card-tray absolute right-0 left-0 z-30 bg-white/32 pt-3 pb-2 backdrop-blur-[10px]"
          aria-label="Yaxın tədbirlər"
        >
          <div className="scrollbar-none flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-px-4 px-4">
            {clusterEvents.slice(0, 4).map((event) => (
              <div key={event.id} className="snap-start">
                <MapEventCard event={event} compact />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-2 h-2 w-16 rounded-full bg-[#ddd]" />
        </section>
      ) : null}

      <MapFilterSheet
        open={filterOpen}
        filters={draftFilters}
        resultCount={filterResultCount}
        onChange={setDraftFilters}
        onClose={() => setFilterOpen(false)}
        onReset={resetFilters}
        onApply={applyFilters}
      />

      <MobileTabBar active="map" placement="container" />
    </main>
  );
}
