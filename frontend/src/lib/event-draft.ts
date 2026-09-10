import { readSeatPlan, type SeatPlanDraft } from "./seat-plan";
import { emptySchedule, readSchedule, type EventSchedule } from "./event-schedule";

// Drafts remain account-scoped on this device; submission is explicit.
export const EVENT_CATEGORIES = [
  ["musiqi", "Musiqi"], ["teatr", "Teatr"], ["workshop", "Workshop"], ["idman", "İdman"],
] as const;
export const EVENT_AGES = ["0+", "6+", "12+", "16+", "18+"] as const;
export const EVENT_LANGUAGES = [
  ["az", "Azərbaycanca"], ["en", "İngiliscə"], ["ru", "Rusca"], ["tr", "Türkcə"],
] as const;

export type TicketPaymentType = "paid" | "free";
export type AdmissionType = "general" | "seated";

export type EventTicketDraft = {
  id: string;
  name: string;
  paymentType: TicketPaymentType;
  price: string;
  quantity: string;
  includes: string;
  lastValidQuantity: string;
};

export type EventSalesDraft = {
  admissionType: AdmissionType;
  capacity: string;
  tickets: EventTicketDraft[];
  salesStart: "published" | "custom";
  salesStartDate: string;
  salesStartTime: string;
  salesEnd: "event_start" | "custom";
  salesEndDate: string;
  salesEndTime: string;
  minPerOrder: string;
  maxPerOrder: string;
  refundPolicy: "" | "non_refundable" | "until_24h" | "until_72h";
  seatPlanApplied: boolean;
  seatPlanSource: "venue" | "custom" | null;
  customPlanName: string;
  seatPlan: SeatPlanDraft | null;
};

export function emptySales(): EventSalesDraft {
  return {
    admissionType: "general", capacity: "",
    tickets: [{ id: "ticket-1", name: "Standart", paymentType: "paid", price: "", quantity: "", includes: "Tədbirə giriş", lastValidQuantity: "" }],
    salesStart: "published", salesStartDate: "", salesStartTime: "",
    salesEnd: "event_start", salesEndDate: "", salesEndTime: "",
    minPerOrder: "1", maxPerOrder: "6", refundPolicy: "",
    seatPlanApplied: false, seatPlanSource: null, customPlanName: "", seatPlan: null,
  };
}

export type WizardStep = 1 | 2 | 3 | 4 | 5;
export type EventMediaDraft = { cover: string; gallery: string[] };

export type EventDraft = {
  title: string;
  category: string;
  categoryLabel?: string;
  description: string;
  age: string;
  language: string;
  duration: string;
  schedule: EventSchedule;
  sales: EventSalesDraft;
  lastStep: WizardStep;
  media?: EventMediaDraft;
  submissionId?: string;
};

export const EMPTY_EVENT_DRAFT: EventDraft = {
  title: "", category: "", description: "", age: "", language: "", duration: "",
  schedule: emptySchedule(), sales: emptySales(), lastStep: 1,
};

function draftKey(userId: number) {
  return `hara.event-draft.v4:${userId}`;
}

