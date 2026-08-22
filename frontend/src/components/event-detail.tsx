"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { EventPoster } from "./event-poster";
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

function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;

  const normalized =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((symbol) => symbol.repeat(2))
          .join("")
      : match[1];

  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(rgb: readonly [number, number, number]) {
  return `#${rgb
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function withAlpha(color: string, alpha: number) {
  const rgb = parseHexColor(color);
  if (!rgb) return `rgba(23, 18, 32, ${alpha})`;

  const [red, green, blue] = rgb;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function usePosterColor(imageUrl: string) {
  const [color, setColor] = useState<string>(fallbackPosterColor);

  useEffect(() => {
    if (!imageUrl) {
      setColor(fallbackPosterColor);
      return;
    }

    let cancelled = false;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    const cleanup = () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      if (cancelled) return;

      try {
        const width = img.naturalWidth || 1;
        const height = img.naturalHeight || 1;
        const scale = Math.min(1, 20 / width, 20 / height);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let redTotal = 0;
        let greenTotal = 0;
        let blueTotal = 0;
        let sampleCount = 0;

        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3] / 255;
          if (alpha <= 0.1) continue;
          redTotal += data[index];
          greenTotal += data[index + 1];
          blueTotal += data[index + 2];
          sampleCount += 1;
        }

        if (!sampleCount) {
          setColor(fallbackPosterColor);
          return;
        }

        setColor(
          toHex([
            Math.round(redTotal / sampleCount),
            Math.round(greenTotal / sampleCount),
            Math.round(blueTotal / sampleCount),
          ]),
        );
      } catch (error) {
        setColor(fallbackPosterColor);
      }
    };

    img.onerror = () => {
      if (!cancelled) setColor(fallbackPosterColor);
    };

    img.src = imageUrl;

    return cleanup;
  }, [imageUrl]);

  return color;
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
  const [reservationError, setReservationError] = useState<string | null>(null);
  const attemptRef = useRef<{
    signature: string;
    attempt: OrderCheckoutAttempt;
  } | null>(null);

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
    if (state.kind !== "success" || !selectedItems.length || submitting) return;

    writeDraft(slug, quantities);
    if (authStatus !== "authenticated") {
      router.push(loginHref(`/events/${encodeURIComponent(slug)}`));
      return;
    }

    const signature = JSON.stringify(selectedItems);
    if (attemptRef.current?.signature !== signature) {
      attemptRef.current = {
        signature,
        attempt: new OrderCheckoutAttempt(createOrder),
      };
    }

    setSubmitting(true);
    setReservationError(null);
    try {
      const order = await attemptRef.current.attempt.submit(selectedItems);
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
  const posterColor = usePosterColor(safePosterUrl(event.cover_image_url) ?? "");
  const mainBackground = `linear-gradient(180deg, ${withAlpha(posterColor, 0.22)}, ${withAlpha(
    posterColor,
    0.06,
  )} 40%, #09090e 100%)`;
  const cardBackground = `linear-gradient(180deg, ${withAlpha(posterColor, 0.95)} 0%, #111118 32%, #111118 100%)`;

  return (
    <main
      className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6 sm:py-10"
      style={{ background: mainBackground, minHeight: "100dvh" }}
    >
      <Link href="/" className="inline-grid min-h-11 place-items-center rounded-xl px-2 text-sm font-semibold text-white/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]">← Tədbirlərə qayıt</Link>

      <article className="mt-3 overflow-hidden rounded-3xl border border-white/10" style={{ background: cardBackground }}>
        <EventPoster src={event.cover_image_url} title={event.title} priority className="aspect-[16/9] max-h-[430px]" posterColor={posterColor} />
        <div className="grid gap-7 p-5 sm:p-8 md:grid-cols-[1fr_280px]">
          <div>
            <span className="rounded-lg bg-[#565dd8]/20 px-2.5 py-1 text-xs font-bold text-[#aeb1ff]">{event.category.name}</span>
            <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">{event.title}</h1>
            <dl className="mt-6 space-y-4 text-sm">
              <div><dt className="font-bold text-white/35 uppercase">Başlama vaxtı</dt><dd className="mt-1 font-semibold">{formatBakuDate(event.start_at)}</dd></div>
              <div><dt className="font-bold text-white/35 uppercase">Bitmə vaxtı</dt><dd className="mt-1 font-semibold">{formatBakuDate(event.end_at)}</dd></div>
              <div>
                <dt className="font-bold text-white/35 uppercase">Məkan</dt>
                <dd className="mt-1 font-semibold">{event.venue.name}{event.venue.city ? `, ${event.venue.city}` : ""}</dd>
                <dd className="mt-1 text-white/50">{event.venue.address}</dd>
              </div>
            </dl>
            {event.description ? (
              <section className="mt-8" aria-labelledby="description-heading">
                <h2 id="description-heading" className="text-xl font-bold">Tədbir haqqında</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/65">{event.description}</p>
              </section>
            ) : null}
          </div>

          <aside className="h-fit rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-5">
            <h2 className="text-lg font-bold text-amber-100">Bilet satışı</h2>
            {event.ticket_types.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-amber-50/65">Biletlər hazırda satışda deyil.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {event.ticket_types.map((ticketType) => {
                  const quantity = quantities[ticketType.id] ?? 0;
                  const unavailableLabel =
                    ticketType.sales_status === "AVAILABLE"
                      ? null
                      : salesLabels[ticketType.sales_status];
                  return (
                    <section key={ticketType.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div><h3 className="text-sm font-bold">{ticketType.name}</h3><p className="mt-1 text-xs text-white/45">{ticketType.available_quantity} bilet qalıb</p></div>
                        <span className="text-sm font-bold text-amber-100">{formatMoney(ticketType.price, ticketType.currency)}</span>
                      </div>
                      {ticketType.is_available ? (
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-xs text-white/50">Say</span>
                          <div className="flex items-center gap-2">
                            <button type="button" aria-label={`${ticketType.name} sayını azalt`} onClick={() => setQuantity(ticketType.id, quantity - 1)} disabled={quantity === 0 || submitting} className="grid size-9 place-items-center rounded-lg bg-white/10 font-bold disabled:opacity-35">−</button>
                            <output aria-label={`${ticketType.name} sayı`} className="min-w-5 text-center text-sm font-bold">{quantity}</output>
                            <button type="button" aria-label={`${ticketType.name} sayını artır`} onClick={() => setQuantity(ticketType.id, quantity === 0 ? ticketType.min_quantity : quantity + 1)} disabled={quantity >= ticketType.max_quantity || submitting} className="grid size-9 place-items-center rounded-lg bg-white/10 font-bold disabled:opacity-35">+</button>
                          </div>
                        </div>
                      ) : <p className="mt-3 text-xs font-semibold text-amber-100/65">{unavailableLabel}</p>}
                    </section>
                  );
                })}
              </div>
            )}

            {reservationError ? <div className="mt-4"><InlineError message={reservationError} /></div> : null}
            <button
              type="button"
              onClick={handleReservation}
              disabled={!selectedItems.length || submitting || authStatus === "loading"}
              className="mt-4 min-h-12 w-full rounded-xl bg-[#98ff00] px-4 text-sm font-bold text-[#18181a] transition hover:bg-[#b0ff3d] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? "Rezervasiya edilir…" : authStatus === "authenticated" ? "Biletləri rezerv et" : "Daxil ol və rezerv et"}
            </button>
            <p className="mt-3 text-xs leading-5 text-white/40">Qiymət və mövcud say sifariş yaradılarkən backend tərəfindən yenidən yoxlanılır.</p>
          </aside>
        </div>
      </article>
    </main>
  );
}
