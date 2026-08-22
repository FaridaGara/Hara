"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  eventsApi,
  ordersApi,
  type HaraEventDetail,
  type OrderCreateItem,
} from "@/lib/api";
import { formatBakuDate, formatMoney, safePosterUrl } from "@/lib/format";
import {
  OrderCheckoutAttempt,
  orderCreationError,
} from "@/lib/orders/checkout-attempt";
import { loginHref } from "@/lib/routes";

import { useAuth } from "./auth-provider";
import { InlineError, PageLoader, StatePanel } from "./states";

type EventDetailState =
  | { kind: "loading" }
  | { kind: "success"; event: HaraEventDetail }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type LoadEvent = (slug: string, signal?: AbortSignal) => Promise<HaraEventDetail>;
type CreateOrder = typeof ordersApi.create;
type Quantities = Record<number, number>;

const draftKey = (slug: string) => `hara.ticket-selection.${slug}`;

function readDraft(slug: string, event: HaraEventDetail): Quantities {
  try {
    const raw = window.sessionStorage.getItem(draftKey(slug));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      event.ticket_types.flatMap((ticketType) => {
        const value = (parsed as Record<string, unknown>)[String(ticketType.id)];
        return ticketType.is_available &&
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= ticketType.min_quantity &&
          value <= ticketType.max_quantity
          ? [[ticketType.id, value]]
          : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeDraft(slug: string, quantities: Quantities) {
  try {
    window.sessionStorage.setItem(draftKey(slug), JSON.stringify(quantities));
  } catch {
    // The selection remains available in component state for this page visit.
  }
}

const salesLabels = {
  UPCOMING: "Satış hələ başlamayıb",
  SOLD_OUT: "Biletlər bitib",
  ENDED: "Satış başa çatıb",
} as const;

const fallbackPosterColor = "#171720";
const lightPosterFallbackColor = "#ffe7cd";

type PosterTone = {
  background: string;
  isLight: boolean;
};

function toHex(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function darkenPosterColor(red: number, green: number, blue: number) {
  const strongest = Math.max(red, green, blue);
  const boost = strongest < 72 ? 1.55 : 1.08;
  const shade = 0.62;

  return `#${toHex(Math.round(red * boost * shade))}${toHex(
    Math.round(green * boost * shade),
  )}${toHex(Math.round(blue * boost * shade))}`;
}

function brightenPosterColor(red: number, green: number, blue: number) {
  const mix = 0.42;
  return `#${toHex(Math.round(red * (1 - mix) + 255 * mix))}${toHex(
    Math.round(green * (1 - mix) + 255 * mix),
  )}${toHex(Math.round(blue * (1 - mix) + 255 * mix))}`;
}

function relativeLuminance(red: number, green: number, blue: number) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function posterToneFromColor(red: number, green: number, blue: number): PosterTone {
  const isLight = relativeLuminance(red, green, blue) >= 150;
  return {
    background: isLight
      ? brightenPosterColor(red, green, blue)
      : darkenPosterColor(red, green, blue),
    isLight,
  };
}

function usePosterTone(imageUrl: string | null) {
  const [tone, setTone] = useState<PosterTone>({
    background: fallbackPosterColor,
    isLight: false,
  });

  useEffect(() => {
    if (!imageUrl) {
      setTone({ background: fallbackPosterColor, isLight: false });
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    image.onload = () => {
      if (cancelled) return;

      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;

        canvas.width = 24;
        canvas.height = 24;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let redTotal = 0;
        let greenTotal = 0;
        let blueTotal = 0;
        let samples = 0;

        for (let index = 0; index < pixels.length; index += 4) {
          const pixel = index / 4;
          const y = Math.floor(pixel / canvas.width);
          if (y < canvas.height * 0.45) continue;

          const alpha = pixels[index + 3];
          if (alpha < 32) continue;

          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const brightness = red + green + blue;
          if (brightness < 24 || brightness > 720) continue;

          redTotal += red;
          greenTotal += green;
          blueTotal += blue;
          samples += 1;
        }

        if (!samples) return;

        setTone(posterToneFromColor(redTotal / samples, greenTotal / samples, blueTotal / samples));
      } catch {
        setTone({ background: fallbackPosterColor, isLight: false });
      }
    };

    image.onerror = () => {
      if (!cancelled) setTone({ background: fallbackPosterColor, isLight: false });
    };
    image.src = imageUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [imageUrl]);

  return tone;
}

function eventDurationMinutes(event: HaraEventDetail) {
  const start = new Date(event.start_at).getTime();
  const end = new Date(event.end_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

function cheapestAvailableTicket(event: HaraEventDetail) {
  return event.ticket_types
    .filter((ticketType) => ticketType.is_available)
    .toSorted((left, right) => Number(left.price) - Number(right.price))[0];
}

function compactCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return String(value);
}

export function EventDetail({
  slug,
  loadEvent = eventsApi.detail,
  createOrder = ordersApi.create,
}: {
  slug: string;
  loadEvent?: LoadEvent;
  createOrder?: CreateOrder;
}) {
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<EventDetailState>({ kind: "loading" });
  const [quantities, setQuantities] = useState<Quantities>({});
  const [submitting, setSubmitting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const attemptRef = useRef<{
    signature: string;
    attempt: OrderCheckoutAttempt;
  } | null>(null);
  const posterTone = usePosterTone(
    state.kind === "success" ? safePosterUrl(state.event.cover_image_url) : null,
  );

  useEffect(() => {
    const controller = new AbortController();

    loadEvent(slug, controller.signal)
      .then((event) => {
        setState({ kind: "success", event });
        setQuantities(readDraft(slug, event));
      })
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "cancelled") return;
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "not-found" });
          return;
        }
        setState({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Tədbir məlumatını yükləmək mümkün olmadı.",
        });
      });

    return () => controller.abort();
  }, [loadEvent, retryKey, slug]);

  const setQuantity = (ticketTypeId: number, quantity: number) => {
    setReservationError(null);
    setQuantities((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[ticketTypeId];
      else next[ticketTypeId] = quantity;
      writeDraft(slug, next);
      return next;
    });
  };

  const selectedItems: OrderCreateItem[] =
    state.kind === "success"
      ? state.event.ticket_types.flatMap((ticketType) => {
          const quantity = quantities[ticketType.id] ?? 0;
          return quantity > 0
            ? [{ ticket_type_id: ticketType.id, quantity }]
            : [];
        })
      : [];

  const handleReservation = async () => {
    if (state.kind !== "success" || submitting) return;

    const defaultTicket = cheapestAvailableTicket(state.event);
    const checkoutItems =
      selectedItems.length > 0
        ? selectedItems
        : defaultTicket
          ? [{ ticket_type_id: defaultTicket.id, quantity: defaultTicket.min_quantity }]
          : [];
    if (!checkoutItems.length) return;

    writeDraft(slug, quantities);
    if (authStatus !== "authenticated") {
      router.push(loginHref(`/events/${encodeURIComponent(slug)}`));
      return;
    }

    const signature = JSON.stringify(checkoutItems);
    if (attemptRef.current?.signature !== signature) {
      attemptRef.current = {
        signature,
        attempt: new OrderCheckoutAttempt(createOrder),
      };
    }

    setSubmitting(true);
    setReservationError(null);
    try {
      const order = await attemptRef.current.attempt.submit(checkoutItems);
      window.sessionStorage.removeItem(draftKey(slug));
      router.push(`/checkout/${encodeURIComponent(order.id)}`);
    } catch (error) {
      const normalized = orderCreationError(error);
      setReservationError(normalized.message);

      if (
        normalized.ticketTypeId !== undefined &&
        normalized.availableQuantity !== undefined
      ) {
        const ticketTypeId = normalized.ticketTypeId;
        const availableQuantity = normalized.availableQuantity;
        setState((current) =>
          current.kind !== "success"
            ? current
            : {
                kind: "success",
                event: {
                  ...current.event,
                  ticket_types: current.event.ticket_types.map((ticketType) =>
                    ticketType.id === ticketTypeId
                      ? {
                          ...ticketType,
                          available_quantity: availableQuantity,
                          max_quantity: Math.min(
                            ticketType.max_quantity,
                            availableQuantity,
                          ),
                          is_available: availableQuantity > 0,
                          sales_status:
                            availableQuantity > 0
                              ? "AVAILABLE"
                              : "SOLD_OUT",
                        }
                      : ticketType,
                  ),
                },
              },
        );
        setQuantities((current) => {
          const nextQuantity = Math.min(
            current[ticketTypeId] ?? 0,
            availableQuantity,
          );
          const next = { ...current };
          if (nextQuantity > 0) next[ticketTypeId] = nextQuantity;
          else delete next[ticketTypeId];
          writeDraft(slug, next);
          return next;
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOrganizerFollow = async () => {
    if (state.kind !== "success" || following) return;

    if (authStatus !== "authenticated") {
      router.push(loginHref(`/events/${encodeURIComponent(slug)}`));
      return;
    }

    const organizer = state.event.organizer;
    setFollowing(true);
    try {
      if (organizer.is_followed) {
        await eventsApi.unfollowOrganizer(organizer.id);
      } else {
        await eventsApi.followOrganizer(organizer.id);
      }

      setState((current) =>
        current.kind !== "success"
          ? current
          : {
              kind: "success",
              event: {
                ...current.event,
                organizer: {
                  ...current.event.organizer,
                  is_followed: !organizer.is_followed,
                  follower_count: Math.max(
                    0,
                    current.event.organizer.follower_count +
                      (organizer.is_followed ? -1 : 1),
                  ),
                },
              },
            },
      );
    } finally {
      setFollowing(false);
    }
  };

  if (state.kind === "loading") return <PageLoader label="Tədbir yüklənir…" />;

  if (state.kind === "not-found") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <StatePanel
          title="Tədbir tapılmadı"
          message="Bu tədbir mövcud deyil və ya hazırda public yayımlanmayıb."
          action={<Link href="/" className="inline-grid min-h-11 place-items-center rounded-xl bg-white px-5 text-sm font-bold text-[#18181a]">Tədbirlərə qayıt</Link>}
        />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        <InlineError message={state.message} />
        <StatePanel
          title="Məlumat açılmadı"
          message="API bağlantısını yoxlayın və yenidən cəhd edin."
          action={<button type="button" onClick={() => { setState({ kind: "loading" }); setRetryKey((value) => value + 1); }} className="min-h-11 rounded-xl bg-white px-5 text-sm font-bold text-[#18181a]">Yenidən cəhd et</button>}
        />
      </main>
    );
  }

  const event = state.event;
  const coverSrc = safePosterUrl(event.cover_image_url);
  const photos = event.photos.flatMap((photo) => {
    const imageUrl = safePosterUrl(photo.image_url);
    return imageUrl ? [{ ...photo, image_url: imageUrl }] : [];
  }).slice(0, 4);
  const cheapestTicket = cheapestAvailableTicket(event);
  const duration = eventDurationMinutes(event);
  const footerPrice = cheapestTicket
    ? formatMoney(cheapestTicket.price, cheapestTicket.currency)
    : "Satış yoxdur";
  const canReserve =
    Boolean(cheapestTicket || selectedItems.length) && !submitting && authStatus !== "loading";
  const eventTextClass = posterTone.isLight ? "text-[color:var(--event-text)]" : "text-white";
  const eventMutedClass = posterTone.isLight ? "text-[color:var(--event-muted)]" : "text-white/66";
  const eventSubtleClass = posterTone.isLight ? "text-[color:var(--event-subtle)]" : "text-white/45";
  const eventCardClass = posterTone.isLight
    ? "border-[color:var(--event-border)] bg-[var(--event-card)]"
    : "border-white/[0.32] bg-white/[0.12]";
  const eventSoftCardClass = posterTone.isLight
    ? "border-[color:var(--event-soft-border)] bg-[var(--event-card)]"
    : "border-white/20 bg-white/10";
  const iconClass = posterTone.isLight
    ? "bg-[#565dd8]/[0.08] text-[#565dd8]"
    : "bg-[#98ff00]/[0.08] text-[#98ff00]";
  const navIconClass = posterTone.isLight
    ? "bg-black/20 text-[#111118] hover:bg-black/28"
    : "bg-white/20 text-white hover:bg-white/28";
  const footerClass = posterTone.isLight
    ? "border-black/10 bg-white/20 text-[color:var(--event-text)]"
    : "border-white/12 bg-white/20 text-white";
  const backgroundStyle = coverSrc
      ? ({
          "--event-cover": `url("${coverSrc}")`,
          "--event-bg": posterTone.background,
          "--event-text": posterTone.isLight ? "rgba(0,0,0,0.92)" : "#ffffff",
          "--event-muted": posterTone.isLight ? "rgba(0,0,0,0.66)" : "rgba(255,255,255,0.66)",
          "--event-subtle": posterTone.isLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.45)",
          "--event-card": posterTone.isLight ? "rgba(31,31,51,0.12)" : "rgba(255,255,255,0.12)",
          "--event-border": posterTone.isLight ? "rgba(17,17,24,0.32)" : "rgba(255,255,255,0.32)",
          "--event-soft-border": posterTone.isLight ? "rgba(17,17,24,0.2)" : "rgba(255,255,255,0.2)",
        } as CSSProperties & Record<string, string>)
    : ({
        "--event-bg": posterTone.isLight ? lightPosterFallbackColor : posterTone.background,
        "--event-text": posterTone.isLight ? "rgba(0,0,0,0.92)" : "#ffffff",
        "--event-muted": posterTone.isLight ? "rgba(0,0,0,0.66)" : "rgba(255,255,255,0.66)",
        "--event-subtle": posterTone.isLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.45)",
        "--event-card": posterTone.isLight ? "rgba(31,31,51,0.12)" : "rgba(255,255,255,0.12)",
        "--event-border": posterTone.isLight ? "rgba(17,17,24,0.32)" : "rgba(255,255,255,0.32)",
        "--event-soft-border": posterTone.isLight ? "rgba(17,17,24,0.2)" : "rgba(255,255,255,0.2)",
      } as CSSProperties & Record<string, string>);

  return (
    <main
      className="hara-home min-h-screen bg-[var(--event-bg)] text-white"
      style={backgroundStyle}
    >
      <article className="relative mx-auto min-h-screen w-full max-w-[402px] overflow-hidden bg-[var(--event-bg)] pb-[calc(116px+var(--hara-safe-bottom))] shadow-2xl shadow-black/30">
        {coverSrc ? (
          <div
            aria-hidden
            className="absolute inset-0 scale-125 bg-cover bg-center opacity-[0.9] blur-3xl [background-image:var(--event-cover)]"
          />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.34)_38%,var(--event-bg)_58%)]" />

        <section className="relative h-[402px] overflow-hidden rounded-b-[32px]">
          {coverSrc ? (
            // Event posters may be hosted on arbitrary API-configured origins.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc}
              alt={`${event.title} posteri`}
              loading="eager"
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[#171720] px-6 text-center text-sm font-semibold text-white/35">
              Poster yoxdur
            </div>
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0)_48%,var(--event-bg)_100%)]" />
          <nav className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[calc(16px+var(--hara-safe-top))]">
            <Link
              href="/"
              aria-label="Tədbirlərə qayıt"
              className={`grid size-10 place-items-center rounded-full text-[24px] leading-none backdrop-blur-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${navIconClass}`}
            >
              ‹
            </Link>
            <button
              type="button"
              aria-label="Sevimlilərə əlavə et"
              className={`grid size-10 place-items-center rounded-full text-[22px] leading-none backdrop-blur-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${navIconClass}`}
            >
              ♡
            </button>
          </nav>
          <div className="absolute inset-x-0 bottom-0 px-4 pb-4">
            <h1 className={`text-[28px] leading-[34px] font-bold tracking-[0.01em] ${eventTextClass}`}>
              {event.title}
            </h1>
            <p className={`mt-1 text-[13px] leading-[18px] ${eventMutedClass}`}>
              {formatBakuDate(event.start_at, true).replace(" •", ",")}
            </p>
          </div>
        </section>

        <div className="relative space-y-8 px-4 pt-4">
          <section className={`rounded-2xl border p-3 backdrop-blur-sm ${eventCardClass}`}>
            <div className="flex gap-3">
              <div className={`grid size-8 shrink-0 place-items-center rounded-full ${iconClass}`}>
                ⊙
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-[12px] leading-4 ${eventMutedClass}`}>Məkan</p>
                <p className={`mt-1 text-[13px] leading-[18px] font-semibold ${eventTextClass}`}>
                  {event.venue.name}
                </p>
                <p className={`text-[13px] leading-[18px] ${eventMutedClass}`}>
                  {[event.venue.address, event.venue.city].filter(Boolean).join(", ")}
                </p>
              </div>
              {event.venue.latitude !== null && event.venue.longitude !== null ? (
                <Link
                  href={`/map?event=${encodeURIComponent(event.slug)}`}
                  className="h-8 shrink-0 rounded-lg bg-[#565dd8]/[0.35] px-3 text-[12px] leading-8 font-medium text-white"
                >
                  Xəritədə bax
                </Link>
              ) : null}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2">
            <section className={`rounded-2xl border p-3 backdrop-blur-sm ${eventCardClass}`}>
              <div className="flex items-center gap-3">
                <div className={`grid size-8 shrink-0 place-items-center rounded-full ${iconClass}`}>
                  ▣
                </div>
                <div>
                  <p className={`text-[12px] leading-4 ${eventMutedClass}`}>Yaş həddi</p>
                  <p className={`mt-1 text-[15px] leading-5 font-semibold ${eventTextClass}`}>6+</p>
                </div>
              </div>
            </section>
            <section className={`rounded-2xl border p-3 backdrop-blur-sm ${eventCardClass}`}>
              <div className="flex items-center gap-3">
                <div className={`grid size-8 shrink-0 place-items-center rounded-full ${iconClass}`}>
                  ◷
                </div>
                <div>
                  <p className={`text-[12px] leading-4 ${eventMutedClass}`}>Müddət</p>
                  <p className={`mt-1 text-[15px] leading-5 font-semibold ${eventTextClass}`}>
                    {duration ? `${duration} dəqiqə` : "Məlum deyil"}
                  </p>
                </div>
              </div>
            </section>
          </div>

          {event.description ? (
            <section aria-labelledby="description-heading">
              <h2 id="description-heading" className={`text-[12px] leading-4 ${eventMutedClass}`}>
                Tədbir haqqında
              </h2>
              <p className={`mt-3 whitespace-pre-wrap text-[13px] leading-[18px] ${eventTextClass}`}>
                {event.description}
              </p>
            </section>
          ) : null}

          {photos.length > 0 ? (
            <section aria-labelledby="photos-heading">
              <h2 id="photos-heading" className={`text-[12px] leading-4 ${eventMutedClass}`}>
                Fotolar
              </h2>
              <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    className="relative h-[76px] w-20 shrink-0 overflow-hidden rounded-lg bg-black/10"
                  >
                    {/* Event gallery image hosts are controlled through the API. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.image_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className={`rounded-2xl border p-3 ${eventCardClass}`}>
            <div className="flex items-start gap-3">
              <div className="relative size-8 shrink-0 overflow-hidden rounded-full bg-black/10">
                {safePosterUrl(event.organizer.avatar_url) ? (
                  // Organizer avatar hosts are controlled through the API.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={safePosterUrl(event.organizer.avatar_url) ?? ""}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className={`grid h-full w-full place-items-center text-[13px] font-semibold ${eventTextClass}`}>
                    {event.organizer.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-[12px] leading-4 ${eventMutedClass}`}>Təşkilatçı</p>
                <p className={`mt-1 truncate text-[13px] leading-[18px] font-semibold ${eventTextClass}`}>
                  {event.organizer.name}
                </p>
                <p className={`text-[13px] leading-[18px] ${eventMutedClass}`}>
                  {compactCount(event.organizer.event_count)} tədbir · {compactCount(event.organizer.follower_count)} izləyici
                </p>
              </div>
              <button
                type="button"
                onClick={handleOrganizerFollow}
                disabled={following || authStatus === "loading"}
                className="h-6 shrink-0 rounded-lg bg-[#565dd8] px-2 text-[12px] leading-6 text-white disabled:opacity-55"
              >
                {event.organizer.is_followed ? "İzlənilir" : "İzlə"}
              </button>
            </div>
          </section>

          <section aria-labelledby="tickets-heading">
            <h2 id="tickets-heading" className={`text-[12px] leading-4 ${eventMutedClass}`}>
              Biletlər
            </h2>
            {event.ticket_types.length === 0 ? (
              <p className={`mt-2 text-[13px] leading-[18px] ${eventMutedClass}`}>
                Biletlər hazırda satışda deyil.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {event.ticket_types.map((ticketType) => {
                  const quantity = quantities[ticketType.id] ?? 0;
                  const unavailableLabel =
                    ticketType.sales_status === "AVAILABLE"
                      ? null
                      : salesLabels[ticketType.sales_status];
                  return (
                    <section
                      key={ticketType.id}
                      className={`rounded-2xl border p-3 ${eventSoftCardClass}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className={`text-[13px] leading-[18px] font-semibold ${eventTextClass}`}>
                            {ticketType.name}
                          </h3>
                          <p className={`mt-1 text-[12px] leading-4 ${eventSubtleClass}`}>
                            {ticketType.available_quantity} bilet qalıb
                          </p>
                        </div>
                        <span className={`shrink-0 text-[13px] leading-[18px] font-semibold ${eventTextClass}`}>
                          {formatMoney(ticketType.price, ticketType.currency)}
                        </span>
                      </div>
                      {ticketType.is_available ? (
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className={`text-[12px] leading-4 ${eventSubtleClass}`}>Say</span>
                          <div className="flex items-center gap-2">
                            <button type="button" aria-label={`${ticketType.name} sayını azalt`} onClick={() => setQuantity(ticketType.id, quantity - 1)} disabled={quantity === 0 || submitting} className={`grid size-9 place-items-center rounded-lg bg-white/10 font-bold disabled:opacity-35 ${eventTextClass}`}>−</button>
                            <output aria-label={`${ticketType.name} sayı`} className={`min-w-5 text-center text-[13px] font-bold ${eventTextClass}`}>{quantity}</output>
                            <button type="button" aria-label={`${ticketType.name} sayını artır`} onClick={() => setQuantity(ticketType.id, quantity === 0 ? ticketType.min_quantity : quantity + 1)} disabled={quantity >= ticketType.max_quantity || submitting} className={`grid size-9 place-items-center rounded-lg bg-white/10 font-bold disabled:opacity-35 ${eventTextClass}`}>+</button>
                          </div>
                        </div>
                      ) : <p className={`mt-3 text-[12px] font-semibold ${eventMutedClass}`}>{unavailableLabel}</p>}
                    </section>
                  );
                })}
              </div>
            )}
            {reservationError ? <div className="mt-4"><InlineError message={reservationError} /></div> : null}
          </section>
        </div>

        <div className={`fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[402px] border-t px-4 pt-4 pb-[calc(16px+var(--hara-safe-bottom))] backdrop-blur-xl ${footerClass}`}>
          <div className="flex items-center gap-4">
            <p className="min-w-0 flex-1 text-[22px] leading-7 font-bold tracking-[-0.01em]">
              {footerPrice}
            </p>
            <button
              type="button"
              onClick={handleReservation}
              disabled={!canReserve}
              aria-label={authStatus === "authenticated" ? "Biletləri rezerv et" : "Daxil ol və rezerv et"}
              className="h-12 shrink-0 rounded-2xl bg-[#565dd8] px-5 text-[16px] leading-[21px] font-semibold text-white transition hover:bg-[#666de4] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? "Gözlə" : "Bilet al"}
            </button>
          </div>
        </div>
      </article>
    </main>
  );
}
