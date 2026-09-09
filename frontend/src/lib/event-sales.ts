import type { EventDraft, EventSalesDraft, EventTicketDraft } from "./event-draft";
import { wallTime } from "./event-schedule";

export const HARA_COMMISSION_RATE = 0.08;

export function salesCapacity(draft: EventDraft) {
  const value = draft.schedule.venue?.capacity ?? Number(draft.sales.capacity);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function ticketQuantity(ticket: EventTicketDraft) {
  return /^\d+$/.test(ticket.quantity) ? Number(ticket.quantity) : 0;
}

export function allocatedTickets(sales: EventSalesDraft, exceptId?: string) {
  return sales.tickets.reduce((sum, ticket) => ticket.id === exceptId ? sum : sum + ticketQuantity(ticket), 0);
}

export function remainingCapacity(draft: EventDraft, exceptId?: string) {
  const capacity = salesCapacity(draft);
  return capacity === null ? null : Math.max(0, capacity - allocatedTickets(draft.sales, exceptId));
}

export function normalizeMoneyInput(value: string) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [whole = "", ...decimalParts] = normalized.split(".");
  const decimal = decimalParts.join("").slice(0, 2);
  return `${whole.slice(0, 7)}${decimalParts.length ? `.${decimal}` : ""}`;
}

export function commissionBreakdown(value: string) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return null;
  const commission = Math.round(price * HARA_COMMISSION_RATE * 100) / 100;
  return { commission, remainder: Math.round((price - commission) * 100) / 100 };
}

export function formatAzMoney(value: number) {
  return new Intl.NumberFormat("az-AZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

export function ticketError(ticket: EventTicketDraft, draft: EventDraft) {
  if (!ticket.name.trim()) return "Biletin adını daxil et.";
  if (!/^\d+$/.test(ticket.quantity) || Number(ticket.quantity) <= 0) return "Bilet sayı müsbət tam ədəd olmalıdır.";
  const available = remainingCapacity(draft, ticket.id);
  if (available !== null && Number(ticket.quantity) > available) {
    return `${ticket.quantity} bilet üçün yer yoxdur. Maksimum: ${available} bilet.`;
  }
  if (ticket.paymentType === "paid" && (!/^\d+(?:\.\d{1,2})?$/.test(ticket.price) || Number(ticket.price) <= 0)) {
    return "Qiyməti AZN ilə daxil et.";
  }
  return null;
}

export function salesError(draft: EventDraft) {
  const capacity = salesCapacity(draft);
  if (capacity === null) return "Ümumi tutumu daxil et.";
  if (!draft.sales.tickets.length) return "Ən azı bir bilet növü əlavə et.";
  const invalidTicket = draft.sales.tickets.find((ticket) => ticketError(ticket, draft));
  if (invalidTicket) return ticketError(invalidTicket, draft);
  if (draft.sales.admissionType === "seated" && !draft.sales.seatPlanApplied) return "Oturacaq planını tətbiq et.";
  const minimum = Number(draft.sales.minPerOrder);
  const maximum = Number(draft.sales.maxPerOrder);
  if (!Number.isInteger(minimum) || minimum <= 0 || !Number.isInteger(maximum) || maximum < minimum) {
    return "Sifariş limitlərini düzgün daxil et.";
  }
  if (draft.sales.tickets.some((ticket) => ticket.paymentType === "paid") && !draft.sales.refundPolicy) {
    return "Ödənişli tədbir üçün geri qaytarılma qaydasını seç.";
  }
  if (draft.sales.salesStart === "custom" && wallTime(draft.sales.salesStartDate, draft.sales.salesStartTime) === null) {
    return "Satışın başlama vaxtını seç.";
  }
  if (draft.sales.salesEnd === "custom") {
    const end = wallTime(draft.sales.salesEndDate, draft.sales.salesEndTime);
    const eventStart = wallTime(draft.schedule.startDate, draft.schedule.startTime);
    if (end === null || (eventStart !== null && end > eventStart)) return "Satışın bitmə vaxtı tədbirdən gec ola bilməz.";
  }
  return null;
}

export function formatSalesMoment(date: string, time: string) {
  if (wallTime(date, time) === null) return "vaxt seçilməyib";
  const day = new Intl.DateTimeFormat("az-AZ", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
  return `${day}, ${time}`;
}

export function salesSummary(draft: EventDraft) {
  const start = draft.sales.salesStart === "published" ? "Yayımlananda" : formatSalesMoment(draft.sales.salesStartDate, draft.sales.salesStartTime);
  const end = draft.sales.salesEnd === "event_start"
    ? formatSalesMoment(draft.schedule.startDate, draft.schedule.startTime)
    : formatSalesMoment(draft.sales.salesEndDate, draft.sales.salesEndTime);
  return `${start} → ${end}`;
}
