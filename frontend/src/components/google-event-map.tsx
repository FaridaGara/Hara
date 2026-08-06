"use client";

import { useEffect, useRef, useState } from "react";

import type { HaraEvent } from "@/lib/api";

const BAKU_CENTER = { lat: 40.4093, lng: 49.8671 };
const DEFAULT_ZOOM = 12;

type GoogleEventMapProps = {
  apiKey: string;
  mapId: string;
  events: HaraEvent[];
  selectedEventId: string | null;
  centerRequest: number;
  onSelectEvent: (event: HaraEvent) => void;
  onSelectCluster: (events: HaraEvent[]) => void;
};

type MapStatus = "loading" | "ready" | "error";

let configuredApiKey: string | null = null;

export function eventCoordinates(event: HaraEvent) {
  const { latitude, longitude } = event.venue;

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { lat: latitude, lng: longitude };
}

function markerGlyph(event: HaraEvent) {
  const category = `${event.category.name} ${event.category.slug}`.toLocaleLowerCase("az");

  if (category.includes("music") || category.includes("musiqi")) {
    return "/figma/map/pin-music.svg";
  }
  if (category.includes("idman") || category.includes("sport")) {
    return "/figma/map/pin-weight.svg";
  }
  if (category.includes("workshop") || category.includes("təlim") || category.includes("telim")) {
    return "/figma/map/pin-briefcase.svg";
  }
  if (category.includes("teatr") || category.includes("theatre") || category.includes("theater")) {
    return "/figma/map/pin-game.svg";
  }

  return "/figma/map/pin-routing.svg";
}

function createEventMarkerContent(event: HaraEvent, selected: boolean) {
  const content = document.createElement("div");
  content.className =
    "grid size-9 place-items-center rounded-full border-2 border-white shadow-[0_2px_10px_rgba(0,0,0,.28)] transition-transform";
  content.style.background = selected ? "#6cb500" : "#565dd8";
  content.style.transform = selected ? "scale(1.08)" : "scale(1)";
  content.setAttribute("aria-hidden", "true");

  const glyph = document.createElement("img");
  glyph.src = markerGlyph(event);
  glyph.alt = "";
  glyph.width = 18;
  glyph.height = 18;
  content.append(glyph);

  return content;
}

function createClusterContent(count: number) {
  const content = document.createElement("div");
  content.className =
    "grid size-10 place-items-center rounded-full border-2 border-[#cfd2ff] bg-[#787de0] text-xs font-semibold text-white shadow-[0_2px_12px_rgba(0,0,0,.3)]";
  content.textContent = count > 9 ? "9+" : String(count);
  content.setAttribute("aria-hidden", "true");
  return content;
}

