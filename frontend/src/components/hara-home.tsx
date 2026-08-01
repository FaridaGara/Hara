"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { ApiError, eventsApi, type HaraEvent } from "@/lib/api";
import { formatBakuDate, safePosterUrl } from "@/lib/format";

type LoadEvents = (
  filters?: { search?: string; ordering?: "start_at" },
  signal?: AbortSignal,
) => Promise<HaraEvent[]>;

type HomeState =
  | { kind: "loading" }
  | { kind: "success"; events: HaraEvent[] }
  | { kind: "error"; message: string };

const rowGradients = [
  "#4c1d95, #f97316",
  "#080b22, #f28de3",
  "#d89e65, #3b3c3d",
];

function Poster({ event, priority = false }: { event: HaraEvent; priority?: boolean }) {
  const src = safePosterUrl(event.cover_image_url);

  if (!src) {
    return (
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,#565dd8,transparent_55%),#171720]" />
    );
  }

  return (
    // Poster origins come from the API and cannot use a finite Next Image allowlist.
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

export function Header() {
  return (
    <header className="relative z-10 flex items-center justify-between gap-2 px-4 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#2c2c2c] text-xl text-white">
          M
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-base font-medium text-black/85">Salam, Monika 👋</p>
          <p className="truncate text-sm text-black/40">Bu gün nə etmək istəyirsən?</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button className="grid size-10 place-items-center rounded-full bg-[#fcfcfc]" aria-label="Sevimlilər">
          <Image src="/figma/heart.svg" alt="" width={24} height={24} />
        </button>
        <button className="relative grid size-10 place-items-center rounded-full bg-[#fcfcfc]" aria-label="Bildirişlər">
          <Image src="/figma/notification.svg" alt="" width={24} height={24} />
          <span className="absolute -top-1 -right-0.5 grid size-5 place-items-center rounded-full border border-white bg-[#ff2c3d] text-[9px] font-medium text-white">9+</span>
        </button>
      </div>
    </header>
  );
}

export function SearchBar({
  onSearch,
}: {
  onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(query.trim());
  };

  return (
    <form role="search" onSubmit={submit} className="flex gap-2.5 px-4 py-2">
      <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#fcfcfc] px-3">
        <span className="sr-only">Tədbir axtar</span>
        <Image src="/figma/search.svg" alt="" width={24} height={24} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Caz, rooftop, sərgi..."
          className="min-w-0 flex-1 bg-transparent text-[15px] text-black/70 outline-none placeholder:text-black/35"
        />
      </label>
      <button type="submit" className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#98ff00]" aria-label="Axtar">
        <Image src="/figma/filter.svg" alt="" width={24} height={24} />
      </button>
    </form>
  );
}

export function FilterChips() {
  const [active, setActive] = useState<string | null>(null);
  const chips = ["Bugün", "Həftəsonu", "Pulsuz", "Hara gedim?"];

  return (
    <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 py-2" aria-label="Sürətli filtrlər">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          aria-pressed={active === chip}
          onClick={() => setActive(active === chip ? null : chip)}
          className="min-h-9 shrink-0 rounded-[10px] border border-[#f0f0f0] bg-[#fcfcfc] px-3 text-[15px] text-black/65 aria-pressed:border-black aria-pressed:text-black"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

export function FeaturedEventCard({ event, priority = false }: { event: HaraEvent; priority?: boolean }) {
  return (
    <article className="group relative h-56 w-[81vw] max-w-[324px] shrink-0 snap-start overflow-hidden rounded-tl-3xl rounded-tr-lg rounded-br-3xl rounded-bl-lg bg-[#111] text-white">
      <Poster event={event} priority={priority} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-[rgba(12,12,16,.88)]" />
      <div className="relative flex items-center justify-between p-3">
        <span className="rounded-md bg-[#565dd8] px-2 py-1 text-xs font-bold uppercase">{event.category.name}</span>
        <span className="grid size-8 place-items-center rounded-full bg-white/15" aria-hidden="true">
          <Image src="/figma/heart.svg" alt="" width={16} height={16} className="brightness-0 invert" />
        </span>
      </div>
      <div className="absolute right-3 bottom-3 left-3">
        <h3 className="text-lg leading-5 font-bold">
          <Link href={`/events/${encodeURIComponent(event.slug)}`} className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]">
            {event.title}
          </Link>
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-white/60">{formatBakuDate(event.start_at, true)}</p>
          <span className="rounded-md bg-[#1a1a22]/80 px-2 py-0.5 text-sm font-bold text-[#777dff]">Ətraflı</span>
        </div>
      </div>
    </article>
  );
}

export function NearbyMapCard({ count }: { count: number }) {
  return (
    <section className="relative mx-4 my-2 h-[150px] overflow-hidden rounded-[20px] border border-[#e5e7eb] bg-white p-5 shadow-[0_4px_12px_rgba(0,0,0,.05)]">
      <Image src="/figma/map.png" alt="" fill sizes="370px" className="object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-white via-white/70 via-45% to-transparent to-72%" />
      <div className="relative">
        <h2 className="text-xl leading-6 font-bold">Ətrafımda nə verir baş?</h2>
        <p className="mt-1 text-sm text-black/65">Yaxında olan {count} tədbirə göz at</p>
      </div>
      <button className="absolute bottom-4 left-5 flex min-h-10 items-center gap-1 rounded-full bg-[#98ff00] px-3.5 text-base font-bold">
        Xəritədə gör
        <Image src="/figma/arrow-right.svg" alt="" width={13} height={13} />
      </button>
    </section>
  );
}

export function EventRow({ event, index }: { event: HaraEvent; index: number }) {
  const gradient = rowGradients[index % rowGradients.length];
  const src = safePosterUrl(event.cover_image_url);

  return (
    <article className="relative flex h-[72px] items-center gap-3 overflow-hidden rounded-2xl p-3 text-white shadow-[0_10px_12px_rgba(0,0,0,.1)]">
      <div
        className="event-gradient absolute inset-y-0 -left-full w-[300%]"
        style={{ backgroundImage: `linear-gradient(90deg, ${gradient}, ${gradient}, ${gradient})` }}
      />
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="relative size-[52px] shrink-0 rounded-[10px] object-cover" />
      ) : (
        <div className="relative size-[52px] shrink-0 rounded-[10px] bg-white/10" />
      )}
      <div className="relative min-w-0 flex-1">
        <h3 className="truncate text-base font-bold">
          <Link href={`/events/${encodeURIComponent(event.slug)}`} className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]">
            {event.title}
          </Link>
        </h3>
        <p className="truncate text-xs font-medium text-white/65">
          {formatBakuDate(event.start_at, true)} · {event.venue.name}
        </p>
      </div>
      <span className="relative grid h-[30px] min-w-[62px] shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 px-2 text-sm font-bold backdrop-blur-md">Ətraflı</span>
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
  const featuredEvents = featured.length ? featured : events.slice(0, 2);

  return (
    <main className="hara-home relative mx-auto min-h-screen w-full max-w-[760px] overflow-hidden bg-[#f2f2f2] pb-12 text-[#18181a]">
      <div className="pointer-events-none absolute -top-16 left-1/3 size-[300px] rounded-full bg-[radial-gradient(circle,#b8ff006b_0%,#6e54ff30_55%,transparent_72%)] blur-2xl" />
      <Header />
      <SearchBar onSearch={(query) => {
        setState({ kind: "loading" });
        if (query === search) setRetryKey((value) => value + 1);
        else setSearch(query);
      }} />
      <FilterChips />

      <section className="pt-1" aria-labelledby="featured-heading">
        <h1 id="featured-heading" className="px-4 py-3 text-[30px] leading-[42px] font-bold tracking-[-.7px] sm:text-[34px]">Bu həftə nə var?</h1>
        {state.kind === "loading" ? <p className="px-4 pb-5 text-sm text-black/45">Tədbirlər yüklənir…</p> : null}
        {state.kind === "error" ? (
          <div className="mx-4 mb-5 rounded-2xl bg-white p-4" role="alert">
            <p className="text-sm text-black/65">{state.message}</p>
            <button type="button" onClick={() => { setState({ kind: "loading" }); setRetryKey((value) => value + 1); }} className="mt-3 min-h-10 rounded-xl bg-[#18181a] px-4 text-sm font-bold text-white">Yenidən cəhd et</button>
          </div>
        ) : null}
        {state.kind === "success" && events.length === 0 ? <p className="px-4 pb-5 text-sm text-black/45">Uyğun tədbir tapılmadı.</p> : null}
        {featuredEvents.length ? (
          <div className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 touch-pan-x">
            {featuredEvents.map((event, index) => <FeaturedEventCard key={event.id} event={event} priority={index === 0} />)}
          </div>
        ) : null}
      </section>

      <NearbyMapCard count={events.length} />

      <section className="px-4 pt-2" aria-labelledby="nearby-heading">
        <h2 id="nearby-heading" className="py-3 text-xl font-bold">Yaxınlaşan tədbirlər</h2>
        <div className="flex flex-col gap-3">
          {events.map((event, index) => <EventRow key={event.id} event={event} index={index} />)}
        </div>
      </section>
    </main>
  );
}
