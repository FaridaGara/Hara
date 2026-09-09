"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import type { EventDraft, EventTicketDraft } from "@/lib/event-draft";
import {
  allocatedTickets, commissionBreakdown, formatAzMoney, formatSalesMoment,
  normalizeMoneyInput, remainingCapacity, salesCapacity, salesError, salesSummary,
  ticketError,
} from "@/lib/event-sales";
import type { useEventDraft } from "@/hooks/use-event-draft";

import { AuthMessage } from "./auth-ui";
import { WizardFrame, WizardIcon, WizardProgress } from "./event-wizard-layout";
import styles from "./event-wizard.module.css";
import dynamic from "next/dynamic";
const SeatPlanEditor = dynamic(() => import("./seat-plan-editor").then(m => m.SeatPlanEditor));

type DraftState = ReturnType<typeof useEventDraft>;
type View = "overview" | "ticket" | "sales" | "plan";

function digits(value: string, length = 7) {
  return value.replace(/\D/g, "").slice(0, length);
}

function SalesField({ label, children, className = "" }: {
  label: string; children: ReactNode; className?: string;
}) {
  return <label className={`${styles.field} ${className}`}><span>{label}</span>{children}</label>;
}

function TicketCard({ ticket, seated, onEdit }: {
  ticket: EventTicketDraft; seated: boolean; onEdit: () => void;
}) {
  const quantity = ticket.quantity ? Number(ticket.quantity) : 0;
  const price = ticket.paymentType === "free" ? "Pulsuz" : ticket.price ? `${ticket.price} AZN` : "Qiymət yoxdur";
  return <button type="button" className={styles.ticketCard} onClick={onEdit} aria-label={`${ticket.name || "Adsız bilet"} biletini redaktə et`}>
    <span className={styles.ticketIcon}><WizardIcon name="ticket" /></span>
    <span className={styles.ticketMain}>
      <strong>{ticket.name || "Adsız bilet"}</strong>
      <small>{quantity ? `${quantity} ${seated ? "nömrəli yer" : ticket.paymentType === "free" ? "pulsuz qeydiyyat" : "bilet · Sərbəst giriş"}` : "Bilet sayını daxil et"}</small>
    </span>
    <span className={styles.ticketMeta}><strong>{price}</strong><small>{seated ? "Qiyməti dəyiş" : "Düzəliş et"}</small></span>
  </button>;
}

