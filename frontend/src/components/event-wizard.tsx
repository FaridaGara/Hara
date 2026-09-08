"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

import type { UserProfile } from "@/lib/api";
import {
  EVENT_AGES, EVENT_CATEGORIES, EVENT_LANGUAGES,
  isEventDraftComplete, readEventDraft, saveEventDraft, type EventDraft,
} from "@/lib/event-draft";

import { useAuth } from "./auth-provider";
import { AuthMessage } from "./auth-ui";
import { PageLoader } from "./states";
import styles from "./event-wizard.module.css";

function WizardIcon({ name, className = "hara-auth-icon" }: { name: string; className?: string }) {
  return <Image src={`/figma/create-event/${name}.svg`} alt="" width={24} height={24} className={className} />;
}

function SelectField({ label, children, value, onChange, required = false }: {
  label: string; children: ReactNode; value: string;
  onChange: (value: string) => void; required?: boolean;
}) {
  return (
    <label className={`${styles.field} ${styles.selectField}`}>
      <span>{label}{required ? " *" : ""}</span>
      <select aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Seçin</option>
        {children}
      </select>
      <span className={styles.chevron} aria-hidden="true"><WizardIcon name="down" /></span>
    </label>
  );
}

// This increment implements step 1. The date/location step connects this callback next.
export function EventDetailsStep({ user, onNext }: {
  user: UserProfile; onNext?: (draft: EventDraft) => void;
}) {
  const [draft, setDraft] = useState(() => readEventDraft(user.id));
  const [notice, setNotice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);

  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    const nextDraft = { ...draft, [key]: value };
    setDraft(nextDraft);
    setNotice(null);
    setStorageError(!saveEventDraft(user.id, nextDraft));
  }

  function save() {
    const saved = saveEventDraft(user.id, draft);
    setStorageError(!saved);
    setNotice(saved ? "Qaralama bu brauzerdə saxlanıldı." : null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onNext || !isEventDraftComplete(draft)) return;
    save();
    onNext(draft);
  }

  const displayName = user.display_name || [user.first_name, user.last_name].filter(Boolean).join(" ");

  return (
    <main className={`hara-auth ${styles.page}`}>
      <section className={styles.shell} aria-label="Tədbir yarat">
        <header className={styles.header}>
          <Link href="/" aria-label="Tədbir formasını bağla" className={styles.iconButton}>
            <WizardIcon name="close" />
          </Link>
          <div className={styles.heading}>
            <p>Tədbir yarat</p>
            <span>{displayName ? `${displayName} adından` : "Öz adından"}</span>
          </div>
          <button type="button" aria-label="Qaralamanı bu brauzerdə saxla" className={styles.iconButton} onClick={save}>
            <WizardIcon name="save" />
          </button>
        </header>

        <form onSubmit={submit} className={styles.form}>
          <div className={styles.content}>
            <div className={styles.progress}>
              <p>Addım 1 / 5</p>
              <div role="progressbar" aria-label="Tədbir yaratma mərhələsi" aria-valuemin={0} aria-valuemax={5} aria-valuenow={1}>
                <span />
              </div>
            </div>
            <div className={styles.introduction}>
              <h1>Əsas məlumatlar</h1>
              <p>Tədbirini qısa və aydın təsvir et.</p>
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Tədbirin adı *</span>
                <input aria-label="Tədbirin adı" name="title" required maxLength={255} placeholder="Bakı Caz Gecəsi 2026" value={draft.title} onChange={(event) => update("title", event.target.value)} />
              </label>
              <SelectField label="Kateqoriya" required value={draft.category} onChange={(value) => update("category", value)}>
                {EVENT_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </SelectField>
              <div className={styles.description}>
                <label className={`${styles.field} ${styles.textarea}`}>
                  <span>Tədbir haqqında *</span>
                  <textarea aria-label="Tədbir haqqında" name="description" required maxLength={1000} aria-describedby="description-count" placeholder="Tədbirini təsvir et…" value={draft.description} onChange={(event) => update("description", event.target.value)} />
                </label>
                <p id="description-count" className={styles.counter}>{draft.description.length} / 1000</p>
              </div>
              <div className={styles.row}>
                <SelectField label="Yaş həddi" value={draft.age} onChange={(value) => update("age", value)}>
                  {EVENT_AGES.map((age) => <option key={age}>{age}</option>)}
                </SelectField>
                <SelectField label="Dil" value={draft.language} onChange={(value) => update("language", value)}>
                  {EVENT_LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </SelectField>
              </div>
              <label className={styles.field}>
                <span>Müddət</span>
                <span className={styles.duration}>
                  <input aria-label="Müddət (dəqiqə)" name="duration" inputMode="numeric" maxLength={5} pattern="[0-9]+" placeholder="120" value={draft.duration} onChange={(event) => update("duration", event.target.value.replace(/\D/g, "").slice(0, 5))} />
                  <span>dəqiqə</span>
                </span>
              </label>
            </div>
            <p className={styles.required}>* işarəli sahələri doldurmaq mütləqdir.</p>
            {storageError ? <AuthMessage>Qaralama saxlanılmadı. Məlumatları itirməmək üçün bu səhifəni açıq saxlayın.</AuthMessage> : null}
            {notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
          </div>
          <footer className={styles.footer}>
            <button type="submit" className={styles.next} disabled={!onNext || !isEventDraftComplete(draft)} aria-describedby="event-next-step">
              Növbəti addım <WizardIcon name="next" className={styles.nextIcon} />
            </button>
            <p id="event-next-step">Növbəti: Tarix və məkan</p>
          </footer>
        </form>
      </section>
    </main>
  );
}

export function EventWizard() {
  const { user } = useAuth();
  if (!user) return <PageLoader label="Hesab məlumatları yüklənir…" />;
  // Remount on account changes so one account never inherits another account's form.
  return <EventDetailsStep key={user.id} user={user} />;
}