export function GoogleEventMap({
  apiKey,
  mapId,
  events,
  selectedEventId,
  centerRequest,
  onSelectEvent,
  onSelectCluster,
}: GoogleEventMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRecordsRef = useRef(
    new globalThis.Map<
      string,
      { marker: google.maps.marker.AdvancedMarkerElement; content: HTMLDivElement }
    >(),
  );
  const selectedEventIdRef = useRef(selectedEventId);
  const positionsRef = useRef<google.maps.LatLngLiteral[]>([]);
  const fittedEventsRef = useRef("");
  const onSelectEventRef = useRef(onSelectEvent);
  const onSelectClusterRef = useRef(onSelectCluster);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    selectedEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  useEffect(() => {
    onSelectEventRef.current = onSelectEvent;
    onSelectClusterRef.current = onSelectCluster;
  }, [onSelectCluster, onSelectEvent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    import("@googlemaps/js-api-loader")
      .then(async (loader) => {
        if (configuredApiKey && configuredApiKey !== apiKey) {
          throw new Error("Google Maps API artıq başqa açarla başladılıb.");
        }

        if (!configuredApiKey) {
          loader.setOptions({
            key: apiKey,
            v: "weekly",
            language: "az",
            region: "AZ",
          });
          configuredApiKey = apiKey;
        }

        const { Map } = await loader.importLibrary("maps");
        await loader.importLibrary("marker");
        if (cancelled) return;

        mapRef.current = new Map(container, {
          center: BAKU_CENTER,
          zoom: DEFAULT_ZOOM,
          mapId,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          keyboardShortcuts: true,
        });
        setStatus("ready");
        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      mapRef.current = null;
    };
  }, [apiKey, mapId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    let disposed = false;
    let cleanup = () => {};

    Promise.all([import("@googlemaps/js-api-loader"), import("@googlemaps/markerclusterer")]).then(
      async ([loader, clustererLibrary]) => {
        const { AdvancedMarkerElement } = await loader.importLibrary("marker");
        if (disposed) return;

        const markerEvents = new globalThis.Map<google.maps.marker.AdvancedMarkerElement, HaraEvent>();
        const positions: google.maps.LatLngLiteral[] = [];
        const markers = events.flatMap((event) => {
          const position = eventCoordinates(event);
          if (!position) return [];

          positions.push(position);
          const selected = event.id === selectedEventIdRef.current;
          const content = createEventMarkerContent(event, selected);
          const marker = new AdvancedMarkerElement({
            position,
            title: event.title,
            gmpClickable: true,
            content,
            zIndex: selected ? 1000 : 1,
          });
          marker.addListener("click", () => {
            onSelectEventRef.current(event);
            map.panTo(position);
            if ((map.getZoom() ?? DEFAULT_ZOOM) < 14) {
              map.setZoom(14);
            }
          });
          markerEvents.set(marker, event);
          markerRecordsRef.current.set(event.id, { marker, content });
          return [marker];
        });

        positionsRef.current = positions;
        const clusterer = new clustererLibrary.MarkerClusterer({
          map,
          markers,
          renderer: {
            render: ({ count, position }) =>
              new AdvancedMarkerElement({
                position,
                title: `${count} yaxın tədbir`,
                gmpClickable: true,
                content: createClusterContent(count),
                zIndex: 1000 + count,
              }),
          },
          onClusterClick: (_event, cluster, activeMap) => {
            const clusterEvents = cluster.markers.flatMap((marker) => {
              const event = markerEvents.get(marker as google.maps.marker.AdvancedMarkerElement);
              return event ? [event] : [];
            });
            onSelectClusterRef.current(clusterEvents);
            if (cluster.bounds) {
              activeMap.fitBounds(cluster.bounds, {
                top: 130,
                right: 32,
                bottom: 220,
                left: 32,
              });
            }
          },
        });

        const eventSignature = events
          .map((event) => {
            const position = eventCoordinates(event);
            return position ? `${event.id}:${position.lat}:${position.lng}` : event.id;
          })
          .join("|");

        if (positions.length && fittedEventsRef.current !== eventSignature) {
          fittedEventsRef.current = eventSignature;
          const bounds = new google.maps.LatLngBounds();
          positions.forEach((position) => bounds.extend(position));

          if (positions.length === 1) {
            map.setCenter(positions[0]);
            map.setZoom(14);
          } else {
            map.fitBounds(bounds, { top: 32, right: 32, bottom: 170, left: 32 });
          }
        }

        cleanup = () => {
          clusterer.clearMarkers();
          clusterer.setMap(null);
          markers.forEach((marker) => {
            marker.map = null;
          });
          markerRecordsRef.current.clear();
        };
      },
    );

    return () => {
      disposed = true;
      cleanup();
    };
  }, [events, mapReady]);

  useEffect(() => {
    markerRecordsRef.current.forEach(({ marker, content }, eventId) => {
      const selected = eventId === selectedEventId;
      content.style.background = selected ? "#6cb500" : "#565dd8";
      content.style.transform = selected ? "scale(1.08)" : "scale(1)";
      marker.zIndex = selected ? 1000 : 1;
    });
  }, [selectedEventId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !centerRequest) return;

    if (!positionsRef.current.length) {
      map.setCenter(BAKU_CENTER);
      map.setZoom(DEFAULT_ZOOM);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    positionsRef.current.forEach((position) => bounds.extend(position));
    map.fitBounds(bounds, { top: 32, right: 32, bottom: 170, left: 32 });
  }, [centerRequest]);

  const mappedEventCount = events.filter(eventCoordinates).length;

  return (
    <div className="absolute inset-0 bg-[url('/figma/map/map-close.png')] bg-cover bg-center">
      <div
        ref={containerRef}
        data-testid="google-map"
        aria-label="Google Maps üzərində Bakı tədbirləri"
        className="absolute inset-0"
      />

      {status === "loading" ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-2 text-xs text-black/60 shadow-sm">
          Google Maps yüklənir…
        </div>
      ) : null}

      {status === "error" ? (
        <div role="alert" className="absolute top-3 right-4 left-4 rounded-2xl bg-white/95 p-3 text-xs text-black/65 shadow-sm">
          Google Maps yüklənmədi. Xəritə açarını və domen məhdudiyyətini yoxlayın.
        </div>
      ) : null}

      {status === "ready" && events.length > 0 && mappedEventCount === 0 ? (
        <div className="absolute top-3 right-4 left-4 rounded-2xl bg-white/95 p-3 text-xs text-black/65 shadow-sm">
          Bu tədbirlərin məkan koordinatları daxil edilməyib.
        </div>
      ) : null}
    </div>
  );
}
