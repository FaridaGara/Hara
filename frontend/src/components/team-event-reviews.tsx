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
import { LifecyclePage, LifecycleIntro, LifecycleState, LifecycleLoading, LifecycleDialog, Notice, SubmissionCard } from "./lifecycle-ui";
import ui from "./lifecycle-ui.module.css";
import css from "./team-event-reviews.module.css";

const actions: Record<ReviewAction, string> = { comment: "Daxili şərh", changes_requested: "Düzəliş tələb edildi", approved: "Təsdiqləndi və yayımlandı", cancelled: "Tədbir dayandırıldı" };
function TeamGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <LifecyclePage title="Tədbir yoxlaması" backHref="/more"><LifecycleLoading label="Hesab yüklənir…" /></LifecyclePage>;
  if (!user.can_review_events) return <LifecyclePage title="Tədbir yoxlaması" backHref="/more" footer={<Link className={ui.primary} href="/more">Profilə qayıt</Link>}><LifecycleState title="Bu bölmə komanda üçündür" error>Bu bölmə üçün komanda icazəsi lazımdır. Baxış üçün administratorla əlaqə saxlayın.</LifecycleState></LifecyclePage>;
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
  return <LifecyclePage title="Tədbir yoxlaması" backHref="/more" wide>
    <LifecycleIntro title={query.status === "pending" ? "Yoxlama gözləyənlər" : "Tədbir yoxlaması"}>{result ? `${result.count} tədbir${query.status === "pending" ? " qərar gözləyir" : " tapıldı"}.` : "Tədbirlərə baxın və komandanın qərarını qeyd edin."}</LifecycleIntro>
    <form className={css.filters} onSubmit={event => { event.preventDefault(); changeQuery({ ...query, search: search.trim(), page: 1 }); }}>
      <label className={css.search}><span className="sr-only">Tədbir və ya yaradan şəxs</span><input value={search} maxLength={128} placeholder="Tədbir və ya təşkilatçı axtar" onChange={event => setSearch(event.target.value)} /></label>
      <label><span className="sr-only">Status</span><select aria-label="Status" value={query.status} onChange={event => changeQuery({ ...query, status: event.target.value, page: 1 })}><option value="all">Hamısı</option>{Object.entries(submissionStatuses).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      <button className={ui.secondary} type="submit">Axtar</button>
    </form>
    {loading ? <LifecycleLoading label="Tədbirlər yüklənir…" /> : null}
    {error ? <AuthMessage>{error}</AuthMessage> : null}
    {result?.results.length === 0 && !loading ? <LifecycleState title="Uyğun tədbir tapılmadı">Axtarışı və ya status filtrini dəyişərək yenidən yoxlayın.</LifecycleState> : null}
    <div className={css.queue}>{result?.results.map(item => <SubmissionCard key={item.id} item={item} action={<Link className={ui.secondary} aria-label="Tədbirə bax və yoxla" href={`/team/event-reviews/${item.id}`}>Baxış keçir</Link>}>
      <div className={ui.meta}><p>{item.creator.name}</p><p>{item.creator.email}</p><p>Göndərildi: {submissionTime(item.submitted_at)} · Bakı vaxtı</p></div>
    </SubmissionCard>)}</div>
    <div className={ui.refresh}>{result ? <span>{result.count} tədbir · Səhifə {query.page}</span> : null}<button className={ui.textButton} disabled={loading} onClick={() => { setLoading(true); setRetry(v => v + 1); }}>Yenilə</button></div>
    {result && (result.next || result.previous) ? <nav className={ui.pagination} aria-label="Səhifələr"><button className={ui.secondary} disabled={!result.previous || loading} onClick={() => changeQuery({ ...query, page: query.page - 1 })}>Əvvəlki</button><button className={ui.secondary} disabled={!result.next || loading} onClick={() => changeQuery({ ...query, page: query.page + 1 })}>Növbəti</button></nav> : null}
  </LifecyclePage>;
}

