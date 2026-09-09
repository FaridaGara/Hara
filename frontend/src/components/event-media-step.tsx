"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { useEventDraft } from "@/hooks/use-event-draft";
import { AuthMessage } from "./auth-ui";
import { WizardFrame, WizardProgress } from "./event-wizard-layout";
import styles from "./event-wizard.module.css";

// Store durable, bounded image bytes rather than object URLs that die on reload.
async function readPhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10_000_000) throw new Error("JPG, PNG və ya WebP seç (maksimum 10 MB).");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("Şəklin ölçüsü həddindən artıq böyükdür.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Şəkil hazırlana bilmədi.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.85, .7, .55, .4, .25]) {
      const value = canvas.toDataURL("image/jpeg", quality);
      if (value.length <= 250_000) return value;
    }
    throw new Error("Şəkli daha kiçik ölçüdə yüklə.");
  } finally { bitmap.close(); }
}

export function EventMediaStep({ draft, replaceDraft, save, storageError, notice, onBack, onNext, reviewEdit = false }: ReturnType<typeof useEventDraft> & { onBack: () => void; onNext: () => void; reviewEdit?: boolean }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const media = draft.media ?? { cover: "", gallery: [] };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  async function upload(files: FileList | null, cover: boolean) {
    if (!files?.length || busy) return;
    setBusy(true); setError("");
    try {
      if (!cover && files.length + media.gallery.length > 4) throw new Error("Maksimum 4 əlavə şəkil seçə bilərsən.");
      const images = await Promise.all(Array.from(files).map(readPhoto));
      if (!mounted.current) return;
      replaceDraft({ ...draft, media: cover ? { ...media, cover: images[0] } : { ...media, gallery: [...media.gallery, ...images] } });
      save(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Şəkil yüklənmədi."); }
    finally { setBusy(false); }
  }
  return <WizardFrame subtitle={draft.title} onBack={() => { if (!busy) { save(false); onBack(); } }} onSave={() => save()}>
    <div className={styles.form}>
      <div className={styles.content}>
        <WizardProgress step={4} />
        <div className={styles.introduction}><h1>Media</h1><p>Tədbirinin üz qabığını və əlavə şəkillərini seç.</p></div>
        <h2 className={styles.sectionTitle}>Üz qabığı *</h2>
        {media.cover ? <Image unoptimized src={media.cover} width={370} height={208} alt="Tədbirin üz qabığı" className={styles.reviewCover} /> : <p className={styles.hint}>İştirakçılar tədbirini bu şəkillə görəcəklər.</p>}
        <input ref={coverInput} className={styles.hiddenFile} aria-label="Üz qabığı faylı" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void upload(event.target.files, true); event.target.value = ""; }} />
        <button className={styles.addTicket} disabled={busy} onClick={() => coverInput.current?.click()}>{media.cover ? "Üz qabığını dəyiş" : "Üz qabığı əlavə et"}</button>
        {media.cover ? <button className={styles.dangerAction} disabled={busy} onClick={() => { replaceDraft({ ...draft, media: { ...media, cover: "" } }); save(false); }}>Üz qabığını sil</button> : null}
        <h2 className={styles.sectionTitle}>Qalereya · {media.gallery.length} / 4</h2>
        <div className={styles.reviewGallery}>{media.gallery.map((photo, index) => <div key={index}>
          <Image unoptimized src={photo} width={160} height={100} alt={`Əlavə şəkil ${index + 1}`} />
          <button aria-label={`Şəkil ${index + 1} sil`} disabled={busy} className={styles.dangerAction} onClick={() => { replaceDraft({ ...draft, media: { ...media, gallery: media.gallery.filter((_, i) => i !== index) } }); save(false); }}>Sil</button>
        </div>)}</div>
        <input ref={galleryInput} className={styles.hiddenFile} aria-label="Qalereya faylları" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => { void upload(event.target.files, false); event.target.value = ""; }} />
        <button className={styles.addTicket} disabled={busy || media.gallery.length === 4} onClick={() => galleryInput.current?.click()}>Şəkil əlavə et</button>
        <p className={styles.hint}>JPG, PNG və WebP · hər fayl maksimum 10 MB</p>
        {busy ? <p role="status">Şəkil hazırlanır…</p> : null}
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        {storageError ? <AuthMessage>Qaralama saxlanılmadı. <button className={styles.retry} onClick={() => save()}>Yenidən cəhd et</button></AuthMessage> : notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
      </div>
      <footer className={styles.footer}><button className={styles.next} disabled={busy} onClick={() => { save(false); onNext(); }}>{reviewEdit ? "Dəyişiklikləri tətbiq et" : "Növbəti addım"}</button><p>Yekun yoxlamaya qayıdacaqsan</p></footer>
    </div>
  </WizardFrame>;
}
