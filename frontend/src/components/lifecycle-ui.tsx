"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { EventSubmission } from "@/lib/api/event-submissions";
import { safeEventImageUrl, formatBakuDate } from "@/lib/format";
import { submissionStatuses } from "@/lib/submission-status";
import css from "./lifecycle-ui.module.css";

export function LifecyclePage({ title, backHref, children, footer, wide = false }: {
  title: string; backHref: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return <main className={`hara-auth ${css.page} ${wide ? css.wide : ""}`}>
    <header className={css.header}>
      <Link href={backHref} className={css.back} aria-label="Geri qayıt"><Image src="/figma/auth/back.svg" alt="" width={24} height={24} className="hara-auth-icon" /></Link>
      <p>{title}</p>
    </header>
    <div className={css.content}>{children}</div>
    {footer ? <footer className={css.footer}>{footer}</footer> : null}
  </main>;
}

export function LifecycleIntro({ title, children }: { title: string; children?: ReactNode }) {
  return <div className={css.intro}><h1>{title}</h1>{children ? <p>{children}</p> : null}</div>;
}

export function Notice({ title, children, accent = false, role }: {
  title: string; children: ReactNode; accent?: boolean; role?: "alert" | "status";
}) {
  return <section className={`${css.notice} ${accent ? css.accentNotice : ""}`} role={role}>
    <div className={css.noticeHeading}><span className={css.bell} aria-hidden="true" /><h2>{title}</h2></div>
    {children}
  </section>;
}

export function LifecycleState({ title, children, action, error = false }: {
  title: string; children: ReactNode; action?: ReactNode; error?: boolean;
}) {
  return <section className={css.state} role={error ? "alert" : undefined}>
    <div className={css.stateIcon}><span className={css.bell} aria-hidden="true" /></div>
    <h1>{title}</h1><p>{children}</p>{action}
  </section>;
}

export function LifecycleLoading({ label }: { label: string }) {
  return <div role="status" className={css.loading}><span>{label}</span>
    {[0, 1].map(key => <div className={css.skeletonCard} key={key} aria-hidden="true"><div /><div /><div /></div>)}
  </div>;
}

export function SubmissionCard({ item, children, action }: { item: EventSubmission; children?: ReactNode; action?: ReactNode }) {
  // Submitted draft images are private data returned by the authenticated API.
  const raw = item.cover_thumbnail || item.snapshot?.media?.cover || "";
  const cover = safeEventImageUrl(raw);
  const start = item.start_at || (item.snapshot?.schedule.startDate && item.snapshot.schedule.startTime ? `${item.snapshot.schedule.startDate}T${item.snapshot.schedule.startTime}:00+04:00` : "");
  const venue = item.venue_name || item.snapshot?.schedule.venue?.name;
  return <article className={css.eventCard} aria-label={item.title}>
    <span className={css.status} data-status={item.status}>{submissionStatuses[item.status].label}</span>
    <div className={css.eventHeading}>
      {cover ? <Image unoptimized className={css.thumbnail} src={cover} alt="" width={72} height={88} /> : null}
      <div><h2>{item.title}</h2>{start ? <p>{formatBakuDate(start, true)}</p> : null}{venue ? <p>{venue}</p> : null}</div>
    </div>
    {children}{action}
  </article>;
}

/** Native modal supplies focus containment, Escape dismissal and an inert background. */
export function LifecycleDialog({ title, children, onClose, footer, full = false }: {
  title: string; children: ReactNode; onClose: () => void; footer: ReactNode; full?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);
  return <dialog ref={ref} className={`hara-auth ${css.dialog} ${full ? css.fullDialog : ""}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={css.dialogContent}><h2 id={titleId} tabIndex={-1} autoFocus>{title}</h2>{children}</div>
    <div className={css.dialogFooter}>{footer}</div>
  </dialog>;
}