function readSales(value: unknown): EventSalesDraft {
  const empty = emptySales();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const data = value as Record<string, unknown>;
  const text = (key: string, max: number) => typeof data[key] === "string" ? data[key].slice(0, max) : "";
  const positiveInteger = (value: unknown, maxDigits = 7) => typeof value === "string" && new RegExp(`^\\d{0,${maxDigits}}$`).test(value) ? value : "";
  const tickets = Array.isArray(data.tickets) ? data.tickets.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const ticket = value as Record<string, unknown>;
    const ticketText = (key: string, max: number) => typeof ticket[key] === "string" ? ticket[key].slice(0, max) : "";
    const paymentType: TicketPaymentType = ticket.paymentType === "free" ? "free" : "paid";
    const price = paymentType === "free" ? "" : (typeof ticket.price === "string" && /^\d{0,7}(?:\.\d{0,2})?$/.test(ticket.price) ? ticket.price : "");
    const quantity = positiveInteger(ticket.quantity);
    return [{
      id: ticketText("id", 64) || `ticket-${index + 1}`,
      name: ticketText("name", 80), paymentType, price, quantity,
      includes: ticketText("includes", 200),
      lastValidQuantity: positiveInteger(ticket.lastValidQuantity) || quantity,
    }];
  }).slice(0, 20) : [];
  const refundPolicies = ["non_refundable", "until_24h", "until_72h"];
  return {
    admissionType: data.admissionType === "seated" ? "seated" : "general",
    capacity: positiveInteger(data.capacity), tickets: tickets.length ? tickets : empty.tickets,
    salesStart: data.salesStart === "custom" ? "custom" : "published",
    salesStartDate: text("salesStartDate", 10), salesStartTime: text("salesStartTime", 5),
    salesEnd: data.salesEnd === "custom" ? "custom" : "event_start",
    salesEndDate: text("salesEndDate", 10), salesEndTime: text("salesEndTime", 5),
    minPerOrder: positiveInteger(data.minPerOrder, 2) || "1",
    maxPerOrder: positiveInteger(data.maxPerOrder, 2) || "6",
    refundPolicy: refundPolicies.includes(String(data.refundPolicy)) ? data.refundPolicy as EventSalesDraft["refundPolicy"] : "",
    seatPlanApplied: data.seatPlanApplied === true,
    seatPlanSource: data.seatPlanSource === "venue" || data.seatPlanSource === "custom" ? data.seatPlanSource : null,
    customPlanName: text("customPlanName", 160),
    seatPlan: readSeatPlan(data.seatPlan),
  };
}

export function readEventDraft(userId: number): EventDraft {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(draftKey(userId)) || window.localStorage.getItem(`hara.event-draft.v3:${userId}`) || window.localStorage.getItem(`hara.event-draft.v2:${userId}`) || window.localStorage.getItem(`hara.event-draft.v1:${userId}`) || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_EVENT_DRAFT };
    const draft = value as Record<string, unknown>;
    const text = (key: string, max: number) => typeof draft[key] === "string" ? draft[key].slice(0, max) : "";
    return {
      title: text("title", 255),
      category: typeof draft.category === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(draft.category) ? draft.category : "",
      categoryLabel: text("categoryLabel", 100),
      description: text("description", 1000),
      age: EVENT_AGES.some((age) => age === draft.age) ? String(draft.age) : "",
      language: EVENT_LANGUAGES.some(([id]) => id === draft.language) ? String(draft.language) : "",
      duration: typeof draft.duration === "string" && /^\d{0,5}$/.test(draft.duration) ? draft.duration : "",
      schedule: readSchedule(draft.schedule), sales: readSales(draft.sales),
      lastStep: [1, 2, 3, 4, 5].includes(Number(draft.lastStep)) ? Number(draft.lastStep) as WizardStep : 1,
      media: readMedia(draft.media),
      submissionId: typeof draft.submissionId === "string" && /^[0-9a-f-]{36}$/i.test(draft.submissionId) ? draft.submissionId : undefined,
    };
  } catch {
    return { ...EMPTY_EVENT_DRAFT };
  }
}

export function saveEventDraft(userId: number, draft: EventDraft): boolean {
  try {
    window.localStorage.setItem(draftKey(userId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function isEventDraftComplete(draft: EventDraft) {
  return Boolean(
    draft.title.trim() && draft.title.length <= 255 &&
    /^[a-zA-Z0-9_-]{1,120}$/.test(draft.category) &&
    draft.description.trim() && draft.description.length <= 1000 &&
    (!draft.duration || (/^\d{1,5}$/.test(draft.duration) && Number(draft.duration) > 0)),
  );
}

export function readMedia(value: unknown): EventMediaDraft {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const image = (v: unknown): v is string => typeof v === "string" && v.length <= 250_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v);
  return { cover: image(data.cover) ? data.cover : "", gallery: Array.isArray(data.gallery) ? data.gallery.filter(image).slice(0, 4) : [] };
}
