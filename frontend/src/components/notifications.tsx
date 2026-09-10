"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { notificationsApi } from "@/lib/api/notifications";
import { submissionTime } from "@/lib/submission-status";
import { useAuth } from "./auth-provider";
import { AuthMessage } from "./auth-ui";
import css from "./team-event-reviews.module.css";

export function NotificationLink({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [result, setResult] = useState<{ userId: number; count: number } | null>(null);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const data = await notificationsApi.count(controller.signal);
        if (!controller.signal.aborted) setResult({ userId: userId!, count: data.unread_count });
      } catch { /* The inbox offers an explicit retry if fetching fails. */ }
      finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [userId]);
  const count = result?.userId === userId ? result?.count || 0 : 0;
  return <Link href="/notifications" aria-label={count ? `Bildirişlər, ${count} oxunmamış` : "Bildirişlər"} className="relative grid size-10 place-items-center rounded-full bg-[var(--hara-surface)] transition active:scale-95">
    {children}
    {count > 0 ? <span className="absolute -top-1 -right-0.5 grid size-5 place-items-center rounded-full border border-[var(--hara-badge-border)] bg-[#ff2c3d] text-[9px] leading-3 font-medium text-white">{count > 9 ? "9+" : count}</span> : null}
  </Link>;
}

export function Notifications() {
  const { user } = useAuth();
  return user ? <Inbox key={user.id} /> : <p role="status">Hesab yüklənir…</p>;
}

function Inbox() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof notificationsApi.list>> | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<number | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    notificationsApi.list(page, controller.signal).then(data => {
      if (!controller.signal.aborted) { setResult(data); setError(""); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Bildirişlər yüklənmədi."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry]);
  async function markRead(id: number) {
    if (inFlight.current) return;
    inFlight.current = true; setReading(id); setError("");
    try {
      const data = await notificationsApi.read(id);
      setResult(current => current ? { ...current,
        unread_count: Math.max(0, current.unread_count - (current.results.some(item => item.id === id && !item.read_at) ? 1 : 0)),
        results: current.results.map(item => item.id === id ? { ...item, read_at: data.read_at } : item),
      } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bildiriş oxunmuş kimi işarələnmədi. Yenidən cəhd et."); }
    finally { inFlight.current = false; setReading(null); }
  }
  function navigate(next: number) { setLoading(true); setResult(null); setPage(next); }
  return <main className={`hara-auth ${css.page}`} style={{ maxWidth: 760 }}>
    <Link className={css.back} href="/more">← Profilə qayıt</Link>
    <header className={css.heading}><div><p>HARA</p><h1>Bildirişlər</h1></div><button className={css.secondary} disabled={loading || reading !== null} onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Yenilə</button></header>
    {error ? <AuthMessage>{error}</AuthMessage> : null}
    {loading ? <p role="status">Bildirişlər yüklənir…</p> : null}
    {result && !loading ? <>
      <p className={css.summary}>{result.unread_count} oxunmamış bildiriş</p>
      {!result.results.length ? <div className={css.card}><h2>Hələ bildiriş yoxdur</h2><p>Tədbirlərin ləğvi və geri ödənişlə bağlı yeniliklər burada görünəcək.</p></div> : null}
      <div className={css.column}>{result.results.map(item => <article key={item.id} className={css.card} aria-label={item.title}>
        {!item.read_at ? <span className={css.badge}>Yeni</span> : null}
        <h2>{item.title}</h2>{item.event_title ? <strong>{item.event_title}</strong> : null}
        <p>{item.body}</p>
        {item.cancellation_reason ? <p className={css.multiline}>Ləğv səbəbi: {item.cancellation_reason}</p> : null}
        <small>{submissionTime(item.created_at)} · Bakı vaxtı</small>
        <div className={`${css.buttons} flex-wrap`}>
          <Link className={css.secondary} href={item.type === "organizer_event_published" && item.event_status === "published" && item.event_slug ? `/events/${item.event_slug}` : "/tickets"}>{item.type === "organizer_event_published" && item.event_status === "published" ? "Tədbirə bax" : "Biletlərimə bax"}</Link>
          {!item.read_at ? <button className={css.secondary} disabled={reading !== null} onClick={() => void markRead(item.id)}>{reading === item.id ? "Saxlanılır…" : "Oxunmuş kimi işarələ"}</button> : <span className={css.secondary}>Oxunub</span>}
        </div>
      </article>)}</div>
      <nav className={`${css.buttons} mt-6`} aria-label="Bildiriş səhifələri"><button className={css.secondary} disabled={!result.previous || reading !== null} onClick={() => navigate(page - 1)}>Əvvəlki</button><button className={css.secondary} disabled={!result.next || reading !== null} onClick={() => navigate(page + 1)}>Növbəti</button></nav>
    </> : null}
  </main>;
}
