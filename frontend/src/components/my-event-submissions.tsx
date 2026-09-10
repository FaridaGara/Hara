"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { eventSubmissionsApi, type EventSubmission } from "@/lib/api/event-submissions";
import { EMPTY_EVENT_DRAFT, readEventDraft, saveEventDraft } from "@/lib/event-draft";
import { submissionDraft } from "@/lib/event-review";
import { submissionStatuses, submissionTime } from "@/lib/submission-status";
import { useAuth } from "./auth-provider";
import { AuthMessage } from "./auth-ui";
import { LifecyclePage, LifecycleIntro, LifecycleState, LifecycleLoading, SubmissionCard } from "./lifecycle-ui";
import styles from "./lifecycle-ui.module.css";

function AccountEventSubmissions() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<EventSubmission[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [checkedAt, setCheckedAt] = useState("");
  const [filter, setFilter] = useState<"all" | EventSubmission["status"]>("all");
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    return eventSubmissionsApi.list(controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data); setError(""); setCheckedAt(new Date().toISOString()); }
    }).catch(() => {
      if (!controller.signal.aborted) setError("Statuslar yenilənmədi. Yenidən cəhd et.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => { if (document.visibilityState === "visible") { setLoading(true); void refresh(); } };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const interval = window.setInterval(onFocus, 60_000);
    return () => { request.current?.abort(); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); window.clearInterval(interval); };
  }, [refresh]);

  async function edit(item: EventSubmission) {
    if (!user || opening) return;
    setOpening(true);
    try {
      const data = await eventSubmissionsApi.get(item.id);
      if (data.status !== "changes_requested") { await refresh(); return; }
      if (!data.snapshot) throw new Error();
      const current = readEventDraft(user.id);
      if (current.title && current.submissionId !== item.id && JSON.stringify(submissionDraft(current)) !== JSON.stringify(submissionDraft(data.snapshot)) && !window.confirm("Hazırkı brauzer qaralaman bu tədbirlə əvəz ediləcək. Davam edək?")) return;
      if (!saveEventDraft(user.id, { ...data.snapshot, submissionId: item.id, lastStep: 5 })) throw new Error();
      router.push("/create-event?step=5");
    } catch { setError("Tədbir açıla bilmədi. Yenidən cəhd et."); }
    finally { setOpening(false); }
  }
  function create() {
    if (!user || opening) return;
    if (readEventDraft(user.id).title && !window.confirm("Yeni tədbir üçün brauzer qaralaması təmizlənəcək. Göndərilmiş tədbirlər hesabında qalacaq. Davam edək?")) return;
    if (!saveEventDraft(user.id, structuredClone(EMPTY_EVENT_DRAFT))) { setError("Yeni qaralama saxlanılmadı. Yenidən cəhd et."); return; }
    router.push("/create-event?step=1");
  }
  const visible = items.filter(item => filter === "all" || item.status === filter);
  const filters = ["all", "pending", "published", ...(["changes_requested", "cancelled", "completed"] as const).filter(status => filter === status || items.some(item => item.status === status))] as const;
  return <LifecyclePage title="Tədbirlərim" backHref="/more" footer={<button className={styles.primary} disabled={opening} onClick={create}>Yeni tədbir yarat</button>}>
    {items.length || loading || error ? <LifecycleIntro title="Tədbirlərini izləyin">Göndərdiyiniz tədbirlərin statusu və komandanın rəyi burada görünür.</LifecycleIntro> : null}
    {items.length ? <nav className={styles.tabs} aria-label="Tədbir statusu">{filters.map(status => <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === "all" ? "Hamısı" : status === "pending" ? "Yoxlamada" : submissionStatuses[status].label} · {status === "all" ? items.length : items.filter(item => item.status === status).length}</button>)}</nav> : null}
    {loading && !items.length ? <LifecycleLoading label="Tədbirlər yüklənir…" /> : null}
    {error ? <AuthMessage>{error}</AuthMessage> : null}
    {!items.length && !loading && !error ? <LifecycleState title="İlk tədbirinizi göndərin" action={<Link className={styles.secondary} href="/create-event">Qaralamaya qayıt</Link>}>Qaralama saxlamaq tədbiri yoxlamaya göndərmir. 5-ci addımda “Təsdiqlə və göndər” düyməsini seçin. Göndərildikdən sonra tədbiriniz burada görünəcək.</LifecycleState> : null}
    <div className={styles.stack} aria-live="polite" aria-busy={loading}>
      {visible.map(item => <SubmissionCard key={item.id} item={item} action={item.status === "changes_requested" ? <button className={styles.secondary} disabled={opening} onClick={() => void edit(item)}>Düzəliş et və yenidən göndər</button> : item.status === "published" && item.event_slug ? <Link className={styles.secondary} href={`/events/${item.event_slug}`}>Tədbirə bax</Link> : null}>
        <dl className={styles.receipt}>
          {item.submitted_at ? <div><dt>Göndərildi · Bakı vaxtı</dt><dd><time dateTime={item.submitted_at}>{submissionTime(item.submitted_at)}</time></dd></div> : null}
          {item.updated_at && item.updated_at !== item.submitted_at ? <div><dt>Son dəyişiklik</dt><dd><time dateTime={item.updated_at}>{submissionTime(item.updated_at)}</time></dd></div> : null}
        </dl>
        <p className={styles.meta}>{submissionStatuses[item.status].description}</p>
        {item.note ? <div className={styles.note}><strong>{item.status === "cancelled" ? "Dayandırılma səbəbi" : "Moderatorun qeydi"}</strong><p>{item.note}</p></div> : null}
      </SubmissionCard>)}
      {items.length > 0 && !visible.length ? <p className={styles.meta}>Bu statusda tədbir yoxdur.</p> : null}
    </div>
    <div className={styles.refresh}>{checkedAt ? <span>Son yenilənmə: {submissionTime(checkedAt)}</span> : null}<button className={styles.textButton} aria-label="Statusları yenilə" disabled={loading} onClick={() => { setLoading(true); void refresh(); }}>{loading ? "Yenilənir…" : "Yenilə"}</button></div>
    {items.length ? <Link className={styles.textButton} href="/create-event">Qaralamaya qayıt</Link> : null}
  </LifecyclePage>;
}

export function MyEventSubmissions() {
  const { user } = useAuth();
  return user ? <AccountEventSubmissions key={user.id} /> : null;
}
