"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, type FormEvent, type ReactNode } from "react";

import type { UserProfile } from "@/lib/api";
import {
  EVENT_AGES, EVENT_CATEGORIES, EVENT_LANGUAGES,
  isEventDraftComplete, type EventDraft,
} from "@/lib/event-draft";
import { isScheduleComplete, suggestedEnd } from "@/lib/event-schedule";
import { useEventDraft } from "@/hooks/use-event-draft";

import { useAuth } from "./auth-provider";
import { AuthMessage } from "./auth-ui";
import { PageLoader } from "./states";
import { WizardFrame, WizardIcon, WizardProgress } from "./event-wizard-layout";
import { EventDateVenueStep } from "./event-date-venue-step";
import { EventSalesTicketStep } from "./event-sales-ticket-step";
import styles from "./event-wizard.module.css";

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

export function EventDetailsStep({ user, onNext }: {
  user: UserProfile; onNext?: (draft: EventDraft) => void;
}) {
  const state = useEventDraft(user.id);
  return <EventDetailsForm user={user} onNext={onNext} {...state} />;
}

function EventDetailsForm({ user, onNext, draft, replaceDraft, save, notice, storageError }: {
  user: UserProfile; onNext?: (draft: EventDraft) => void;
} & ReturnType<typeof useEventDraft>) {

  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    const nextDraft = { ...draft, [key]: value };
    if (key === "duration" && !draft.schedule.endEdited) {
      const end = suggestedEnd(draft.schedule, String(value));
      if (end) nextDraft.schedule = { ...draft.schedule, ...end };
    }
    replaceDraft(nextDraft);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onNext || !isEventDraftComplete(draft)) return;
    save();
    onNext(draft);
  }

  const displayName = user.display_name || [user.first_name, user.last_name].filter(Boolean).join(" ");

  return (
    <WizardFrame subtitle={displayName ? `${displayName} adından` : "Öz adından"} onSave={() => save()}>
        <form onSubmit={submit} onBlurCapture={() => save(false)} className={styles.form}>
          <div className={styles.content}>
            <WizardProgress step={1} />
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
                <SelectField label="Tədbirin dili" value={draft.language} onChange={(value) => update("language", value)}>
                  {EVENT_LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </SelectField>
              </div>
              <label className={styles.field}>
                <span>Müddət (istəyə bağlı)</span>
                <span className={styles.duration}>
                  <input aria-label="Müddət (dəqiqə)" name="duration" inputMode="numeric" maxLength={5} pattern="[0-9]+" placeholder="120" value={draft.duration} onChange={(event) => update("duration", event.target.value.replace(/\D/g, "").slice(0, 5))} />
                  <span>dəqiqə</span>
                </span>
              </label>
            </div>
            <p className={styles.required}>* işarəli sahələri doldurmaq mütləqdir.</p>
            {storageError ? <AuthMessage>Qaralama saxlanılmadı. <button type="button" className={styles.retry} onClick={() => save()}>Yenidən cəhd et</button></AuthMessage> : null}
            {notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
          </div>
          <footer className={styles.footer}>
            <button type="submit" className={styles.next} disabled={!onNext || !isEventDraftComplete(draft)} aria-describedby="event-next-step">
              Növbəti addım <WizardIcon name="next" className={styles.nextIcon} />
            </button>
            <p id="event-next-step">Növbəti: Tarix və məkan</p>
          </footer>
        </form>
    </WizardFrame>
  );
}

function AccountEventWizard({ user }: { user: UserProfile }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useEventDraft(user.id);
  const requested = searchParams.get("step");
  const canOpenSecond = isEventDraftComplete(state.draft);
  const canOpenThird = canOpenSecond && isScheduleComplete(state.draft.schedule);
  const wantsThird = requested === "3" || (!requested && state.draft.lastStep === 3);
  const wantsSecond = wantsThird || requested === "2" || (!requested && state.draft.lastStep === 2);
  const step = wantsThird && canOpenThird ? 3 : wantsSecond && canOpenSecond ? 2 : 1;

  useEffect(() => {
    // Canonical URLs let browser Back work as well as the wizard's own Back button.
    if (requested !== String(step)) router.replace(`/create-event?step=${step}`);
  }, [requested, router, step]);

  function goTo(nextStep: 1 | 2 | 3) {
    state.replaceDraft({ ...state.draft, lastStep: nextStep });
    state.save(false);
    router.push(`/create-event?step=${nextStep}`);
  }

  if (step === 1) return <EventDetailsForm user={user} {...state} onNext={() => goTo(2)} />;
  if (step === 2) return <EventDateVenueStep {...state} onBack={() => goTo(1)} onNext={() => goTo(3)} />;
  return <EventSalesTicketStep {...state} onBack={() => goTo(2)} />;
}

export function EventWizard() {
  const { user } = useAuth();
  if (!user) return <PageLoader label="Hesab məlumatları yüklənir…" />;
  // Remount on account changes so one account never inherits another account's form.
  return <AccountEventWizard key={user.id} user={user} />;
}