function TicketEditor({ draft, updateDraft, ticketId, onDone, onDelete }: {
  draft: EventDraft; updateDraft: (draft: EventDraft) => void; ticketId: string;
  onDone: () => void; onDelete: () => void;
}) {
  const ticket = draft.sales.tickets.find((item) => item.id === ticketId)!;
  const error = ticketError(ticket, draft);
  const remaining = remainingCapacity(draft, ticket.id);
  const isNew = draft.sales.tickets.at(-1)?.id === ticket.id && !ticket.quantity;
  const commission = commissionBreakdown(ticket.price);

  function updateTicket(patch: Partial<EventTicketDraft>) {
    const nextTicket = { ...ticket, ...patch };
    updateDraft({ ...draft, sales: { ...draft.sales, tickets: draft.sales.tickets.map((item) => item.id === ticket.id ? nextTicket : item) } });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (error) return;
    updateTicket({ lastValidQuantity: ticket.quantity });
    onDone();
  }

  return <form className={styles.form} onSubmit={submit}>
    <div className={styles.content}>
      <WizardProgress step={3} />
      <div className={styles.introduction}>
        <h1>{ticket.paymentType === "free" ? "Pulsuz bilet" : isNew ? "Bilet məlumatları" : "Bileti redaktə et"}</h1>
        <p>{ticket.paymentType === "free" ? "İştirakçı sayını nəzarətdə saxla." : isNew ? "Fərqli qiymət və üstünlük əlavə et." : "Qiyməti və satışa açılan sayı müəyyən et."}</p>
      </div>
      <div className={styles.segmented} aria-label="Bilet ödəniş növü">
        {(["paid", "free"] as const).map((type) => <button key={type} type="button" aria-pressed={ticket.paymentType === type}
          onClick={() => updateTicket({ paymentType: type })}>{type === "paid" ? "Ödənişli" : "Pulsuz"}</button>)}
      </div>
      <div className={styles.fields}>
        <SalesField label="Biletin adı *"><input aria-label="Biletin adı" maxLength={80} value={ticket.name} onChange={(event) => updateTicket({ name: event.target.value })} /></SalesField>
        <div className={styles.row}>
          {ticket.paymentType === "paid" ? <SalesField label="Qiymət · AZN *"><input aria-label="Qiymət" inputMode="decimal" value={ticket.price} onChange={(event) => updateTicket({ price: normalizeMoneyInput(event.target.value) })} /></SalesField> : null}
          <SalesField label="Bilet sayı *" className={error?.includes("yer yoxdur") || error?.includes("müsbət") ? styles.fieldInvalid : ""}>
            <input aria-label="Bilet sayı" inputMode="numeric" value={ticket.quantity} onChange={(event) => updateTicket({ quantity: digits(event.target.value) })} aria-invalid={Boolean(error)} />
          </SalesField>
        </div>
        {error ? <div className={styles.capacityError} role="alert"><p>{error}</p>
          {ticket.lastValidQuantity && error.includes("yer yoxdur") ? <button type="button" onClick={() => updateTicket({ quantity: ticket.lastValidQuantity })}>Əvvəlki {ticket.lastValidQuantity} biletə qaytar</button> : null}
        </div> : <p className={styles.hint}>{remaining === null ? "Ümumi tutumu əvvəlcə daxil et." : `Məkan limiti: ${salesCapacity(draft)} · Əlavə oluna bilər: ${remaining} bilet`}</p>}
        {ticket.paymentType === "paid" && commission ? <div className={styles.commission}>
          <strong>1 bilet üzrə hesablama</strong>
          <p>HARA (8%): {formatAzMoney(commission.commission)} AZN · Qalan: {formatAzMoney(commission.remainder)} AZN</p>
          <small>Ödəniş provayderinin haqqı daxil deyil.</small>
        </div> : null}
        <SalesField label="Biletə daxildir (istəyə bağlı)"><input aria-label="Biletə daxildir" maxLength={200} value={ticket.includes} onChange={(event) => updateTicket({ includes: event.target.value })} /></SalesField>
        {draft.sales.tickets.length > 1 ? <button type="button" className={styles.dangerAction} onClick={onDelete}>Bilet növünü sil</button> : null}
      </div>
    </div>
    <footer className={styles.footer}>
      <button type="submit" className={styles.next} disabled={Boolean(error)}>Bileti saxla</button>
      <p>{error ? `${allocatedTickets(draft.sales)} / ${salesCapacity(draft) ?? "—"} yer · Bilet məlumatını düzəlt` : `${ticket.quantity || 0} ${ticket.paymentType === "free" ? "pulsuz qeydiyyat" : `bilet · ${ticket.price || 0} AZN`}`}</p>
    </footer>
  </form>;
}

