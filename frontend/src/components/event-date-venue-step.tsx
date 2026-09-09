"use client";

import { venuePlanKey } from "@/lib/seat-plan";

import dynamic from "next/dynamic";
import { useEffect, useState, type FormEvent } from "react";
import { venuesApi, type VenueChoice } from "@/lib/api";
import type { EventDraft } from "@/lib/event-draft";
import {
  changeStart, formatDuration, formatWizardDate, isScheduleComplete, scheduleError,
  scheduleMinutes, suggestedEnd, validCoordinates, wallTime, type EventSchedule,
} from "@/lib/event-schedule";
import type { useEventDraft } from "@/hooks/use-event-draft";
import { AuthMessage } from "./auth-ui";
import { EventDatePicker } from "./event-date-picker";
import { WizardFrame, WizardIcon, WizardProgress } from "./event-wizard-layout";
import styles from "./event-wizard.module.css";

const VenuePinMap = dynamic(() => import("./venue-pin-map").then((module) => module.VenuePinMap), {
  ssr: false, loading: () => <div className={styles.venueMap} role="status">Xəritə yüklənir…</div>,
});

function VenueSearch({ query, onQuery, onSelect }: {
  query: string; onQuery: (value: string) => void; onSelect: (venue: VenueChoice) => void;
}) {
  const [results, setResults] = useState<VenueChoice[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      venuesApi.search(query, controller.signal).then((venues) => {
        if (controller.signal.aborted) return;
        setResults(venues.filter((venue) => validCoordinates(venue.latitude, venue.longitude)));
        setStatus("ready");
      }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, attempt]);
  return <>
    <div className={styles.introduction}><h1>Məkan seç</h1><p>Ad və ya ünvanla axtar.</p></div>
    <label className={styles.field}><span>Məkan axtar</span>
      <input aria-label="Məkan axtar" type="search" maxLength={128} placeholder="Məkan adı və ya ünvan" value={query}
        onChange={(event) => { setStatus("loading"); onQuery(event.target.value); }} />
    </label>
    <div className={styles.venueResults} aria-live="polite">
      <h2>Axtarış nəticəsi</h2>
      {status === "loading" ? <p className={styles.hint} role="status">Məkanlar axtarılır…</p> : null}
      {status === "error" ? <AuthMessage>Məkanlar yüklənmədi. <button type="button" className={styles.retry} onClick={() => { setStatus("loading"); setAttempt((value) => value + 1); }}>Yenidən cəhd et</button></AuthMessage> : null}
      {status === "ready" && results.length === 0 ? <p className={styles.hint}>Məkan tapılmadı. Ünvanı əl ilə əlavə edə bilərsən.</p> : null}
      {status === "ready" ? results.map((venue) => <button type="button" key={venue.id} className={styles.venueResult} onClick={() => onSelect(venue)} aria-label={`${venue.name} məkanını seç`}>
        <span><strong>{venue.name}</strong><span>{venue.address}</span><small>{venue.plan_id ? `${venue.capacity != null ? `${venue.capacity} yer · ` : ""}Hazır məkan planı` : "Hazır məkan planı yoxdur"}</small></span>
        <WizardIcon name="forward" />
      </button>) : null}
    </div>
  </>;
}

