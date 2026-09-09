"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./event-wizard.module.css";

export function WizardIcon({ name, className = "hara-auth-icon" }: { name: string; className?: string }) {
  return <Image src={`/figma/create-event/${name}.svg`} alt="" width={24} height={24} className={className} />;
}

export function WizardFrame({ title = "Tədbir yarat", subtitle, onBack, onSave, children }: {
  title?: string; subtitle: string; onBack?: () => void; onSave: () => void; children: ReactNode;
}) {
  return (
    <main className={`hara-auth ${styles.page}`}>
      <section className={styles.shell} aria-label="Tədbir yarat">
        <header className={styles.header}>
          {onBack ? (
            <button type="button" aria-label="Əvvəlki mərhələyə qayıt" className={styles.iconButton} onClick={onBack}><WizardIcon name="back" /></button>
          ) : (
            <Link href="/" aria-label="Tədbir formasını bağla" className={styles.iconButton}><WizardIcon name="close" /></Link>
          )}
          <div className={styles.heading}><p>{title}</p><span>{subtitle}</span></div>
          <button type="button" aria-label="Qaralamanı bu brauzerdə saxla" className={styles.iconButton} onClick={onSave}><WizardIcon name="save" /></button>
        </header>
        {children}
      </section>
    </main>
  );
}

export function WizardProgress({ step }: { step: 1 | 2 | 3 | 4 | 5 }) {
  return <div className={styles.progress}>
    <p>Addım {step} / 5</p>
    <div role="progressbar" aria-label="Tədbir yaratma mərhələsi" aria-valuemin={0} aria-valuemax={5} aria-valuenow={step}>
      <span style={{ width: `${step * 20}%` }} />
    </div>
  </div>;
}
