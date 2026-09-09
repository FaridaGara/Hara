"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { eventSubmissionsApi, type EventSubmission } from "@/lib/api/event-submissions";
import { EMPTY_EVENT_DRAFT, readEventDraft, saveEventDraft } from "@/lib/event-draft";
import { submissionDraft } from "@/lib/event-review";
import { useAuth } from "./auth-provider";
import { AuthMessage } from "./auth-ui";
import styles from "./event-wizard.module.css";
export function MyEventSubmissions() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<EventSubmission[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; eventSubmissionsApi.list().then(data => { if (active) { setItems(data); setError(""); } }).catch(() => { if (active) setError("Tədbirlər yüklənmədi."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [retry]);
  async function open(item: EventSubmission) {
    if (!user || loading) return;
    setLoading(true);
    try {
      const data = await eventSubmissionsApi.get(item.id);
      if (!data.snapshot) throw new Error();
      const current = readEventDraft(user.id);
      if (current.title && JSON.stringify(submissionDraft(current)) !== JSON.stringify(submissionDraft(data.snapshot)) && !window.confirm("Hazırkı brauzer qaralaman bu tədbirlə əvəz ediləcək. Davam edək?")) return;
      if (!saveEventDraft(user.id, { ...data.snapshot, submissionId: item.id, lastStep: 5 })) throw new Error();
      router.push("/create-event?step=5");
    } catch { setError("Tədbir açıla bilmədi. Yenidən cəhd et."); }
    finally { setLoading(false); }
  }
  function create() {
    if (!user || loading) return;
    if (readEventDraft(user.id).title && !window.confirm("Yeni tədbir üçün brauzer qaralaması təmizlənəcək. Göndərilmiş tədbirlər hesabında qalacaq. Davam edək?")) return;
    if (!saveEventDraft(user.id, structuredClone(EMPTY_EVENT_DRAFT))) { setError("Yeni qaralama saxlanılmadı. Yenidən cəhd et."); return; }
    router.push("/create-event?step=1");
  }
  return <main className={`hara-auth ${styles.page}`}><section className={styles.shell}><div className={styles.content}>
    <Link className={styles.retry} href="/">Ana səhifə</Link><div className={styles.introduction}><h1>Tədbirlərim</h1></div>
    {loading ? <p role="status">Yüklənir…</p> : null}
    {error ? <AuthMessage>{error} <button className={styles.retry} onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Yenidən cəhd et</button></AuthMessage> : null}
    {!items.length && !loading && !error ? <p>Hələ yoxlamaya göndərilmiş tədbirin yoxdur.</p> : null}
    {items.map(item => <button key={item.id} className={styles.venueResult} disabled={loading} onClick={() => void open(item)}><span><strong>{item.title}</strong><small>{({ pending: "Yoxlanılır", changes_requested: "Düzəliş tələb olunur", published: "Yayımlanıb", cancelled: "Ləğv edilib", completed: "Tamamlanıb" })[item.status]}</small></span></button>)}
    <Link className={styles.addTicket} href="/create-event">Qaralamaya qayıt</Link>
    <button className={styles.next} disabled={loading} onClick={create}>Yeni tədbir yarat</button>
  </div></section></main>;
}
