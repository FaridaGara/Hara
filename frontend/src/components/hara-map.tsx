"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, eventsApi, type HaraEvent } from "@/lib/api";
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
          15 AZN-dən
        </span>
      </div>
    </article>
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

  const visibleEvents = useMemo(() => {
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

  return (
    <main className="hara-home relative mx-auto h-dvh min-h-[620px] w-full max-w-[402px] overflow-hidden bg-white text-[#18181a] sm:my-6 sm:h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <div className="absolute inset-x-0 top-[116px] bottom-[92px] overflow-hidden" data-testid="map-canvas">
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

      <div className="absolute inset-x-0 top-0 z-30 flex h-[116px] flex-col drop-shadow-[0_12px_10px_rgba(0,0,0,.12)]">
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
            type="submit"
            aria-label="Xəritə filterləri"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
          >
            <Image src="/figma/map/filter.svg" alt="" width={24} height={24} className="size-6" />
          </button>
          <button
            type="button"
            aria-label="Xəritəni mərkəzlə"
            onClick={() => setCenterRequest((value) => value + 1)}
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
        <div className="absolute top-[128px] left-4 z-20 rounded-full bg-white/85 px-3 py-2 text-xs text-black/55 shadow-sm">
          Tədbirlər yüklənir…
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="absolute top-[128px] right-4 left-4 z-20 rounded-2xl bg-white/90 p-3 text-xs text-black/65 shadow-sm">
          {error}
        </div>
      ) : null}

      {!loading && !error && visibleEvents.length === 0 ? (
        <div className="absolute top-[128px] right-4 left-4 z-20 rounded-2xl bg-white/90 p-3 text-xs text-black/65 shadow-sm">
          Uyğun tədbir tapılmadı.
        </div>
      ) : null}

      {selectedEvent ? (
        <section
          className="absolute right-0 bottom-[92px] left-0 z-30 bg-white/32 px-4 py-3 backdrop-blur-[10px]"
          aria-label="Seçilmiş tədbir"
        >
          <MapEventCard event={selectedEvent} />
        </section>
      ) : null}

      {mode.kind === "cluster" && clusterEvents.length ? (
        <section
          className="absolute right-0 bottom-[92px] left-0 z-30 bg-white/32 pt-3 pb-2 backdrop-blur-[10px]"
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

      <MobileTabBar active="map" placement="container" />
    </main>
  );
}