function SalesSettings({ draft, updateDraft, onDone }: {
  draft: EventDraft; updateDraft: (draft: EventDraft) => void; onDone: () => void;
}) {
  const sales = draft.sales;
  const hasPaid = sales.tickets.some((ticket) => ticket.paymentType === "paid");
  const limitsInvalid = Number(sales.minPerOrder) <= 0 || Number(sales.maxPerOrder) < Number(sales.minPerOrder);
  function update(patch: Partial<typeof sales>) { updateDraft({ ...draft, sales: { ...sales, ...patch } }); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (limitsInvalid || (hasPaid && !sales.refundPolicy)) return;
    onDone();
  }
  return <form className={styles.form} onSubmit={submit}>
    <div className={styles.content}>
      <WizardProgress step={3} />
      <div className={styles.introduction}><h1>Satış qaydaları</h1><p>Vaxtlar tədbir tarixinə əsasən təklif olunur.</p></div>
      <div className={styles.fields}>
        <SalesField label="Satışın başlaması *" className={styles.selectField}>
          <select aria-label="Satışın başlaması" value={sales.salesStart} onChange={(event) => update({ salesStart: event.target.value as typeof sales.salesStart })}>
            <option value="published">Yayımlanan kimi</option><option value="custom">Xüsusi vaxtda</option>
          </select><span className={styles.chevron}><WizardIcon name="down" /></span>
        </SalesField>
        {sales.salesStart === "custom" ? <div className={styles.row}>
          <SalesField label="Başlama tarixi *"><input aria-label="Satışın başlama tarixi" type="date" value={sales.salesStartDate} onChange={(event) => update({ salesStartDate: event.target.value })} /></SalesField>
          <SalesField label="Saat *"><input aria-label="Satışın başlama saatı" type="time" value={sales.salesStartTime} onChange={(event) => update({ salesStartTime: event.target.value })} /></SalesField>
        </div> : null}
        <SalesField label="Satışın bitməsi *" className={styles.selectField}>
          <select aria-label="Satışın bitməsi" value={sales.salesEnd} onChange={(event) => update({ salesEnd: event.target.value as typeof sales.salesEnd })}>
            <option value="event_start">Tədbir başlayanadək</option><option value="custom">Xüsusi vaxtda</option>
          </select><span className={styles.chevron}><WizardIcon name="down" /></span>
        </SalesField>
        {sales.salesEnd === "custom" ? <div className={styles.row}>
          <SalesField label="Bitmə tarixi *"><input aria-label="Satışın bitmə tarixi" type="date" value={sales.salesEndDate} onChange={(event) => update({ salesEndDate: event.target.value })} /></SalesField>
          <SalesField label="Saat *"><input aria-label="Satışın bitmə saatı" type="time" value={sales.salesEndTime} onChange={(event) => update({ salesEndTime: event.target.value })} /></SalesField>
        </div> : null}
        <p className={styles.hint}>Tədbir: {formatSalesMoment(draft.schedule.startDate, draft.schedule.startTime)}–{draft.schedule.endTime} · Bakı vaxtı</p>
        <h2 className={styles.sectionTitle}>Bir sifarişdə bilet sayı</h2>
        <div className={styles.row}>
          <SalesField label="Minimum *"><input aria-label="Minimum bilet sayı" inputMode="numeric" value={sales.minPerOrder} onChange={(event) => update({ minPerOrder: digits(event.target.value, 2) })} /></SalesField>
          <SalesField label="Maksimum *" className={limitsInvalid ? styles.fieldInvalid : ""}><input aria-label="Maksimum bilet sayı" inputMode="numeric" value={sales.maxPerOrder} onChange={(event) => update({ maxPerOrder: digits(event.target.value, 2) })} /></SalesField>
        </div>
        <SalesField label="Geri qaytarılma qaydası" className={styles.selectField}>
          <select aria-label="Geri qaytarılma qaydası" value={sales.refundPolicy} onChange={(event) => update({ refundPolicy: event.target.value as typeof sales.refundPolicy })}>
            <option value="">Qaydanı seç</option><option value="non_refundable">Geri qaytarılmır</option><option value="until_24h">24 saat qalanadək</option><option value="until_72h">72 saat qalanadək</option>
          </select><span className={styles.chevron}><WizardIcon name="down" /></span>
        </SalesField>
        {hasPaid && !sales.refundPolicy ? <p className={styles.timeError}>Ödənişli tədbiri yayımlamazdan əvvəl tələb olunur.</p> : null}
      </div>
    </div>
    <footer className={styles.footer}><button type="submit" className={styles.next} disabled={limitsInvalid || (hasPaid && !sales.refundPolicy)}>Qaydaları saxla</button><p>Bilet məlumatların saxlanılır</p></footer>
  </form>;
}