export function EventDateVenueStep({ draft, replaceDraft, save, notice, storageError, onBack, onNext, reviewEdit = false }: ReturnType<typeof useEventDraft> & {
  onBack: () => void; onNext?: (draft: EventDraft) => void; reviewEdit?: boolean;
}) {
  const [view, setView] = useState<"details" | "search" | "manual">("details");
  const [query, setQuery] = useState("");
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  const [touched, setTouched] = useState({ start: false, end: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const schedule = draft.schedule;
  const start = wallTime(schedule.startDate, schedule.startTime);
  const end = wallTime(schedule.endDate, schedule.endTime);
  const startError = start === null ? "Başlama tarixini və saatını seç." : start - 4 * 60 * 60 * 1000 <= now ? "Başlama vaxtı gələcəkdə olmalıdır." : null;
  const endError = end === null ? "Bitmə tarixini və saatını seç." : start !== null && end <= start ? "Bitmə vaxtı başlamadan sonra olmalıdır." : null;
  const displayedError = (touched.start && startError) || (touched.end && endError);
  const suggestion = suggestedEnd(schedule, draft.duration);
  const manual = schedule.manualVenue;
  const manualComplete = Boolean(manual.name.trim() && manual.address.trim() && validCoordinates(manual.latitude, manual.longitude));

  function openView(next: typeof view) { save(false); setView(next); }
  function updateSchedule(next: EventSchedule, updateDuration = false) {
    const minutes = updateDuration ? scheduleMinutes(next) : null;
    const planChanged = venuePlanKey(next.venue) !== venuePlanKey(schedule.venue) || next.venue?.plan_id !== schedule.venue?.plan_id;
    replaceDraft({
      ...draft,
      schedule: next,
      duration: minutes && minutes <= 99999 ? String(minutes) : draft.duration,
      sales: planChanged ? { ...draft.sales, seatPlanApplied: false, seatPlanSource: null } : draft.sales,
    });
  }
  function updateTime(kind: "start" | "end", date: string, time: string) {
    if (kind === "start") {
      updateSchedule(changeStart(schedule, date, time, draft.duration), schedule.endEdited);
    } else {
      updateSchedule({ ...schedule, endDate: date, endTime: time, endEdited: true }, true);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (view === "manual") {
      if (!manualComplete) return;
      const next: EventSchedule = { ...schedule, venue: {
        id: null, source: "manual", name: manual.name.trim(), address: manual.address.trim(), city: "",
        latitude: manual.latitude, longitude: manual.longitude, entry_note: manual.entryNote.trim(), plan_id: null, capacity: null,
      } };
      updateSchedule(next); save(false); setView("details");
    } else if (view === "details") {
      setTouched({ start: true, end: true });
      if (!isScheduleComplete(schedule)) return;
      save(false); onNext?.(draft);
    }
  }

  const nextHint = endError && touched.end ? "Davam etmək üçün bitmə vaxtını düzəlt"
    : scheduleError(schedule, now) ? "Davam etmək üçün tarix və saatı seç"
    : !schedule.venue ? "Davam etmək üçün məkan seç" : "Növbəti: Satış və biletlər";

  return <WizardFrame subtitle={draft.title} onSave={() => save()} onBack={() => {
    save(false);
    if (view === "manual") setView("search");
    else if (view === "search") setView("details");
    else onBack();
  }}>
    <form className={styles.form} onSubmit={submit} onBlurCapture={() => save(false)}>
      <div className={styles.content}>
        {view === "details" ? <>
          <WizardProgress step={2} />
          <div className={styles.introduction}><h1>Tarix və məkan</h1><p>Tədbir nə vaxt və harada olacaq?</p></div>
          <section className={styles.scheduleFields} aria-label="Tarix və saat">
            <h2>Tarix və saat · Bakı (UTC+4)</h2>
            {(["start", "end"] as const).map((kind) => {
              const date = kind === "start" ? schedule.startDate : schedule.endDate;
              const time = kind === "start" ? schedule.startTime : schedule.endTime;
              const label = kind === "start" ? "Başlama" : "Bitmə";
              const invalid = Boolean(touched[kind] && (kind === "start" ? startError : endError));
              return <div className={styles.dateRow} key={kind}>
                <button type="button" className={`${styles.field} ${styles.dateButton} ${styles.selectField}`} onClick={() => setPicker(kind)} aria-label={`${label} tarixi`}>
                  <span>{label} tarixi *</span><span>{formatWizardDate(date)}</span><span className={styles.chevron}><WizardIcon name="down" /></span>
                </button>
                <label className={`${styles.field} ${invalid ? styles.fieldInvalid : ""}`}><span>{label} saatı *</span>
                  <input type="time" step={60} aria-label={`${label} saatı`} aria-invalid={invalid} aria-describedby={invalid ? "event-time-error" : undefined}
                    value={time} onChange={(event) => updateTime(kind, date, event.target.value)} onBlur={() => setTouched((previous) => ({ ...previous, [kind]: true }))} />
                </label>
              </div>;
            })}
            {displayedError ? <p role="alert" id="event-time-error" className={styles.timeError}>{displayedError}</p> : (
              <p className={styles.hint}>{formatDuration(scheduleMinutes(schedule)) || (draft.duration ? formatDuration(Number(draft.duration)) : "Başlama və bitmə vaxtını seç.")}{scheduleMinutes(schedule) ? schedule.endEdited ? " · Vaxt seçiminə əsasən" : " · Əvvəlki addımdakı müddətə əsasən" : ""}</p>
            )}
            {touched.end && endError && suggestion && !startError ? <button type="button" className={styles.fixTime} onClick={() => { updateSchedule({ ...schedule, ...suggestion, endEdited: false }); save(false); }}>
              {suggestion.endTime}-a düzəlt · {formatDuration(Number(draft.duration))}
            </button> : null}
          </section>
          <section className={styles.scheduleFields} aria-label="Məkan">
            <h2>Məkan</h2>
            <button type="button" className={`${styles.field} ${styles.dateButton} ${styles.selectField}`} aria-label="Məkan seç" onClick={() => openView("search")}>
              <span>Məkan *</span><span>{schedule.venue?.name || "Məkan adı ilə axtar"}</span><span className={styles.chevron}><WizardIcon name="down" /></span>
            </button>
            {schedule.venue ? <div className={styles.venueDetails}>
              <p>{schedule.venue.address}</p>
              {schedule.venue.entry_note ? <p className={styles.accent}>Giriş: {schedule.venue.entry_note}</p> : null}
              {schedule.venue.plan_id ? <><p className={styles.accent}>Hazır məkan planı mövcuddur</p><small>Oturacaq seçimini növbəti addımda qura bilərsən.</small></>
                : <small>Növbəti addımda tutumu və biletləri qur.</small>}
            </div> : <p className={styles.hint}>Axtarışdan seç və ya yeni ünvan əlavə et.</p>}
          </section>
        </> : view === "search" ? (
          <VenueSearch query={query} onQuery={setQuery} onSelect={(venue) => { updateSchedule({ ...schedule, venue: { ...venue, source: "catalog", entry_note: "" } }); save(false); setView("details"); }} />
        ) : <>
          <div className={styles.introduction}><h1>Yeni məkan</h1><p>İştirakçının asan tapa biləcəyi ünvanı qeyd et.</p></div>
          <div className={styles.fields}>
            {([
              ["name", "Məkanın adı", true, 200], ["address", "Ünvan", true, 300], ["entryNote", "Giriş qeydi (istəyə bağlı)", false, 300],
            ] as const).map(([key, label, required, maxLength]) => <label key={key} className={styles.field}><span>{label}{required ? " *" : ""}</span>
              <input aria-label={label} required={required} maxLength={maxLength} value={manual[key]} onChange={(event) => updateSchedule({ ...schedule, manualVenue: { ...manual, [key]: event.target.value } })} />
            </label>)}
          </div>
          <section className={styles.scheduleFields} aria-label="Məkanın giriş nöqtəsi">
            <h2>Xəritədə yeri təsdiqlə *</h2>
            <VenuePinMap latitude={manual.latitude} longitude={manual.longitude} onSelect={(latitude, longitude) => { updateSchedule({ ...schedule, manualVenue: { ...manual, latitude, longitude } }); save(false); }} />
          </section>
        </>}
        {storageError ? <AuthMessage>Qaralama saxlanılmadı. <button type="button" className={styles.retry} onClick={() => save()}>Yenidən cəhd et</button></AuthMessage> : null}
        {notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
      </div>
      <footer className={styles.footer}>
        {view === "search" ? <>
          <button type="button" className={`${styles.next} ${styles.secondary}`} onClick={() => openView("manual")}>Ünvanı əl ilə əlavə et</button>
          <p>Tarix və saat seçimin saxlanılır</p>
        </> : view === "manual" ? <>
          <button type="submit" className={styles.next} disabled={!manualComplete}>Təsdiqlə və əlavə et</button>
          <p>Tədbirinin tarix və saatı dəyişmir</p>
        </> : <>
          <button type="submit" className={`${styles.next} ${styles.scheduleNext}`} disabled={!onNext || !isScheduleComplete(schedule, now)} aria-describedby="event-date-next">{reviewEdit ? "Dəyişiklikləri tətbiq et" : "Növbəti addım"} <WizardIcon name="next" className={styles.nextIcon} /></button>
          <p id="event-date-next">{reviewEdit ? "Yekun yoxlamaya qayıdacaqsan" : nextHint}</p>
        </>}
      </footer>
    </form>
    {picker ? <EventDatePicker kind={picker} schedule={schedule} duration={draft.duration} onClose={() => setPicker(null)} onConfirm={(date, time) => {
      updateTime(picker, date, time); setTouched((previous) => ({ ...previous, [picker]: true })); save(false); setPicker(null);
    }} /> : null}
  </WizardFrame>;
}
