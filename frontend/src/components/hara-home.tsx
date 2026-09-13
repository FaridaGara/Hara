"use client";
import { NotificationLink } from "./notifications";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import {
  ApiError,
  eventsApi,
  type HaraEvent,
  type EventListFilters,
} from "@/lib/api";
import { formatBakuDate, safeEventImageUrl } from "@/lib/format";

import { eventPrice, eventPriceValue, isNearby, matchesPeriod, type Coordinates, type DiscoveryPeriod } from "@/lib/event-discovery";

import { useAuth } from "./auth-provider";
import { useFavorites } from "./favorites-provider";
import { MobileTabBar } from "./mobile-tab-bar";
import { HomeAddButton } from "./home-add-button";

type LoadEvents = (
  filters?: EventListFilters,
  signal?: AbortSignal,
) => Promise<HaraEvent[]>;

type HomeState =
  | { kind: "loading" }
  | { kind: "success"; events: HaraEvent[] }
  | { kind: "error"; message: string };

function EventImage({
  event,
  fallback,
  priority = false,
}: {
  event: HaraEvent;
  fallback: string;
  priority?: boolean;
}) {
  const src = safeEventImageUrl(event.cover_image_url) ?? fallback;

  return (
    // API poster origins are intentionally unrestricted, so a finite Next Image allowlist is not possible.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={(error) => { error.currentTarget.onerror = null; error.currentTarget.src = fallback; }}
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

function FavoriteButton({
  event,
  light = false,
  compact = false,
}: {
  event: HaraEvent;
  light?: boolean;
  compact?: boolean;
}) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const selected = isFavorite(event.id);

  return (
    <button
      type="button"
      aria-label={selected ? "Sevimlilərdən çıxar" : "Sevimlilərə əlavə et"}
      aria-pressed={selected}
      onClick={(clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        void toggleFavorite(event);
      }}
      className={`relative z-10 grid shrink-0 place-items-center rounded-full transition active:scale-95 ${
        selected
          ? light
            ? "size-8 bg-white/18"
            : compact
              ? "size-8 bg-transparent"
              : "size-10 bg-[var(--hara-surface)]"
          : light
          ? "size-8 bg-white/12"
          : compact
            ? "size-8 bg-transparent"
            : "size-10 bg-[var(--hara-surface)]"
      }`}
    >
      {selected ? (
        <span className={`${compact || light ? "text-[19px]" : "text-[27px]"} leading-none text-[#ff2c3d]`} aria-hidden="true">
          ♥
        </span>
      ) : light ? (
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
  const { status, user } = useAuth();
  const { favorites } = useFavorites();
  const profileName = user?.first_name?.trim() || user?.display_name?.trim().split(/\s+/)[0];
  const greeting = status === "authenticated" && profileName ? `Salam, ${profileName} 👋` : "Salam!";

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
            {greeting}
          </p>
          <p className="truncate text-[13px] leading-[18px] tracking-[-0.08px] text-[var(--hara-muted)]">
            Bu gün nə etmək istəyirsən?
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href="/favorites"
          aria-label="Sevimlilər"
          className="relative grid size-10 shrink-0 place-items-center rounded-full bg-[var(--hara-surface)] transition active:scale-95"
        >
          <AdaptiveIcon
            lightSrc="/figma/home/heart-dark.svg"
            darkSrc="/figma/home-dark/header-heart.svg"
            size={24}
          />
          {favorites.length ? (
            <span className="absolute -top-1 -right-0.5 grid size-5 place-items-center rounded-full border border-[var(--hara-badge-border)] bg-[#ff2c3d] text-[9px] leading-3 font-medium text-white">
              {favorites.length > 9 ? "9+" : favorites.length}
            </span>
          ) : null}
        </Link>
        <NotificationLink>
          <AdaptiveIcon
            lightSrc="/figma/home/notification.svg"
            darkSrc="/figma/home-dark/notification.svg"
            size={24}
          />
        </NotificationLink>
      </div>
    </header>
  );
}

export function SearchBar({ onSearch, onFilter, filterOpen, filterCount = 0 }: {
  onSearch: (query: string) => void;
  onFilter: () => void;
  filterOpen: boolean;
  filterCount?: number;
}) {
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); onSearch(query.trim()); };
  return (
    <form role="search" onSubmit={submit} className="flex h-[72px] gap-2 px-4 py-3">
      <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-3xl bg-[var(--hara-surface)] px-3 focus-within:ring-2 focus-within:ring-[#565dd8]">
        <button type="submit" aria-label="Axtar" className="grid size-8 shrink-0 place-items-center">
          <Image src="/figma/home/search.svg" alt="" width={24} height={24} />
        </button>
        <label htmlFor="home-search" className="sr-only">Tədbir axtar</label>
        <input id="home-search" type="search" value={query}
          onChange={(event) => { const value = event.target.value; setQuery(value); if (!value.trim()) onSearch(""); }}
          placeholder="Caz, rooftop, sərgi..."
          className="min-w-0 flex-1 bg-transparent text-[15px] leading-5 text-[var(--hara-secondary)] outline-none placeholder:text-[var(--hara-muted)]" />
      </div>
      <button type="button" aria-label="Filterləri aç" aria-expanded={filterOpen} aria-controls="home-filters" onClick={onFilter}
        className="relative grid size-12 shrink-0 place-items-center rounded-full bg-[var(--hara-surface)] focus-visible:outline-2 focus-visible:outline-[#565dd8]">
        <AdaptiveIcon lightSrc="/figma/home/filter.svg" darkSrc="/figma/home-dark/filter.svg" size={24} />
        {filterCount > 0 ? <span className="absolute right-0 top-0 rounded-full bg-[#565dd8] px-1.5 text-xs text-white">{filterCount}</span> : null}
      </button>
    </form>
  );
}

export function FeaturedEventCard({
  event,
  priority = false,
}: {
  event: HaraEvent;
  index: number;
  priority?: boolean;
}) {
  return (
    <article className="relative h-[200px] w-[324px] shrink-0 snap-start overflow-hidden rounded-tl-3xl rounded-tr-lg rounded-br-3xl rounded-bl-lg bg-[#111] text-white">
      <EventImage event={event} fallback="/figma/home/hara-logo-32.svg" priority={priority} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-[rgba(12,12,16,.85)]" />
      <div className="relative flex items-center justify-between p-3">
        <span className="rounded-lg bg-[#565dd8]/20 px-2 py-1 text-xs leading-4 text-white">
          {event.category.name}
        </span>
        <FavoriteButton event={event} light />
      </div>
      <Link href={`/events/${encodeURIComponent(event.slug)}`} aria-label={event.title} className="absolute inset-0 z-[1] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#98ff00]" />
      <div className="pointer-events-none absolute right-3 bottom-3 left-3">
        <h2 className="line-clamp-2 text-[20px] leading-[25px] font-semibold tracking-[-0.45px]">{event.title}</h2>
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

export function NearbyMapCard({ loadEvents = eventsApi.list }: { loadEvents?: LoadEvents }) {
  const [state, setState] = useState<HomeState>({ kind: "loading" });
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!position) return;
    const controller = new AbortController();
    loadEvents({ ordering: "start_at", upcoming: true }, controller.signal)
      .then((events) => {
        if (!controller.signal.aborted) setState({ kind: "success", events });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error", message: "Tədbir məlumatları əlçatan deyil" });
      });
    return () => controller.abort();
  }, [loadEvents, position]);
  const count = position && state.kind === "success"
    ? state.events.filter((event) => matchesPeriod(event, "all") && isNearby(event, position)).length : null;
  const mapHref = position ? `/map?lat=${position.latitude}&lon=${position.longitude}&radius=5` : "/map";
  const locate = () => {
    if (locating) return;
    if (!navigator.geolocation) { setError("Bu cihaz məkan məlumatını dəstəkləmir."); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(
      ({coords}) => { setState({ kind: "loading" }); setPosition({latitude: coords.latitude, longitude: coords.longitude}); setLocating(false); },
      () => { setError("Məkan müəyyən edilmədi. İcazəni yoxlayıb yenidən cəhd edin."); setLocating(false); },
      {timeout: 10000, maximumAge: 60000},
    );
  };
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
        <div className="relative">
          <h2 id="map-heading" className="text-[18px] leading-6 font-bold text-[#18181a] min-[360px]:text-[20px]">
            Ətrafımda nə verir baş?
          </h2>
          <p role="status" className="mt-1 max-w-[280px] text-xs leading-4 text-black/65">{!position ? "Yaxın tədbirləri tapmaq üçün məkanını seç" : state.kind === "loading" ? "Tədbirlər yüklənir…" : state.kind === "error" ? state.message : `5 km radiusda ${count} tədbir tapıldı`}</p>
        </div>
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-2">
        <Link
          href={mapHref}
          className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-[#98ff00] px-3 text-sm font-bold text-[#18181a] transition active:scale-95"
        >
          Xəritədə gör
          <Image src="/figma/home/arrow-right.svg" alt="" width={13} height={13} />
        </Link>
        <button type="button" disabled={locating} onClick={locate} className="min-h-9 rounded-full bg-white/95 px-3 py-2 text-xs font-semibold text-[#4e55c5] disabled:opacity-50">{locating ? "Axtarılır…" : position ? "Məkanı yenilə" : "Məkanımı seç"}</button>
        </div>
      </div>
      {error ? <p role="alert" className="pt-2 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </section>
  );
}

export function EventRow({ event }: { event: HaraEvent; index: number }) {
  return (
    <article className="relative flex h-[136px] gap-3 overflow-hidden">
      <div className="relative size-[120px] shrink-0 overflow-hidden rounded-3xl bg-[#111]">
        <EventImage event={event} fallback="/figma/home/hara-logo-32.svg" />
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
          <FavoriteButton event={event} compact />
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [period, setPeriod] = useState<DiscoveryPeriod>("all");
  const [price, setPrice] = useState("all");
  const [categories, setCategories] = useState<HaraEvent["category"][]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<HomeState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadEvents(
      { ordering: "start_at", upcoming: true, ...(search ? { search } : {}) },
      controller.signal,
    )
      .then((events) => {
        if (controller.signal.aborted) return;
        setState({ kind: "success", events });
        setCategories((previous) => [...new Map([...previous, ...events.map((event) => event.category)].map((item) => [item.slug, item])).values()]);
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof ApiError && error.kind === "cancelled")) return;
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Tədbirləri yükləmək mümkün olmadı.",
        });
      });
    return () => controller.abort();
  }, [loadEvents, retryKey, search]);

  const allEvents = state.kind === "success" ? state.events.filter((event) => matchesPeriod(event, "all", now)) : [];
  const events = allEvents.filter((event) => {
    const amount = eventPriceValue(event);
    return (!category || event.category.slug === category) && matchesPeriod(event, period, now) &&
      (price === "all" || (amount !== null && (price === "free" ? amount === 0 : amount > 0)));
  });
  const weeklyEvents = events.filter((event) => matchesPeriod(event, "week", now));
  const filterCount = Number(Boolean(category)) + Number(period !== "all") + Number(price !== "all");
  const featured = events.filter((event) => event.is_featured);
  const featuredEvents = [...featured, ...events.filter((event) => !event.is_featured)];

  const searchAgain = (query: string) => {
    setState({ kind: "loading" });
    if (query === search) setRetryKey((value) => value + 1);
    else setSearch(query);
  };

  return (
    <main className="hara-home relative mx-auto min-h-dvh w-full max-w-[402px] overflow-x-hidden pb-[calc(150px+var(--hara-safe-bottom))] transition-colors sm:my-6 sm:min-h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <Header />
      <SearchBar onSearch={searchAgain} onFilter={() => setFilterOpen((open) => !open)} filterOpen={filterOpen} filterCount={filterCount} />
      {filterOpen ? <section id="home-filters" aria-label="Tədbir filtrləri" className="mx-4 mb-3 grid gap-3 rounded-2xl bg-[var(--hara-surface)] p-4 text-sm text-[var(--hara-primary)]">
        <label className="grid gap-1">Kateqoriya<select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-11 rounded-xl bg-[var(--hara-surface)] px-3"><option value="">Hamısı</option>{categories.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        <label className="grid gap-1">Tarix<select value={period} onChange={(event) => setPeriod(event.target.value as DiscoveryPeriod)} className="min-h-11 rounded-xl bg-[var(--hara-surface)] px-3"><option value="all">Bütün gələcək tədbirlər</option><option value="today">Bu gün</option><option value="week">Bu həftə</option><option value="month">Bu ay</option></select></label>
        <label className="grid gap-1">Bilet qiyməti<select value={price} onChange={(event) => setPrice(event.target.value)} className="min-h-11 rounded-xl bg-[var(--hara-surface)] px-3"><option value="all">Hamısı</option><option value="free">Ödənişsiz</option><option value="paid">Ödənişli</option></select></label>
        <div className="flex gap-3"><button type="button" onClick={() => { setCategory(""); setPeriod("all"); setPrice("all"); }} className="min-h-11 flex-1 rounded-xl border border-[#565dd8] px-3">Filterləri sıfırla</button><button type="button" onClick={() => setFilterOpen(false)} className="min-h-11 flex-1 rounded-xl bg-[#565dd8] px-3 text-white">Nəticələri göstər</button></div>
        <p role="status">{events.length} tədbir tapıldı</p>
      </section> : null}

      <section className="flex flex-col gap-3 py-3" aria-labelledby="featured-heading">
        <h1 id="featured-heading" className="px-4 text-[30px] leading-[37px] font-bold tracking-[0.4px] text-[var(--hara-primary)] min-[360px]:text-[34px] min-[360px]:leading-[41px]">
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

      <NearbyMapCard loadEvents={loadEvents} />

      <section id="weekly-events" className="flex flex-col gap-3 px-4 py-3" aria-labelledby="weekly-heading">
        <h2 id="weekly-heading" className="text-[20px] leading-[25px] font-semibold tracking-[-0.45px] text-[var(--hara-primary)]">
          Bu həftə nə var?
        </h2>
        {state.kind === "success" && weeklyEvents.length === 0 ? <p className="py-4 text-sm text-[var(--hara-muted)]">Bu həftə üçün uyğun tədbir yoxdur.</p> : null}
        <div className="flex flex-col gap-3">
          {weeklyEvents.map((event, index) => (
            <EventRow key={event.id} event={event} index={index} />
          ))}
        </div>
      </section>

      <HomeAddButton />
      <MobileTabBar active="home" theme="adaptive" />
    </main>
  );
}
