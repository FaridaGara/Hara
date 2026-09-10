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
import styles from "./event-wizard.module.css";

function AccountEventSubmissions() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<EventSubmission[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [checkedAt, setCheckedAt] = useState("");
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
  return <main className={`hara-auth ${styles.page}`}><section className={styles.shell}><div className={styles.content}>
    <Link className={styles.retry} href="/more">Profilə qayıt</Link>
    <div className={styles.introduction}><h1>Tədbirlərim</h1><p>Göndərdiyin tədbirləri və moderatorun cavabını burada izləyə bilərsən.</p></div>
    <button className={styles.addTicket} disabled={loading} onClick={() => { setLoading(true); void refresh(); }}>{loading ? "Statuslar yoxlanılır…" : "Statusları yenilə"}</button>
    {checkedAt ? <p className={styles.hint}>Son yoxlama: {submissionTime(checkedAt)} · Bakı vaxtı. Səhifə açıq olduqda statuslar hər dəqiqə yenilənir.</p> : null}
    {error ? <AuthMessage>{error}</AuthMessage> : null}
    {!items.length && !loading && !error ? <div className={styles.reviewNotice}><strong>Hələ tədbir göndərilməyib</strong><p>Qaralama saxlamaq tədbiri yoxlamaya göndərmir. 5-ci addımda “Təsdiqlə və göndər” düyməsini seç. Uğurlu göndərilmədən sonra tədbirin burada görünəcək.</p></div> : null}
    <div className={styles.submissionList} aria-live="polite" aria-busy={loading}>
      {items.map(item => <article key={item.id} className={styles.submissionCard} aria-label={item.title}>
        <div className={styles.submissionHeading}><h2>{item.title}</h2><span className={styles.submissionBadge} data-status={item.status}>{submissionStatuses[item.status].label}</span></div>
        <p>{submissionStatuses[item.status].description}</p>
        <dl className={styles.reviewDetails}>
          {item.submitted_at ? <div><dt>Göndərildi · Bakı vaxtı</dt><dd><time dateTime={item.submitted_at}>{submissionTime(item.submitted_at)}</time></dd></div> : null}
          {item.updated_at ? <div><dt>Son dəyişiklik · Bakı vaxtı</dt><dd><time dateTime={item.updated_at}>{submissionTime(item.updated_at)}</time></dd></div> : null}
        </dl>
        {item.note ? <div className={styles.reviewNotice}><strong>Moderatorun qeydi</strong><p className={styles.reviewDescription}>{item.note}</p></div> : null}
        {item.status === "changes_requested" ? <button className={styles.addTicket} disabled={opening} onClick={() => void edit(item)}>Düzəliş et və yenidən göndər</button> : null}
        {item.status === "published" ? <Link className={styles.addTicket} href={`/events/${item.event_slug}`}>Tədbirə bax</Link> : null}
      </article>)}
    </div>
    <Link className={styles.addTicket} href="/create-event">Qaralamaya qayıt</Link>
    <button className={styles.next} disabled={opening} onClick={create}>Yeni tədbir yarat</button>
  </div></section></main>;
}

export function MyEventSubmissions() {
  const { user } = useAuth();
  return user ? <AccountEventSubmissions key={user.id} /> : null;
}
