"use client";

import { useEffect, useRef, useState } from "react";
import { bakuToday, formatDuration, formatWizardDate, suggestedEnd, type EventSchedule } from "@/lib/event-schedule";
import { WizardIcon } from "./event-wizard-layout";
import styles from "./event-wizard.module.css";

const WEEKDAYS = ["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"];

export function EventDatePicker({ kind, schedule, duration, onConfirm, onClose }: {
  kind: "start" | "end"; schedule: EventSchedule; duration: string;
  onConfirm: (date: string, time: string) => void; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [today] = useState(() => bakuToday());
  const [date, setDate] = useState(kind === "start" ? schedule.startDate : schedule.endDate || schedule.startDate);
  const [time, setTime] = useState(kind === "start" ? schedule.startTime : schedule.endTime);
  const [month, setMonth] = useState(() => (date || today).slice(0, 7));
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cellCount = Math.ceil((startOffset + days) / 7) * 7;
  const suggested = kind === "start" ? suggestedEnd({ ...schedule, startDate: date, startTime: time }, duration) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const oldOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = oldOverflow; };
  }, []);

  function moveMonth(offset: number) {
    setMonth(new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7));
  }

  return (
    <dialog ref={dialogRef} className={styles.dateDialog} aria-labelledby="date-picker-title" onCancel={onClose}>
      <div className={styles.pickerHeader}>
        <h2 id="date-picker-title">{kind === "start" ? "Başlama vaxtı" : "Bitmə vaxtı"}</h2>
        <button type="button" aria-label="Tarix seçimini bağla" className={styles.iconButton} onClick={onClose}><WizardIcon name="close" /></button>
      </div>
      <div className={styles.monthHeader}>
        <h3 aria-live="polite">{new Intl.DateTimeFormat("az-AZ", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</h3>
        <button type="button" aria-label="Əvvəlki ay" className={styles.iconButton} disabled={month <= today.slice(0, 7)} onClick={() => moveMonth(-1)}><WizardIcon name="back" /></button>
        <button type="button" aria-label="Növbəti ay" className={styles.iconButton} onClick={() => moveMonth(1)}><WizardIcon name="forward" /></button>
      </div>
      <div className={styles.calendar} aria-label="Təqvim">
        {WEEKDAYS.map((day, index) => <span key={index} className={styles.weekday}>{day}</span>)}
        {Array.from({ length: cellCount }, (_, index) => {
          const day = new Date(Date.UTC(year, monthNumber - 1, 1 - startOffset + index));
          const value = day.toISOString().slice(0, 10);
          return <button type="button" key={value} aria-label={formatWizardDate(value)} aria-pressed={date === value}
            data-outside={day.getUTCMonth() !== monthNumber - 1} disabled={value < today}
            onClick={() => setDate(value)}>{day.getUTCDate()}</button>;
        })}
      </div>
      <label className={styles.field}>
        <span>Saat · Bakı (UTC+4)</span>
        <input aria-label="Saat · Bakı (UTC+4)" type="time" step={60} required value={time} onChange={(event) => setTime(event.target.value)} />
      </label>
      {kind === "start" && suggested && !schedule.endEdited ? (
        <p className={styles.hint}>Bitmə vaxtı: {suggested.endDate !== date ? `${formatWizardDate(suggested.endDate)} · ` : ""}{suggested.endTime} · Müddət: {formatDuration(Number(duration))}</p>
      ) : <p className={styles.hint}>{kind === "end" && schedule.startDate && schedule.startTime ? `Başlama: ${formatWizardDate(schedule.startDate)}, ${schedule.startTime} · Bakı vaxtı` : "Tarix və saatı Bakı vaxtı ilə seç."}</p>}
      <button type="button" className={styles.next} disabled={!date || date < today || !time} onClick={() => onConfirm(date, time)}>Təsdiqlə</button>
    </dialog>
  );
}