export function EventSalesTicketStep({ draft, replaceDraft, save, notice, storageError, onBack, onNext, reviewEdit = false }: DraftState & {
  onBack: () => void; onNext?: (draft: EventDraft) => void; reviewEdit?: boolean;
}) {
  const [view, setView] = useState<View>("overview");
  const [ticketId, setTicketId] = useState(draft.sales.tickets[0]?.id || "ticket-1");
  const capacity = salesCapacity(draft);
  const allocated = allocatedTickets(draft.sales);
  const error = salesError(draft);
  const manualCapacityInvalid = draft.schedule.venue?.capacity == null && Boolean(draft.sales.capacity) && Number(draft.sales.capacity) < allocated;
  const currentTicket = draft.sales.tickets.find((ticket) => ticket.id === ticketId);

  function updateDraft(next: EventDraft) { replaceDraft(next); }
  function updateSales(patch: Partial<typeof draft.sales>) { updateDraft({ ...draft, sales: { ...draft.sales, ...patch } }); }
  function open(next: View) { save(false); setView(next); }
  function addTicket() {
    const id = `ticket-${Date.now()}`;
    updateSales({ tickets: [...draft.sales.tickets, { id, name: "", paymentType: "paid", price: "", quantity: "", includes: "", lastValidQuantity: "" }] });
    setTicketId(id); open("ticket");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (error || !onNext) return;
    save(false); onNext(draft);
  }
  const venueHint = draft.schedule.venue?.plan_id
    ? `${capacity ?? "—"} yerlik məkan · Hazır plan mövcuddur`
    : `${draft.schedule.venue?.name || "Yeni məkan"} · Hazır plan yoxdur`;

  if (view === "plan") return <SeatPlanEditor draft={draft} updateDraft={updateDraft} save={save} onDone={() => open("overview")} />;

  return <WizardFrame subtitle={draft.title} onSave={() => save()} onBack={() => {
    save(false);
    if (view !== "overview") setView("overview"); else onBack();
  }}>
    {view === "ticket" && currentTicket ? <TicketEditor draft={draft} updateDraft={updateDraft} ticketId={ticketId} onDone={() => open("overview")} onDelete={() => {
      updateSales({ tickets: draft.sales.tickets.filter((ticket) => ticket.id !== ticketId) }); open("overview");
    }} /> : view === "sales" ? <SalesSettings draft={draft} updateDraft={updateDraft} onDone={() => open("overview")} /> :
    <form className={styles.form} onSubmit={submit} onBlurCapture={() => save(false)}>
      <div className={styles.content}>
        <WizardProgress step={3} />
        <div className={styles.introduction}><h1>Satış və biletlər</h1><p>Biletləri və iştirakçı sayını təyin et.</p></div>
        <section className={styles.salesSection} aria-labelledby="admission-heading">
          <h2 id="admission-heading">Giriş qaydası</h2>
          <div className={styles.segmented}>
            {(["general", "seated"] as const).map((type) => <button key={type} type="button" aria-pressed={draft.sales.admissionType === type} onClick={() => {
              updateSales({ admissionType: type, seatPlanApplied: type === "seated" ? draft.sales.seatPlanApplied : false });
              if (type === "seated") open("plan");
            }}>{type === "general" ? "Sərbəst" : "Oturacaqlı"}</button>)}
          </div>
          <p className={styles.hint}>{draft.sales.admissionType === "seated" && draft.sales.seatPlanApplied ? `${capacity} oturacaq · Plan tətbiq edilib` : venueHint}</p>
          {draft.schedule.venue?.capacity == null ? <SalesField label="Ümumi tutum *" className={manualCapacityInvalid ? styles.fieldInvalid : ""}>
            <input aria-label="Ümumi tutum" inputMode="numeric" value={draft.sales.capacity} onChange={(event) => updateSales({ capacity: digits(event.target.value) })} aria-invalid={manualCapacityInvalid} />
          </SalesField> : null}
          {manualCapacityInvalid ? <p className={styles.timeError} role="alert">Tutum artıq ayrılmış {allocated} biletdən az ola bilməz.</p> : null}
        </section>
        <section className={styles.salesSection} aria-labelledby="ticket-types-heading">
          <div className={styles.sectionHeading}><h2 id="ticket-types-heading">Bilet növləri</h2><span>{allocated} / {capacity ?? "—"} yer</span></div>
          <div className={styles.ticketList}>{draft.sales.tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} seated={draft.sales.admissionType === "seated"} onEdit={() => { if (draft.sales.admissionType === "seated") open("plan"); else { setTicketId(ticket.id); open("ticket"); } }} />)}</div>
          <button type="button" className={styles.addTicket} onClick={addTicket} disabled={draft.sales.admissionType === "seated" || draft.sales.tickets.length >= 20 || (capacity !== null && allocated >= capacity)}>Bilet növü əlavə et</button>
          {draft.sales.admissionType === "seated" ? <button type="button" className={styles.addTicket} onClick={() => open("plan")}>Planı və qiymətləri dəyiş</button> : null}
        </section>
        <button type="button" className={styles.salesSettings} onClick={() => open("sales")} aria-label="Satış vaxtı və qaydalar">
          <span className={styles.ticketIcon}><WizardIcon name="ticket" /></span><span><strong>Satış vaxtı və qaydalar</strong><small>{salesSummary(draft)}</small></span><WizardIcon name="forward" />
        </button>
        <p className={styles.assurance}>Hər bilet üçün unikal giriş QR-ı yaradılacaq.</p>
        {error ? <AuthMessage>{error}</AuthMessage> : null}
        {storageError ? <AuthMessage>Qaralama saxlanılmadı. <button type="button" className={styles.retry} onClick={() => save()}>Yenidən cəhd et</button></AuthMessage> : null}
        {notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
      </div>
      <footer className={styles.footer}><button type="submit" className={`${styles.next} ${styles.scheduleNext}`} disabled={!onNext || Boolean(error)}>{reviewEdit ? "Dəyişiklikləri tətbiq et" : "Növbəti addım"} <WizardIcon name="next" className={styles.nextIcon} /></button><p>{error ? "Davam etmək üçün məlumatları tamamla" : reviewEdit ? "Yekun yoxlamaya qayıdacaqsan" : "Növbəti: Media"}</p></footer>
    </form>}
  </WizardFrame>;
}
