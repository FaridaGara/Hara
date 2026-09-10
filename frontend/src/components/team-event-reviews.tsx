"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { eventReviewsApi, type EventReviewDetail, type ReviewAction, type ReviewRequest } from "@/lib/api/event-reviews";
import { ApiError } from "@/lib/api/client";
import { submissionStatuses, submissionTime } from "@/lib/submission-status";
import { salesSummary } from "@/lib/event-sales";
import { EVENT_LANGUAGES } from "@/lib/event-draft";
import { SeatPlanCanvas } from "./seat-plan-canvas";
import { useAuth } from "./auth-provider";
import { AuthMessage } from "./auth-ui";
import css from "./team-event-reviews.module.css";

const actions: Record<ReviewAction, string> = { comment: "Daxili şərh", changes_requested: "Düzəliş tələb edildi", approved: "Təsdiqləndi və yayımlandı" };
function TeamGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <p role="status">Hesab yüklənir…</p>;
  if (!user.can_review_events) return <main className={`hara-auth ${css.page}`}><Link href="/more">Profilə qayıt</Link><h1>Tədbir yoxlaması</h1><AuthMessage>Bu bölmə üçün komanda icazəsi lazımdır. Administrator hesabına tədbir yoxlamasına baxış icazəsi verməlidir.</AuthMessage></main>;
  return <div key={user.id}>{children}</div>;
}
export function TeamReviewList() { return <TeamGate><ReviewQueue /></TeamGate>; }
export function TeamReviewDetail({ id }: { id: string }) { return <TeamGate><ReviewDetails key={id} id={id} /></TeamGate>; }

