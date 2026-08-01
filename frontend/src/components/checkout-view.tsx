"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  ordersApi,
  paymentsApi,
  type Order,
  type Payment,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";

import { InlineError, PageLoader, StatePanel } from "./states";
import {
  isOrderPayable,
  reservationClock,
  ReservationCountdown,
} from "./reservation-countdown";

const orderStatusLabels: Record<Order["status"], string> = {
  pending: "Ödəniş gözlənilir",
  paid: "Ödənilib",
  failed: "Ödəniş uğursuzdur",
  expired: "Rezervasiya bitib",
  refunded: "Geri qaytarılıb",
  cancelled: "Ləğv edilib",
};

const paymentStatusLabels: Record<Payment["status"], string> = {
  initiated: "Payment başladılıb",
  succeeded: "Payment backend tərəfindən təsdiqlənib",
  failed: "Payment backend tərəfindən uğursuz işarələnib",
  refunded: "Payment geri qaytarılıb",
};

type CheckoutState =
  | { kind: "loading" }
  | { kind: "success"; order: Order }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export type CheckoutApis = {
  loadOrder: typeof ordersApi.detail;
  cancelOrder: typeof ordersApi.cancel;
  initiatePayment: typeof paymentsApi.initiate;
  completeSandbox: typeof paymentsApi.completeSandbox;
};

const defaultApis: CheckoutApis = {
  loadOrder: ordersApi.detail,
  cancelOrder: ordersApi.cancel,
  initiatePayment: paymentsApi.initiate,
  completeSandbox: paymentsApi.completeSandbox,
};

export function isSandboxCompletionUrl(payment: Payment) {
  if (payment.provider !== "sandbox" || !payment.checkout_url) {
    return false;
  }

  return (
    payment.checkout_url ===
    `/api/payments/sandbox/${encodeURIComponent(payment.id)}/complete/`
  );
}

