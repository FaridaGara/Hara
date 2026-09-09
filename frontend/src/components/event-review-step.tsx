"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { useEventDraft } from "@/hooks/use-event-draft";
import { EVENT_CATEGORIES, EVENT_LANGUAGES, type EventDraft } from "@/lib/event-draft";
import { formatWizardDate } from "@/lib/event-schedule";
import { allocatedTickets, salesCapacity, salesSummary } from "@/lib/event-sales";
import { reviewIssues, submissionDraft } from "@/lib/event-review";
import { ApiError } from "@/lib/api/client";
import { eventSubmissionsApi, type EventSubmission, type SubmissionEligibility } from "@/lib/api/event-submissions";
import { AuthMessage } from "./auth-ui";
import { WizardFrame, WizardIcon, WizardProgress } from "./event-wizard-layout";
import { SeatPlanCanvas } from "./seat-plan-canvas";
import styles from "./event-wizard.module.css";

type DraftState = ReturnType<typeof useEventDraft>;
const statusTitles: Record<EventSubmission["status"], string> = {
  pending: "Tədbirin yoxlanılır", changes_requested: "Düzəliş tələb olunur", published: "Tədbirin yayımlanıb", cancelled: "Tədbir ləğv edilib", completed: "Tədbir tamamlanıb",
};

function Preview({ draft }: { draft: EventDraft }) {
  const venue = draft.schedule.venue;
  return <>
    <p className={styles.accent}>İştirakçı önbaxışı · alış aktiv deyil</p>
    {draft.media?.cover ? <Image unoptimized src={draft.media.cover} alt={draft.title} width={370} height={208} className={styles.reviewCover} /> : <AuthMessage>Üz qabığı əlavə edilməyib.</AuthMessage>}
    <div className={styles.introduction}><h1>{draft.title}</h1><p>{EVENT_CATEGORIES.find(([id]) => id === draft.category)?.[1]}</p></div>
    <dl className={styles.reviewDetails}>
      <div><dt>Tarix · Bakı vaxtı (UTC+4)</dt><dd>{formatWizardDate(draft.schedule.startDate)} · {draft.schedule.startTime}–{draft.schedule.endTime}{draft.schedule.endDate !== draft.schedule.startDate ? ` · ${formatWizardDate(draft.schedule.endDate)}` : ""}</dd></div>
      <div><dt>Məkan</dt><dd>{venue?.name}<br />{venue?.address}{venue?.entry_note ? <><br />{venue.entry_note}</> : null}</dd></div>
      {draft.age ? <div><dt>Yaş həddi</dt><dd>{draft.age}</dd></div> : null}
      {draft.language ? <div><dt>Dil</dt><dd>{EVENT_LANGUAGES.find(([id]) => id === draft.language)?.[1]}</dd></div> : null}
    </dl>
    <h2 className={styles.sectionTitle}>Tədbir haqqında</h2><p className={styles.reviewDescription}>{draft.description}</p>
    <h2 className={styles.sectionTitle}>Biletlər · {allocatedTickets(draft.sales)} / {salesCapacity(draft) ?? "—"} yer</h2>
    {draft.sales.tickets.map(ticket => <div key={ticket.id} className={styles.commission}><strong>{ticket.name}</strong><p>{ticket.paymentType === "free" ? "Pulsuz" : `${ticket.price} AZN`} · {ticket.quantity} bilet</p><small>{ticket.includes}</small></div>)}
    {draft.sales.admissionType === "seated" ? <p className={styles.hint}>Oturacaqlı giriş · {draft.sales.seatPlan?.name} · {salesCapacity(draft)} satış yeri</p> : null}
    {draft.sales.admissionType === "seated" && draft.sales.seatPlan ? <SeatPlanCanvas plan={draft.sales.seatPlan} /> : null}
    <p className={styles.hint}>Satış: {salesSummary(draft)} · Bakı vaxtı</p>
    <p className={styles.hint}>Bir sifarişdə {draft.sales.minPerOrder}–{draft.sales.maxPerOrder} bilet</p>
    {draft.sales.refundPolicy ? <p className={styles.hint}>{({ non_refundable: "Geri qaytarılmır", until_24h: "Başlanğıca 24 saat qalanadək geri qaytarıla bilər", until_72h: "Başlanğıca 72 saat qalanadək geri qaytarıla bilər" })[draft.sales.refundPolicy]}</p> : null}
    <div className={styles.reviewGallery}>{draft.media?.gallery.map((photo, index) => <Image key={index} unoptimized src={photo} width={160} height={100} alt={`Tədbir şəkli ${index + 1}`} />)}</div>
  </>;
}

