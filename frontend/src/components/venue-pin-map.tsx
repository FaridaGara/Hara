"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { validCoordinates } from "@/lib/event-schedule";
import { useTheme } from "./theme-provider";
import styles from "./event-wizard.module.css";

const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "";
const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID";

export function VenuePinMap({ latitude, longitude, onSelect }: {
  latitude: number | null; longitude: number | null;
  onSelect: (latitude: number, longitude: number) => void;
}) {
  const { preference } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const initial = useRef(validCoordinates(latitude, longitude) ? { lat: latitude!, lng: longitude! } : { lat: 40.4093, lng: 49.8671 });
  const selection = useRef(onSelect);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { selection.current = onSelect; }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    let marker: google.maps.marker.AdvancedMarkerElement | undefined;
    const listeners: google.maps.MapsEventListener[] = [];
    const timer = window.setTimeout(() => { if (!disposed) setStatus("error"); }, 15_000);
    async function mount() {
      try {
        const loader = await loadGoogleMaps(apiKey);
        const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([loader.importLibrary("maps"), loader.importLibrary("marker")]);
        if (disposed || !container.current) return;
        const map = new Map(container.current, {
          center: initial.current, zoom: 13, mapId, disableDefaultUI: true,
          colorScheme: preference === "system" ? "FOLLOW_SYSTEM" : preference.toUpperCase(),
          clickableIcons: false, gestureHandling: "greedy", keyboardShortcuts: true,
        });
        const pin = document.createElement("img");
        pin.src = "/figma/map/pin-music.svg"; pin.alt = ""; pin.width = 20; pin.height = 20;
        const content = document.createElement("div");
        content.className = styles.mapPin;
        content.append(pin);
        marker = new AdvancedMarkerElement({ map, position: initial.current, gmpDraggable: true, content, title: "Tədbirin giriş nöqtəsi — sürüşdürərək seç" });
        const select = (point: google.maps.LatLng | null | undefined) => {
          if (!point || !validCoordinates(point.lat(), point.lng())) return;
          const position = { lat: point.lat(), lng: point.lng() };
          initial.current = position;
          if (marker) marker.position = position;
          selection.current(position.lat, position.lng);
        };
        listeners.push(map.addListener("click", (event: google.maps.MapMouseEvent) => select(event.latLng)));
        listeners.push(marker.addListener("dragend", (event: google.maps.MapMouseEvent) => select(event.latLng)));
        window.clearTimeout(timer);
        setStatus("ready");
      } catch {
        if (!disposed) { window.clearTimeout(timer); setStatus("error"); }
      }
    }
    void mount();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      listeners.forEach((listener) => listener.remove());
      if (marker) marker.map = null;
    };
  }, [attempt, preference]);

  return <div>
    <div className={styles.venueMap}>
      <div ref={container} className={styles.mapCanvas} aria-label="Tədbirin giriş nöqtəsini xəritədə seç" />
      {status === "loading" ? <p className={styles.mapNotice} role="status">Xəritə yüklənir…</p> : null}
      {status === "error" ? <div className={styles.mapNotice} role="alert">Xəritə açılmadı. <button type="button" className={styles.retry} onClick={() => { setStatus("loading"); setAttempt((value) => value + 1); }}>Yenidən cəhd et</button></div> : null}
    </div>
    <p className={styles.hint} role="status">{validCoordinates(latitude, longitude) ? "Giriş nöqtəsi seçildi. Təsdiqləyərək məkanı əlavə et." : "Nöqtəni tədbirin girişinə gətir və təsdiqlə."}</p>
  </div>;
}