function ReviewQueue() {
  const [query, setQuery] = useState({ status: "pending", search: "", page: 1 });
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof eventReviewsApi.list>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    eventReviewsApi.list(query.status, query.search, query.page, controller.signal).then(data => {
      if (!controller.signal.aborted) { setResult(data); setError(""); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Tədbirlər yüklənmədi."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, retry]);
  function changeQuery(next: typeof query) { setResult(null); setLoading(true); setQuery(next); }
  return <main className={`hara-auth ${css.page}`}>
    <Link className={css.back} href="/more">← Profilə qayıt</Link>
    <header className={css.heading}><div><p>HARA komandası</p><h1>Tədbir yoxlaması</h1></div><button className={css.secondary} disabled={loading} onClick={() => { setLoading(true); setRetry(v => v + 1); }}>Yenilə</button></header>
    <form className={css.filters} onSubmit={event => { event.preventDefault(); changeQuery({ ...query, search: search.trim(), page: 1 }); }}>
      <label>Status<select value={query.status} onChange={event => changeQuery({ ...query, status: event.target.value, page: 1 })}><option value="all">Hamısı</option>{Object.entries(submissionStatuses).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      <label>Tədbir və ya yaradan şəxs<input value={search} maxLength={128} placeholder="Tədbirin adı, ad və ya e-poçt" onChange={event => setSearch(event.target.value)} /></label>
      <button className={css.primary} type="submit">Axtar</button>
    </form>
    {loading ? <p role="status">Tədbirlər yüklənir…</p> : null}
    {error ? <AuthMessage>{error}</AuthMessage> : null}
    {result && !loading ? <p>{result.count} tədbir · Səhifə {query.page}</p> : null}
    {result?.results.length === 0 && !loading ? <div className={css.card}>Bu seçimə uyğun tədbir yoxdur.</div> : null}
    <div className={css.queue}>{result?.results.map(item => <article className={css.card} key={item.id}>
      <span className={css.badge}>{submissionStatuses[item.status].label}</span><h2><Link href={`/team/event-reviews/${item.id}`}>{item.title}</Link></h2>
      <p>{item.creator.name}</p><p>{item.creator.email}</p>
      <small>Göndərildi: {submissionTime(item.submitted_at)} · Bakı vaxtı</small>
      <Link className={css.secondary} href={`/team/event-reviews/${item.id}`}>Tədbirə bax və yoxla</Link>
    </article>)}</div>
    {result ? <nav className={css.buttons} aria-label="Səhifələr"><button className={css.secondary} disabled={!result.previous || loading} onClick={() => changeQuery({ ...query, page: query.page - 1 })}>Əvvəlki</button><button className={css.secondary} disabled={!result.next || loading} onClick={() => changeQuery({ ...query, page: query.page + 1 })}>Növbəti</button></nav> : null}
  </main>;
}

function ReviewDetails({ id }: { id: string }) {
  const [item, setItem] = useState<EventReviewDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState<ReviewAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const pendingRequest = useRef<ReviewRequest | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    eventReviewsApi.get(id, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const pending = pendingRequest.current;
      if (pending && data.history.some(log => log.id === pending.request_id)) {
        pendingRequest.current = null; setUncertain(false); setBody(""); setNotice("Əməliyyatın saxlanıldığı təsdiqləndi.");
      }
      setItem(data); setError(""); setStale(false); setReviewed(false);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Tədbir yüklənmədi."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);
  function refresh() { if (!busy) { setConfirmation(null); setLoading(true); setRetry(v => v + 1); } }
  async function send(action: ReviewAction, repeat = false) {
    if (!item || inFlight.current || loading || stale || (!repeat && uncertain)) return;
    const payload = repeat ? pendingRequest.current : { request_id: crypto.randomUUID(), version: item.version, action, body: body.trim(), reviewed };
    if (!payload) return;
    pendingRequest.current = payload; inFlight.current = true; setBusy(true); setError(""); setNotice(""); setConfirmation(null);
    try {
      const data = await eventReviewsApi.act(id, payload);
      setItem(data); setBody(""); setReviewed(false); setUncertain(false); pendingRequest.current = null;
      setNotice(payload.action === "comment" ? "Daxili şərh saxlanıldı." : payload.action === "approved" ? "Tədbir təsdiqləndi və yayımlandı." : "Düzəliş qeydi tədbiri yaradan şəxsin Tədbirlərim bölməsində görünür.");
    } catch (cause) {
      const unknown = !(cause instanceof ApiError) || cause.status === null || cause.status >= 500;
      setUncertain(unknown);
      if (!unknown) pendingRequest.current = null;
      if (cause instanceof ApiError && cause.status === 409) setStale(true);
      setError(unknown ? "Cavab alınmadı. Əməliyyat saxlanmış ola bilər. Statusu yenilə və ya eyni sorğunu təkrar yoxla." : cause.message);
    } finally { inFlight.current = false; setBusy(false); }
  }
  const draft = item?.snapshot;
  const locked = busy || loading || uncertain || stale;
  return <main className={`hara-auth ${css.page}`}>
    <Link className={css.back} href="/team/event-reviews">← Yoxlama siyahısı</Link>
    <header className={css.heading}><div><p>HARA komandası</p><h1>{item?.title || "Tədbirə baxış"}</h1></div><button className={css.secondary} disabled={busy || loading} onClick={refresh}>Məlumatları yenilə</button></header>
    {loading ? <p role="status">Tədbir yüklənir…</p> : null}
    {error ? <AuthMessage>{error}</AuthMessage> : null}{notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
    {item && draft ? <>
      <div className={css.summary}><span className={css.badge}>{submissionStatuses[item.status].label}</span><span>Göndərildi: {submissionTime(item.submitted_at)} · Bakı vaxtı</span></div>
      <div className={css.layout}><div className={css.column}>
        <section className={css.card}><h2>Tədbiri yaradan şəxs</h2><dl><div><dt>Ad və soyad</dt><dd>{item.creator.name}</dd></div><div><dt>E-poçt</dt><dd><a href={`mailto:${item.creator.email}`}>{item.creator.email}</a></dd></div><div><dt>Əlaqə nömrəsi</dt><dd>{item.creator.phone ? <a href={`tel:${item.creator.phone}`}>{item.creator.phone}</a> : "Daxil edilməyib"}</dd></div></dl></section>
        <section className={css.card}><h2>Əsas məlumatlar</h2><p>{draft.categoryLabel || draft.category}</p><p className={css.multiline}>{draft.description}</p><dl><div><dt>Yaş həddi</dt><dd>{draft.age || "Göstərilməyib"}</dd></div><div><dt>Dil</dt><dd>{EVENT_LANGUAGES.find(([key]) => key === draft.language)?.[1] || "Göstərilməyib"}</dd></div><div><dt>Müddət</dt><dd>{draft.duration ? `${draft.duration} dəqiqə` : "Göstərilməyib"}</dd></div></dl></section>
        <section className={css.card}><h2>Tarix və məkan</h2><p>Bakı vaxtı: {draft.schedule.startDate} · {draft.schedule.startTime} → {draft.schedule.endDate} · {draft.schedule.endTime}</p><h3>{draft.schedule.venue?.name}</h3><p>{draft.schedule.venue?.address}</p>{draft.schedule.venue?.entry_note ? <p>Giriş qeydi: {draft.schedule.venue.entry_note}</p> : null}<p>Koordinatlar: {draft.schedule.venue?.latitude}, {draft.schedule.venue?.longitude}</p></section>
        <section className={css.card}><h2>Satış və biletlər</h2><p>Tutum: {draft.sales.capacity || draft.schedule.venue?.capacity || "—"} · {draft.sales.admissionType === "seated" ? "Oturacaqlı" : "Ümumi giriş"}</p><div className={css.table}><table><thead><tr><th>Bilet</th><th>Qiymət</th><th>Say</th><th>Daxildir</th></tr></thead><tbody>{draft.sales.tickets.map(ticket => <tr key={ticket.id}><td>{ticket.name}</td><td>{ticket.paymentType === "free" ? "Ödənişsiz" : `${ticket.price} AZN`}</td><td>{ticket.quantity}</td><td>{ticket.includes}</td></tr>)}</tbody></table></div><p>Satış: {salesSummary(draft)} · Bakı vaxtı</p><p>Sifariş limiti: {draft.sales.minPerOrder}–{draft.sales.maxPerOrder} bilet</p><p>Geri qaytarma: {({ non_refundable: "Geri qaytarılmır", until_24h: "Başlanğıca 24 saat qalanadək", until_72h: "Başlanğıca 72 saat qalanadək", "": "Tətbiq edilmir" })[draft.sales.refundPolicy]}</p>{draft.sales.seatPlanApplied && draft.sales.seatPlan ? <SeatPlanCanvas plan={draft.sales.seatPlan} /> : null}</section>
        <section className={css.card}><h2>Media</h2>{draft.media?.cover ? <Image className={css.cover} unoptimized src={draft.media.cover} alt={`${draft.title} — üz qabığı`} width={800} height={450} /> : <p>Üz qabığı yoxdur.</p>}<div className={css.gallery}>{draft.media?.gallery.map((photo, index) => <Image key={index} unoptimized src={photo} alt={`Əlavə şəkil ${index + 1}`} width={400} height={250} />)}</div></section>
      </div><aside className={css.column}>
        <section className={css.card}><h2>Yoxlama və qərar</h2>{item.note ? <p className={css.multiline}>Yaradan şəxsə son qeyd: {item.note}</p> : null}
          {item.can_moderate ? <>
            <label className={css.comment}>Şərh və ya düzəliş səbəbi<textarea value={body} maxLength={2000} rows={5} disabled={locked} onChange={event => setBody(event.target.value)} /></label>
            <small>“Daxili şərh” yalnız komandaya görünür. “Düzəliş tələb et” qeydi tədbiri yaradan şəxsə görünür.</small>
            <button className={css.secondary} disabled={locked || !body.trim()} onClick={() => void send("comment")}>Daxili şərh əlavə et</button>
            {item.status === "pending" ? <>
              <label className={css.check}><input type="checkbox" checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)} />Tədbir məlumatlarını, məkanı, biletləri və medianı yoxladım.</label>
              <button className={css.primary} disabled={locked || !reviewed} onClick={() => setConfirmation("approved")}>Təsdiqlə və yayımla</button>
              <button className={css.secondary} disabled={locked || !body.trim()} onClick={() => setConfirmation("changes_requested")}>Düzəliş tələb et</button>
            </> : <p>{submissionStatuses[item.status].description}</p>}
            {uncertain ? <button className={css.secondary} disabled={busy || loading} onClick={() => void send(pendingRequest.current?.action || "comment", true)}>Eyni sorğunu təkrar yoxla</button> : null}
            {confirmation ? <div role="dialog" aria-modal="false" aria-label="Qərarı təsdiqlə" className={css.confirm}><p>{confirmation === "approved" ? "Tədbir təsdiqlənəcək və iştirakçılara görünəcək." : "Bu qeyd tədbiri yaradan şəxsə göndəriləcək:"}</p>{confirmation === "changes_requested" ? <p className={css.multiline}>{body}</p> : null}<div className={css.buttons}><button className={css.primary} disabled={busy} onClick={() => void send(confirmation)}>Qərarı təsdiqlə</button><button className={css.secondary} onClick={() => setConfirmation(null)}>Geri qayıt</button></div></div> : null}
          </> : <p>Baxış icazən var. Şərh və qərar üçün administrator dəyişiklik icazəsi verməlidir.</p>}
          {busy ? <p role="status">Saxlanılır…</p> : null}
          {item.status === "published" ? <Link className={css.secondary} href={`/events/${item.event_slug}`}>Yayımlanmış tədbirə bax</Link> : null}
        </section>
        <section className={css.card}><h2>Yoxlama tarixçəsi</h2><p>Şərhlər və qərarlar müəllif və tarixlə saxlanılır.</p>{!item.history.length ? <p>Hələ qeyd yoxdur.</p> : <ol className={css.history}>{item.history.map(log => <li key={log.id}><strong>{actions[log.action]}</strong><span>{log.author} · {submissionTime(log.created_at)}</span>{log.body ? <p className={css.multiline}>{log.body}</p> : null}<small>{log.action === "changes_requested" ? "Yaradan şəxsə göstərilir" : "Komanda qeydi"}</small></li>)}</ol>}</section>
      </aside></div>
    </> : null}
  </main>;
}