export function EventReviewStep({ draft, replaceDraft, save, notice, storageError, onEdit, onBack, onExit = onBack }: DraftState & { onEdit: (step: 1 | 2 | 3 | 4) => void; onBack: () => void; onExit?: () => void }) {
  const [view, setView] = useState<"review" | "preview" | "confirm">("review");
  const [eligibility, setEligibility] = useState<SubmissionEligibility | null>(null);
  const [submission, setSubmission] = useState<EventSubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const issues = reviewIssues(draft, checkedAt);
  const locked = Boolean(submission && submission.status !== "changes_requested");

  useEffect(() => {
    if (inFlight.current) return;
    const controller = new AbortController();
    async function read() {
      try {
        const [eligible, current] = await Promise.all([
          eventSubmissionsApi.eligibility(controller.signal),
          draft.submissionId ? eventSubmissionsApi.get(draft.submissionId, controller.signal).catch(cause => { if (cause instanceof ApiError && cause.status === 404) return null; throw cause; }) : Promise.resolve(null),
        ]);
        if (controller.signal.aborted) return;
        setCheckedAt(Date.now()); setEligibility(eligible); setSubmission(current); setUnknown(false); setError("");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setUnknown(Boolean(draft.submissionId)); setError(cause instanceof Error ? cause.message : "Status yoxlanılmadı.");
      } finally { if (!controller.signal.aborted) setChecking(false); }
    }
    void read();
    return () => controller.abort();
  }, [draft.submissionId, refresh]);

  function retryStatus() { if (busy) return; setChecking(true); setRefresh(value => value + 1); }
  async function submit() {
    if (inFlight.current || checking || unknown || locked || !eligibility?.eligible) return;
    const currentIssues = reviewIssues(draft);
    if (currentIssues.length) { setView("review"); setError(currentIssues[0].message); return; }
    const id = draft.submissionId || crypto.randomUUID();
    const snapshot = submissionDraft(draft);
    // Persist the request identity before sending; a lost reply can then be resolved by GET.
    inFlight.current = true;
    replaceDraft({ ...draft, submissionId: id, lastStep: 5 });
    if (!save(false)) { replaceDraft(draft); inFlight.current = false; setError("Sorğunu bərpa etmək üçün qaralama saxlanmalıdır. Yenidən cəhd et."); return; }
    setBusy(true); setError("");
    try { setSubmission(await eventSubmissionsApi.submit(id, snapshot)); setView("review"); setUnknown(false); }
    catch (cause) {
      const uncertain = !(cause instanceof ApiError) || cause.status === null || cause.status >= 500 || cause.status === 409;
      setUnknown(uncertain);
      setError(uncertain ? "Göndərilmə təsdiqi gözlənilir. Yenidən göndərməzdən əvvəl statusu yoxla." : cause.message);
      setView("review");
    } finally { inFlight.current = false; setBusy(false); }
  }
  const previewDraft = locked && submission?.snapshot ? submission.snapshot : draft;
  const frozen = busy || checking || unknown || locked;
  const rows: { step: 1 | 2 | 3 | 4; title: string; summary: string; icon: string }[] = [
    { step: 1, title: "Əsas məlumatlar", summary: draft.title, icon: "review-document" },
    { step: 2, title: "Tarix və məkan", summary: `${formatWizardDate(draft.schedule.startDate)} · ${draft.schedule.startTime}–${draft.schedule.endTime}`, icon: "review-calendar" },
    { step: 3, title: "Satış və biletlər", summary: draft.sales.tickets.map(t => `${t.name} · ${t.quantity} bilet · ${t.paymentType === "free" ? "Pulsuz" : `${t.price} AZN`}`).join("; "), icon: "ticket" },
    { step: 4, title: "Media", summary: `${draft.media?.cover ? "Üz qabığı hazırdır" : "Üz qabığı çatışmır"} · ${draft.media?.gallery.length ?? 0} əlavə şəkil`, icon: "review-document" },
  ];
  return <WizardFrame subtitle={draft.title} onSave={() => save()} onBack={() => {
    if (busy) return;
    if (view !== "review") setView("review"); else if (frozen) onExit(); else onBack();
  }}>
    <div className={styles.form}>
      <div className={styles.content}>
        {view === "preview" ? <Preview draft={previewDraft} /> : <>
          <WizardProgress step={5} />
          {locked ? <div className={styles.reviewStatus} role="status"><h1>{statusTitles[submission!.status]}</h1><p>{submission!.status === "pending" ? "Tədbirin HARA komandasına göndərildi. Təsdiqlənənədək axtarışda və bilet satışında görünməyəcək." : submission!.status === "published" ? "Tədbir artıq iştirakçılara görünür." : "Tədbirin son statusu serverdən alındı."}</p>
            {submission!.status === "published" && submission!.sales_start_at && Date.parse(submission!.sales_start_at) > checkedAt ? <p>Satış {new Intl.DateTimeFormat("az-AZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" }).format(new Date(submission!.sales_start_at))} tarixində açılacaq · Bakı vaxtı.</p> : null}
          </div> : view === "confirm" ? <div className={styles.reviewStatus}><h1>Yoxlamaya göndərək?</h1><p>Məlumatları yoxladığını təsdiqlə. Göndərildikdən sonra HARA komandasının cavabını burada görə biləcəksən.</p></div> : <>
            <div className={`${styles.introduction} ${styles.reviewIntro}`}><h1>Yoxla və yayımla</h1><p>Son dəfə nəzərdən keçir. İstənilən bölməni dəyişə bilərsən.</p></div>
            {submission?.status === "changes_requested" ? <AuthMessage>Düzəliş tələb olunur: {submission.note}</AuthMessage> : null}
            {rows.map(row => <div key={row.step}><button disabled={frozen} aria-label={`${row.title}: ${row.summary}. Düzəliş et`} className={styles.reviewRow} onClick={() => onEdit(row.step)}><span className={styles.ticketIcon}><WizardIcon name={row.icon} /></span><span><strong>{row.title}</strong><small>{row.summary}</small></span><WizardIcon name="forward" /></button>{row.step === 2 ? <p className={styles.hint}>{draft.schedule.venue?.name} · Bakı vaxtı</p> : null}</div>)}
            {issues.map((issue, index) => <div key={index} className={styles.reviewIssue}><p>{issue.message}</p><button disabled={frozen} onClick={() => onEdit(issue.step)}>Düzəliş et</button></div>)}
            <button className={styles.reviewPreview} onClick={() => setView("preview")}>İştirakçı kimi önbaxış <WizardIcon name="forward" /></button>
            <div className={styles.reviewNotice}><strong>Əvvəlcə HARA yoxlayacaq</strong><p>Göndərdikdən sonra statusu izləyə biləcəksən. Təsdiqlənənədək tədbir axtarışda və bilet satışında görünməyəcək.</p></div>
            {eligibility ? <div className={styles.reviewNotice}><strong>{eligibility.eligible ? "Təşkilatçı hesabı hazırdır" : "Təşkilatçı məlumatlarını yoxla"}</strong><p>{eligibility.detail}</p>{!eligibility.eligible ? <Link className={styles.retry} href="/personal-info?edit=1">Profilə keç</Link> : null}</div> : null}
          </>}
          {locked || view === "confirm" ? <button disabled={busy} className={styles.reviewPreview} onClick={() => setView("preview")}>İştirakçı kimi önbaxış <WizardIcon name="forward" /></button> : null}
        </>}
        {busy ? <p role="status">Tədbir göndərilir…</p> : checking ? <p role="status">Status yoxlanılır…</p> : null}
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        {storageError ? <AuthMessage>Qaralama saxlanılmadı. <button className={styles.retry} onClick={() => save()}>Yenidən cəhd et</button></AuthMessage> : notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
      </div>
      <footer className={styles.footer}>
        {view === "preview" ? <button className={styles.next} onClick={() => setView("review")}>Yekun yoxlamaya qayıt</button> : locked ? <>
          {submission!.status === "published" ? <Link className={styles.next} href={`/events/${submission!.event_slug}`}>Tədbirə bax</Link> : <button className={styles.next} disabled={checking || busy} onClick={retryStatus}>Statusu yenilə</button>}
          <Link className={styles.addTicket} href="/my-events">Tədbirlərim</Link>
        </> : unknown || (!eligibility && error) ? <button className={styles.next} disabled={busy || checking} onClick={retryStatus}>Statusu yoxla</button> : <>
          <button className={styles.next} disabled={busy || checking || Boolean(issues.length) || !eligibility?.eligible} onClick={() => view === "confirm" ? void submit() : setView("confirm")}>{busy ? "Göndərilir…" : view === "confirm" ? "Təsdiqlə və göndər" : submission?.status === "changes_requested" ? "Yenidən yoxlamaya göndər" : "Yoxlamaya göndər"}</button>
          {view === "confirm" ? <button disabled={busy} className={styles.addTicket} onClick={() => setView("review")}>Geri qayıt</button> : <p>Təsdiqdən sonra tədbirin görünəcək.</p>}
        </>}
      </footer>
    </div>
  </WizardFrame>;
}