function ReviewDetails({ id }: { id: string }) {
  const [item, setItem] = useState<EventReviewDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [uncertainOpen, setUncertainOpen] = useState(false);
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
        pendingRequest.current = null; setUncertain(false); setUncertainOpen(false); if (pending.action === "comment") setBody(""); else setReason(""); setNotice("Əməliyyatın saxlanıldığı təsdiqləndi.");
      }
      setItem(data); setError(""); setStale(false); setReviewed(false);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Tədbir yüklənmədi."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);
  function refresh() { if (!busy) { setConfirmation(null); setUncertainOpen(false); setLoading(true); setRetry(v => v + 1); } }
  async function send(action: ReviewAction, repeat = false) {
    if (!item || inFlight.current || loading || stale || (!repeat && uncertain)) return;
    const payload = repeat ? pendingRequest.current : { request_id: crypto.randomUUID(), version: item.version, action, body: action === "comment" ? body.trim() : action === "approved" ? "" : reason.trim(), reviewed };
    if (!payload) return;
    pendingRequest.current = payload; inFlight.current = true; setBusy(true); setError(""); setNotice(""); setConfirmation(null);
    try {
      const data = await eventReviewsApi.act(id, payload);
      setItem(data); if (payload.action === "comment") setBody(""); else setReason(""); setReviewed(false); setUncertain(false); setUncertainOpen(false); pendingRequest.current = null;
      setNotice(payload.action === "comment" ? "Daxili şərh saxlanıldı." : payload.action === "approved" ? "Tədbir təsdiqləndi və yayımlandı." : payload.action === "cancelled" ? "Tədbir dayandırıldı. Bilet sahiblərinə tətbiqdaxili bildiriş göndərildi. Ödənişli sifarişlər geri ödəniş üçün qeydə alındı." : "Düzəliş qeydi tədbiri yaradan şəxsin Tədbirlərim bölməsində görünür.");
    } catch (cause) {
      const unknown = !(cause instanceof ApiError) || cause.status === null || cause.status >= 500;
      setUncertain(unknown); setUncertainOpen(unknown);
      if (!unknown) pendingRequest.current = null;
      if (cause instanceof ApiError && cause.status === 409) setStale(true);
      setError(unknown ? "Cavab alınmadı. Əməliyyat saxlanmış ola bilər. Statusu yenilə və ya eyni sorğunu təkrar yoxla." : cause.message);
    } finally { inFlight.current = false; setBusy(false); }
  }
  const draft = item?.snapshot;
  const locked = busy || loading || uncertain || stale;
  const paid = draft?.sales.tickets.some(ticket => ticket.paymentType === "paid") ?? false;
  function openDecision(action: ReviewAction) { setReason(""); setConfirmation(action); }
  const refreshButton = <button className={ui.textButton} disabled={busy || loading} onClick={refresh}>Məlumatları yenilə</button>;
  return <LifecyclePage title="Tədbirə baxış" backHref="/team/event-reviews" wide footer={item ? <a className={`${ui.primary} ${css.decisionJump}`} href="#review-decision">Yoxlama qərarı</a> : undefined}>
    {loading && !item ? <LifecycleLoading label="Tədbir yüklənir…" /> : null}
    {error ? <AuthMessage>{error}</AuthMessage> : null}
    {notice ? <Notice title={item?.status === "cancelled" ? "Tədbir dayandırıldı" : "Dəyişiklik saxlanıldı"} role="status"><p>{notice}</p></Notice> : null}
    {item && draft ? <>
      <LifecycleIntro title={item.title} />
      <p className={ui.status} data-status={item.status}>{submissionStatuses[item.status].label} · {submissionTime(item.submitted_at)}</p>
      <div className={css.layout}><div className={css.column}>
        <section className={css.card}>
          {draft.media?.cover ? <Image className={css.cover} unoptimized src={draft.media.cover} alt={`${draft.title} — üz qabığı`} width={800} height={450} /> : null}
          <h2>Tədbir haqqında</h2><p className={css.multiline}>{draft.description}</p>
          <div><p>{draft.schedule.startDate} · {draft.schedule.startTime}–{draft.schedule.endTime}{draft.schedule.endDate !== draft.schedule.startDate ? ` · ${draft.schedule.endDate}` : ""} · Bakı vaxtı</p><p>{draft.schedule.venue?.name} · {draft.schedule.venue?.address}</p>{draft.schedule.venue?.entry_note ? <p>Giriş qeydi: {draft.schedule.venue.entry_note}</p> : null}</div>
          <p className={ui.meta}>Kateqoriya: {draft.categoryLabel || draft.category} · Yaş həddi: {draft.age || "Göstərilməyib"}</p>
          <h3>Biletlər və giriş</h3>
          <div>{draft.sales.tickets.map(ticket => <div className={css.ticketRow} key={ticket.id}><p>{ticket.name} · {ticket.paymentType === "free" ? "Ödənişsiz" : `${ticket.price} AZN`} · {ticket.quantity} bilet</p>{ticket.includes ? <p className={ui.meta}>{ticket.includes}</p> : null}</div>)}<p>{draft.sales.admissionType === "seated" ? "Oturacaqlı giriş" : "Ümumi giriş · Oturacaq seçimi yoxdur"}</p><p>Satış: {salesSummary(draft)}</p></div>
        </section>
        <section className={css.card}><h2>Yaradıcı və əlaqə</h2><dl><div><dt>Ad və soyad</dt><dd>{item.creator.name}</dd></div><div><dt>E-poçt</dt><dd><a href={`mailto:${item.creator.email}`}>{item.creator.email}</a></dd></div><div><dt>Əlaqə nömrəsi</dt><dd>{item.creator.phone ? <a href={`tel:${item.creator.phone}`}>{item.creator.phone}</a> : "Daxil edilməyib"}</dd></div></dl><p className={ui.meta}>Əlaqə məlumatları yalnız səlahiyyətli komandaya görünür.</p></section>
        <section className={css.card}><h2>Əlavə məlumatlar</h2><dl><div><dt>Dil</dt><dd>{EVENT_LANGUAGES.find(([key]) => key === draft.language)?.[1] || "Göstərilməyib"}</dd></div><div><dt>Müddət</dt><dd>{draft.duration ? `${draft.duration} dəqiqə` : "Göstərilməyib"}</dd></div><div><dt>Tutum</dt><dd>{draft.sales.capacity || draft.schedule.venue?.capacity || "Göstərilməyib"}</dd></div><div><dt>Sifariş limiti</dt><dd>{draft.sales.minPerOrder}–{draft.sales.maxPerOrder} bilet</dd></div><div><dt>Geri qaytarma</dt><dd>{({ non_refundable: "Geri qaytarılmır", until_24h: "Başlanğıca 24 saat qalanadək", until_72h: "Başlanğıca 72 saat qalanadək", "": "Tətbiq edilmir" })[draft.sales.refundPolicy]}</dd></div><div><dt>Koordinatlar</dt><dd>{draft.schedule.venue?.latitude}, {draft.schedule.venue?.longitude}</dd></div></dl>{draft.sales.seatPlanApplied && draft.sales.seatPlan ? <SeatPlanCanvas plan={draft.sales.seatPlan} /> : null}</section>
        {draft.media?.gallery.length ? <section className={css.card}><h2>Əlavə media</h2><div className={css.gallery}>{draft.media.gallery.map((photo, index) => <Image key={index} unoptimized src={photo} alt={`Əlavə şəkil ${index + 1}`} width={400} height={250} />)}</div></section> : null}
      </div><aside className={css.column}>
        <section className={css.card} id="review-decision" tabIndex={-1}><h2>Yoxlama qərarı</h2>
          {item.note ? <p className={css.multiline}>Yaradan şəxsə son qeyd: {item.note}</p> : null}
          {item.can_moderate ? <>
            {item.status === "pending" ? <>
              <label className={css.check}><input type="checkbox" checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)} />Tədbir məlumatlarını, məkanı, biletləri və medianı yoxladım.</label>
              <button className={ui.primary} disabled={locked || !reviewed} onClick={() => openDecision("approved")}>Təsdiqlə və yayımla</button>
              <button className={ui.secondary} disabled={locked} onClick={() => openDecision("changes_requested")}>Düzəliş tələb et</button>
              <p className={ui.meta}>Təsdiqdən sonra tədbir iştirakçılara görünəcək. Düzəliş istədikdə səbəb təşkilatçıya göndəriləcək.</p>
            </> : <p>{submissionStatuses[item.status].description}</p>}
            {item.status === "published" ? <><button className={ui.inverse} disabled={locked} onClick={() => openDecision("cancelled")}>Tədbiri dayandır</button><p className={ui.meta}>Dayandırma səbəbi təşkilatçıya və bilet sahiblərinə görünəcək. Satış və giriş bağlanacaq.</p></> : null}
          </> : <p>Baxış icazən var. Şərh və qərar üçün administrator dəyişiklik icazəsi verməlidir.</p>}
          {item.status === "published" && item.event_slug ? <Link className={ui.secondary} href={`/events/${item.event_slug}`}>Yayımlanmış tədbirə bax</Link> : null}
          {loading ? <p role="status">Tədbir yenilənir…</p> : null}{busy ? <p role="status">Saxlanılır…</p> : null}
          {refreshButton}
          {uncertain && !uncertainOpen ? <Notice title="Nəticəni yoxlayaq" accent><p>Cavab alınmadı. Əməliyyat saxlanmış ola bilər. Statusu yeniləyin və ya eyni sorğunu təkrar yoxlayın.</p><button className={ui.secondary} disabled={busy || loading || stale} onClick={() => void send(pendingRequest.current?.action || "comment", true)}>Eyni sorğunu təkrar yoxla</button></Notice> : null}
        </section>
        <section className={css.card}><h2>Komanda şərhləri · {item.history.filter(log => log.action === "comment").length}</h2><p className={ui.meta}>Daxili qeydlər — yalnız komandaya görünür.</p>
          {item.history.filter(log => log.action === "comment").map(log => <article className={css.commentCard} key={log.id}><strong>{log.author} · Tədbir komandası</strong><p className={css.multiline}>{log.body}</p><time className={ui.meta} dateTime={log.created_at}>{submissionTime(log.created_at)}</time></article>)}
          {item.can_moderate ? <><label className={css.comment}><span className="sr-only">Daxili şərh</span><textarea value={body} maxLength={2000} rows={4} disabled={locked} placeholder="Komanda üçün şərhinizi yazın…" onChange={event => setBody(event.target.value)} /></label><div className={css.commentFooter}><small>{body.length} / 2000 simvol</small><button className={ui.primary} aria-label="Daxili şərh əlavə et" disabled={locked || !body.trim()} onClick={() => void send("comment")}>Şərh əlavə et</button></div></> : null}
        </section>
        {item.status === "cancelled" ? <section className={css.card}><h2>Geri ödəniş sorğuları</h2><p>{item.refund_requests?.length || 0} sifariş emal gözləyir. Bu qeyd pulun qaytarıldığı demək deyil.</p>{item.refund_requests?.map(refund => <div key={refund.id} className={css.commentCard}><strong>{refund.amount} {refund.currency} · Gözlənilir</strong><p>Sifariş: {refund.order_id}</p><small>{submissionTime(refund.created_at)}</small></div>)}</section> : null}
        <section className={css.card}><h2>Qərar tarixçəsi</h2>{!item.history.some(log => log.action !== "comment") ? <p className={ui.meta}>Hələ qərar yoxdur.</p> : <ol className={css.history}>{item.history.filter(log => log.action !== "comment").map(log => <li key={log.id}><strong>{actions[log.action]}</strong><span>{log.author} · {submissionTime(log.created_at)}</span>{log.body ? <p className={css.multiline}>{log.body}</p> : null}<small>{log.action === "cancelled" ? "Təşkilatçıya və bilet sahiblərinə göstərilir" : log.action === "changes_requested" ? "Yaradan şəxsə göstərilir" : "Komanda qeydi"}</small></li>)}</ol>}</section>
      </aside></div>
    </> : !loading ? refreshButton : null}
    {confirmation && item ? <LifecycleDialog full={confirmation !== "approved"} title={confirmation === "approved" ? "Tədbir yayımlansın?" : confirmation === "cancelled" ? "Tədbir dayandırılsın?" : "Düzəliş tələb et"} onClose={() => setConfirmation(null)} footer={<><button className={confirmation === "cancelled" ? ui.inverse : ui.primary} aria-label="Qərarı təsdiqlə" disabled={locked || (confirmation !== "approved" && !reason.trim())} onClick={() => void send(confirmation)}>{confirmation === "cancelled" ? "Dayandırmanı təsdiqlə" : confirmation === "approved" ? "Təsdiqlə və yayımla" : "Düzəliş tələbini göndər"}</button><button className={ui.secondary} onClick={() => setConfirmation(null)}>Geri qayıt</button></>}>
      <p>{item.title} · {submissionStatuses[item.status].label}</p>
      {confirmation === "approved" ? <p>Tədbir təsdiqlənəcək və iştirakçılara görünəcək. Məlumatları yoxladığınızı təsdiqləyirsiniz.</p> : <>
        <Notice title={confirmation === "cancelled" ? "Bilet sahibləri məlumatlandırılacaq" : "Qeyd təşkilatçıya göndəriləcək"} accent={confirmation === "cancelled" && paid}><p>{confirmation === "cancelled" ? paid ? "Ödənişli sifarişlər geri ödəniş üçün qeydə alınacaq. Pul avtomatik qaytarılmır; komanda müraciətləri ayrıca emal edəcək. Ödənişsiz bilet sahiblərinə ləğv barədə bildiriş gedəcək." : "Ödənişsiz bilet sahiblərinə ləğv barədə bildiriş gedəcək. Biletlər etibarsız olacaq; geri ödəniş tələb olunmur." : "Dəyişməli məlumatları aydın yazın. Təşkilatçı bu qeydi Tədbirlərim bölməsində görəcək və tədbiri yenidən göndərə biləcək."}</p></Notice>
        <label className={ui.field}>{confirmation === "cancelled" ? "Dayandırılma səbəbi" : "Düzəliş səbəbi"} *<textarea aria-label={confirmation === "cancelled" ? "Dayandırılma səbəbi" : "Düzəliş səbəbi"} value={reason} required maxLength={2000} onChange={event => setReason(event.target.value)} placeholder={confirmation === "cancelled" ? "Tədbir niyə dayandırılır?" : "Nəyin dəyişdirilməli olduğunu yazın…"} /></label>
        <p className={ui.meta}>{reason.length} / 2000 simvol</p>
        {confirmation === "cancelled" ? <p className={ui.meta}>Səbəb bildirişdə görünəcək. Tədbir yayımdan çıxarılacaq və yeni bilet alışı bağlanacaq. Bu əməliyyat geri alına bilməz.</p> : null}
      </>}
    </LifecycleDialog> : null}
    {uncertainOpen ? <LifecycleDialog title="Nəticəni yoxlayaq" onClose={() => setUncertainOpen(false)} footer={<><button className={ui.primary} disabled={busy || loading} onClick={refresh}>Statusu yenilə</button><button className={ui.secondary} disabled={busy || loading || stale} onClick={() => { setUncertainOpen(false); void send(pendingRequest.current?.action || "comment", true); }}>Eyni sorğunu təkrar yoxla</button></>}><p>Cavab alınmadı. Əməliyyat saxlanmış ola bilər. Yenidən qərar verməzdən əvvəl statusu yoxlayın.</p></LifecycleDialog> : null}
  </LifecyclePage>;
}
