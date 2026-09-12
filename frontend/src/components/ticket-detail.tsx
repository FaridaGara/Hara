"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, ticketsApi, type Ticket } from "@/lib/api";
import { formatBakuDate, safeEventImageUrl } from "@/lib/format";
import { LifecyclePage, LifecycleLoading, LifecycleState, Notice } from "./lifecycle-ui";
import css from "./lifecycle-ui.module.css";

type LoadTicket = (ticketId: string, signal?: AbortSignal) => Promise<Ticket>;
type DetailState = { kind: "loading" } | { kind: "success"; ticket: Ticket } | { kind: "not-found" } | { kind: "error"; message: string };

export function TicketDetail({ ticketId, loadTicket = ticketsApi.detail }: { ticketId: string; loadTicket?: LoadTicket }) {
  // Changing tickets remounts the request state so another ticket can never flash here.
  return <TicketContent key={ticketId} ticketId={ticketId} loadTicket={loadTicket} />;
}

function TicketContent({ ticketId, loadTicket }: { ticketId: string; loadTicket: LoadTicket }) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadTicket(ticketId, controller.signal).then(ticket => {
      if (!controller.signal.aborted) setState({ kind: "success", ticket });
    }).catch(error => {
      if (controller.signal.aborted || (error instanceof ApiError && error.kind === "cancelled")) return;
      if (error instanceof ApiError && error.status === 404) setState({ kind: "not-found" });
      else setState({ kind: "error", message: error instanceof ApiError ? error.message : "Bilet məlumatını yükləmək mümkün olmadı." });
    });
    return () => controller.abort();
  }, [loadTicket, retryKey, ticketId]);

  const ticket = state.kind === "success" ? state.ticket : null;
  const cancelled = ticket?.status === "cancelled" || ticket?.status === "refunded";
  const used = ticket?.is_checked_in || ticket?.status === "used";
  const cover = safeEventImageUrl(ticket?.event_cover_thumbnail || ticket?.event_cover_image_url || "");
  const paid = ticket ? Number(ticket.unit_price) > 0 : false;
  const pending = ticket?.status === "cancelled" && ticket.refund_status === "pending";
  return <LifecyclePage title="Bilet detalları" backHref="/tickets" footer={<Link className={css.primary} href={cancelled ? "/notifications" : "/tickets"}>{cancelled ? "Bildirişlərə keç" : "Biletlərimə qayıt"}</Link>}>
    {state.kind === "loading" ? <LifecycleLoading label="Bilet yüklənir…" /> : null}
    {state.kind === "not-found" ? <LifecycleState title="Bilet tapılmadı">Bu bilet mövcud deyil və ya başqa istifadəçiyə aiddir.</LifecycleState> : null}
    {state.kind === "error" ? <LifecycleState title="Yükləmək mümkün olmadı" error action={<button className={css.secondary} onClick={() => { setState({ kind: "loading" }); setRetryKey(value => value + 1); }}>Yenidən cəhd et</button>}>{state.message}</LifecycleState> : null}
    {ticket ? <>
      <article className={css.ticket} aria-label={ticket.event_title}>
        <span className={css.status}>{ticket.status === "refunded" ? "Geri qaytarılıb" : cancelled ? "Ləğv edilib" : used ? "İstifadə edilib" : "Aktiv bilet"}</span>
        {cover ? <Image unoptimized className={css.ticketCover} src={cover} alt="" width={338} height={112} /> : null}
        <div className={css.ticketInfo}><h1>{ticket.event_title}</h1><p className={css.meta}>{formatBakuDate(ticket.event_start_at)}</p><p className={css.meta}>{ticket.event_location_name}</p></div>
        <div className={css.ticketLine}><span>{ticket.ticket_type_name}</span><span>{paid ? `${ticket.unit_price} ${ticket.currency}` : "Ödənişsiz"}</span></div>
        <section className={css.ticketCode}>
          {cancelled || used ? <><h2>{cancelled ? "Giriş bağlıdır" : "Giriş qeydə alınıb"}</h2><p>{cancelled ? "Bu bilet giriş üçün etibarsızdır." : "Bu bilet artıq istifadə edilib."}</p>{used && ticket.checked_in_at ? <p>{formatBakuDate(ticket.checked_in_at)}</p> : null}</> : <><h2>Biletin giriş kodu</h2><p>Girişdə bu kodu tədbirin yoxlama komandasına təqdim edin.</p><code>{ticket.qr_code}</code></>}
        </section>
        <dl className={css.receipt}><div><dt>Bilet №</dt><dd>{ticket.id}</dd></div><div><dt>İştirakçı:</dt><dd>{ticket.owner_display_name}</dd></div><div><dt>Bitmə vaxtı:</dt><dd>{formatBakuDate(ticket.event_end_at)}</dd></div></dl>
      </article>
      {cancelled ? <Notice variant={pending ? "refund" : ticket.status === "refunded" ? "info" : "cancelled"} title={ticket.status === "refunded" ? "Geri ödəniş tamamlanıb" : pending ? "Geri ödəniş gözlənilir" : "Bilet ləğv edilib"}>
        <p>{ticket.status === "refunded" ? "Bilet sistemdə geri qaytarılmış kimi qeyd edilib. Bu biletlə giriş mümkün deyil." : pending ? "Sifarişiniz geri ödəniş üçün qeydə alınıb. Məbləğ hələ qaytarılmayıb; komanda müraciəti ayrıca emal edəcək." : paid ? "Biletiniz etibarsızdır. Geri ödənişlə bağlı məlumatı bildirişlərinizdən izləyin." : "Ödənişsiz biletiniz etibarsızdır. Bu bilet üçün geri ödəniş tələb olunmur."}</p>
        {ticket.cancellation_reason ? <p className={css.note}>Ləğv səbəbi: {ticket.cancellation_reason}</p> : null}
      </Notice> : null}
    </> : null}
  </LifecyclePage>;
}