export function safeProviderCheckoutUrl(value: string | null) {
  if (!value || value.startsWith("/")) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol === "https:") {
      return url.toString();
    }
    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function CheckoutView({
  orderId,
  apis = defaultApis,
}: {
  orderId: string;
  apis?: CheckoutApis;
}) {
  const [state, setState] = useState<CheckoutState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const loadOrder = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const order = await apis.loadOrder(orderId, signal);
        setState({ kind: "success", order });
        return order;
      } catch (error) {
        if (error instanceof ApiError && error.kind === "cancelled") {
          return null;
        }
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "not-found" });
          return null;
        }
        setState({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Sifariş məlumatını yükləmək mümkün olmadı.",
        });
        return null;
      }
    },
    [apis, orderId],
  );

  useEffect(() => {
    const controller = new AbortController();
    apis
      .loadOrder(orderId, controller.signal)
      .then((loadedOrder) => setState({ kind: "success", order: loadedOrder }))
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "cancelled") {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "not-found" });
          return;
        }
        setState({
          kind: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Sifariş məlumatını yükləmək mümkün olmadı.",
        });
      });
    return () => controller.abort();
  }, [apis, orderId, retryKey]);

  const order = state.kind === "success" ? state.order : null;
  const handleReservationElapsed = useCallback(() => {
    setClockNow(Date.now());
  }, []);
  const payable = useMemo(
    () => (order ? isOrderPayable(order, clockNow) : false),
    [clockNow, order],
  );
  const visuallyExpired =
    order?.status === "pending" &&
    reservationClock(order.expires_at, clockNow).expired;

  const handlePayment = async () => {
    if (!order || !payable || paymentBusy) {
      return;
    }

    setPaymentBusy(true);
    setActionError(null);
    try {
      const initiated = await apis.initiatePayment(order.id);
      setPayment(initiated);

      if (initiated.status === "succeeded" || initiated.status === "failed") {
        await loadOrder();
      } else {
        const redirectUrl = safeProviderCheckoutUrl(initiated.checkout_url);
        if (initiated.provider !== "sandbox" && redirectUrl) {
          window.location.assign(redirectUrl);
        }
      }
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Payment başlatmaq mümkün olmadı.",
      );
      await loadOrder();
    } finally {
      setPaymentBusy(false);
    }
  };

  const handleSandboxCompletion = async (result: "succeeded" | "failed") => {
    if (!payment || !isSandboxCompletionUrl(payment) || paymentBusy) {
      return;
    }

    setPaymentBusy(true);
    setActionError(null);
    try {
      const completed = await apis.completeSandbox(payment.id, result);
      setPayment(completed);
      await loadOrder();
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Sandbox payment nəticəsini təsdiqləmək mümkün olmadı.",
      );
      await loadOrder();
    } finally {
      setPaymentBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!order || !payable || cancelBusy) {
      return;
    }

    setCancelBusy(true);
    setActionError(null);
    try {
      const cancelled = await apis.cancelOrder(order.id);
      setState({ kind: "success", order: cancelled });
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "Sifarişi ləğv etmək mümkün olmadı.",
      );
      await loadOrder();
    } finally {
      setCancelBusy(false);
    }
  };

  if (state.kind === "loading") {
    return <PageLoader label="Sifariş yüklənir…" />;
  }

  if (state.kind === "not-found") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <StatePanel
          title="Sifariş tapılmadı"
          message="Bu sifariş mövcud deyil və ya başqa istifadəçiyə aiddir."
          action={
            <Link
              href="/tickets"
              className="inline-grid min-h-11 place-items-center rounded-xl bg-white px-5 text-sm font-bold text-[#18181a]"
            >
              Biletlərimə bax
            </Link>
          }
        />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        <InlineError message={state.message} />
        <button
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            setRetryKey((value) => value + 1);
          }}
          className="min-h-11 rounded-xl bg-white px-5 text-sm font-bold text-[#18181a]"
        >
          Yenidən cəhd et
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold tracking-[0.16em] text-[#98ff00] uppercase">
        Checkout
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Sifariş</h1>
        <span
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${
            state.order.status === "paid"
              ? "bg-[#98ff00]/15 text-[#b3ff43]"
              : state.order.status === "pending" && !visuallyExpired
                ? "bg-amber-300/10 text-amber-100"
                : "bg-white/10 text-white/60"
          }`}
        >
          {visuallyExpired ? "Rezervasiya bitib" : orderStatusLabels[state.order.status]}
        </span>
      </div>

      <section className="mt-6 rounded-3xl border border-white/10 bg-[#111118] p-5 sm:p-7">
        <div className="rounded-xl bg-white/[0.05] px-4 py-3 text-sm text-white/65">
          <ReservationCountdown
            expiresAt={state.order.expires_at}
            onElapsed={handleReservationElapsed}
          />
        </div>

        <ul className="mt-5 divide-y divide-white/[0.08]">
          {state.order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 py-4">
              <div>
                <Link
                  href={`/events/${encodeURIComponent(item.event_slug)}`}
                  className="font-bold hover:text-[#98ff00] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
                >
                  {item.event_title}
                </Link>
                <p className="mt-1 text-sm text-white/50">
                  {item.ticket_type_name} · {item.quantity} ədəd
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold">
                {formatMoney(item.unit_price, state.order.currency)} / ədəd
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-5">
          <span className="text-sm text-white/50">Backend totalı</span>
          <strong className="text-xl">
            {formatMoney(state.order.total_amount, state.order.currency)}
          </strong>
        </div>

        {payment ? (
          <div
            role="status"
            className="mt-5 rounded-xl border border-[#565dd8]/30 bg-[#565dd8]/10 px-4 py-3 text-sm text-[#d9daff]"
          >
            {paymentStatusLabels[payment.status]}
          </div>
        ) : null}
        {actionError ? <div className="mt-4"><InlineError message={actionError} /></div> : null}

        {state.order.status === "pending" && !visuallyExpired ? (
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={handlePayment}
              disabled={!payable || paymentBusy || cancelBusy}
              className="min-h-12 w-full rounded-xl bg-[#98ff00] px-5 font-bold text-[#18181a] hover:bg-[#b0ff3d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {paymentBusy
                ? "Backend cavabı gözlənilir…"
                : payment?.status === "initiated"
                  ? "Payment vəziyyətini yoxla"
                  : "Payment başlat"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={!payable || paymentBusy || cancelBusy}
              className="min-h-11 w-full rounded-xl border border-white/15 px-5 text-sm font-semibold text-white/65 hover:border-white/30 hover:text-white disabled:opacity-50"
            >
              {cancelBusy ? "Ləğv edilir…" : "Sifarişi ləğv et"}
            </button>
          </div>
        ) : null}

        {payment?.status === "initiated" && isSandboxCompletionUrl(payment) ? (
          <section className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
            <h2 className="font-bold text-amber-100">Development sandbox</h2>
            <p className="mt-1 text-xs leading-5 text-amber-50/55">
              Faktiki sandbox contract redirect deyil: nəticə JWT ilə POST
              sorğusu kimi backend-ə göndərilir. Webhook browser-dən çağırılmır.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleSandboxCompletion("succeeded")}
                disabled={paymentBusy}
                className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-[#18181a] disabled:opacity-50"
              >
                Uğurlu payment simulyasiyası
              </button>
              <button
                type="button"
                onClick={() => handleSandboxCompletion("failed")}
                disabled={paymentBusy}
                className="min-h-11 rounded-xl border border-white/20 px-4 text-sm font-bold disabled:opacity-50"
              >
                Uğursuz payment simulyasiyası
              </button>
            </div>
          </section>
        ) : null}

        {state.order.status === "paid" ? (
          <Link
            href="/tickets"
            className="mt-6 grid min-h-12 place-items-center rounded-xl bg-[#98ff00] px-5 font-bold text-[#18181a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Biletlərimi aç
          </Link>
        ) : null}
      </section>
    </main>
  );
}
