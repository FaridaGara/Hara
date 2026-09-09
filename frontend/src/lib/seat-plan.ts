import type { EventVenueDraft } from "./event-schedule";

export type PlanSeat = { id: string; row: string; number: number; x: number; y: number; blocked: boolean; reason: string; categoryId: string | null };
export type PlanBlock = { id: string; name: string; rows: number; columns: number; firstRow: string; firstSeat: number; aisle: number; direction: "ltr" | "rtl"; x: number; y: number; scale: number; rotation: number; seats: PlanSeat[] };
export type PlanCategory = { id: string; name: string; price: string; free: boolean };
export type SeatPlanDraft = { version: 1; id: string; venueKey: string; name: string; sourceId: string; sourceName: string; page: number; pageCount: number; background: string; blocks: PlanBlock[]; categories: PlanCategory[] };
export const MAX_SEATS = 5000;
export const uid = () => crypto.randomUUID();
export const venuePlanKey = (venue: EventVenueDraft | null) => !venue ? "" : venue.id ? `catalog:${venue.id}` : `manual:${venue.name.trim().toLowerCase()}|${venue.address.trim().toLowerCase()}|${venue.latitude}|${venue.longitude}`;
export function emptySeatPlan(venueKey: string): SeatPlanDraft {
  return { version: 1, id: uid(), venueKey, name: "", sourceId: "", sourceName: "", page: 1, pageCount: 1, background: "", blocks: [], categories: [] };
}
export function rowLabel(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
export function rowIndex(label: string) { return [...label.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1; }
export type BlockInput = Pick<PlanBlock, "name" | "rows" | "columns" | "firstRow" | "firstSeat" | "aisle" | "direction">;
export function blockInputError(input: BlockInput): string | null {
  if (!input.name.trim()) return "Bölmənin adını daxil et.";
  if (!Number.isInteger(input.rows) || input.rows < 1 || input.rows > 100 || !Number.isInteger(input.columns) || input.columns < 1 || input.columns > 100 || input.rows * input.columns > MAX_SEATS) return "1–100 sıra və hər sırada 1–100 yer seç (maksimum 5000 yer).";
  if (!/^[A-Z]{1,3}$/.test(input.firstRow) || rowIndex(input.firstRow) + input.rows > 18278) return "İlk sıra A–ZZZ aralığında olmalıdır.";
  if (!Number.isInteger(input.firstSeat) || input.firstSeat < 1 || input.firstSeat + input.columns > 10000) return "İlk yer nömrəsini düzgün daxil et.";
  if (!Number.isInteger(input.aisle) || input.aisle < 0 || input.aisle >= input.columns) return "Keçid son yerdən əvvəl olmalıdır (keçidsiz: 0).";
  return null;
}
export function createBlock(input: BlockInput, previous?: PlanBlock): PlanBlock {
  const error = blockInputError(input); if (error) throw new Error(error);
  const id = previous?.id || uid();
  const old = new Map(previous?.seats.map(s => [`${s.row}:${s.number}`, s]));
  const seats = Array.from({ length: input.rows * input.columns }, (_, index) => {
    const r = Math.floor(index / input.columns), c = index % input.columns;
    const row = rowLabel(rowIndex(input.firstRow) + r), number = input.firstSeat + (input.direction === "rtl" ? input.columns - 1 - c : c);
    const saved = old.get(`${row}:${number}`);
    return { id: saved?.id || `${id}:${row}:${number}`, row, number, x: 130 + c * 64 + (input.aisle && c >= input.aisle ? 40 : 0), y: 140 + r * 60, blocked: saved?.blocked || false, reason: saved?.reason || "", categoryId: saved?.categoryId || null };
  });
  return { ...input, id, x: previous?.x || 0, y: previous?.y || 0, scale: previous?.scale ?? Math.min(1, 950 / (input.columns * 64 + 180), 610 / (input.rows * 60 + 180)), rotation: previous?.rotation || 0, seats };
}
export function allSeats(plan: SeatPlanDraft) { return plan.blocks.flatMap(b => b.seats); }
export function saleSeats(plan: SeatPlanDraft) { return allSeats(plan).filter(s => !s.blocked); }
export function validPrice(category: PlanCategory) { return category.free || /^\d{1,7}(\.\d{1,2})?$/.test(category.price) && Number(category.price) > 0; }
export function planIssues(plan: SeatPlanDraft, capacity?: number | null): string[] {
  const seats = allSeats(plan), selling = saleSeats(plan), issues: string[] = [];
  if (!plan.name.trim()) issues.push("Planın adını daxil et.");
  if (!seats.length) issues.push("Ən azı bir sıra əlavə et.");
  if (seats.length > MAX_SEATS) issues.push("Maksimum 5000 yer əlavə edilə bilər.");
  if (capacity && seats.length > capacity) issues.push(`Planın ${seats.length} yeri məkanın ${capacity} yerlik tutumunu keçir.`);
  if (seats.length && !selling.length) issues.push("Ən azı bir yer satışa açıq olmalıdır.");
  const missing = selling.filter(s => !plan.categories.some(c => c.id === s.categoryId && c.name.trim() && validPrice(c)));
  if (missing.length) issues.push(`${missing.length} yer üçün qiymət çatışmır.`);
  const ids = new Set<string>(), labels = new Set<string>();
  for (const b of plan.blocks) for (const s of b.seats) {
    const label = `${b.name.trim().toLowerCase()}:${s.row}:${s.number}`;
    if (ids.has(s.id) || labels.has(label)) { issues.push("Yer nömrələri bölmə və sıra daxilində unikal olmalıdır."); return issues; }
    ids.add(s.id); labels.add(label);
  }
  return issues;
}
export function setBlocked(plan: SeatPlanDraft, selected: string[], blocked: boolean, reason = ""): SeatPlanDraft {
  const ids = new Set(selected);
  return { ...plan, blocks: plan.blocks.map(b => ({ ...b, seats: b.seats.map(s => ids.has(s.id) ? { ...s, blocked, reason: blocked ? reason : "" } : s) })) };
}
export function assignCategory(plan: SeatPlanDraft, category: PlanCategory, rowKeys: string[]): SeatPlanDraft {
  const rows = new Set(rowKeys);
  return { ...plan, categories: [...plan.categories.filter(c => c.id !== category.id), category], blocks: plan.blocks.map(b => ({ ...b, seats: b.seats.map(s => rows.has(`${b.id}:${s.row}`) ? { ...s, categoryId: category.id } : s.categoryId === category.id ? { ...s, categoryId: null } : s) })) };
}
export function planTickets(plan: SeatPlanDraft) {
  return plan.categories.flatMap(c => {
    const quantity = String(saleSeats(plan).filter(s => s.categoryId === c.id).length);
    return quantity === "0" ? [] : [{ id: c.id, name: c.name, paymentType: c.free ? "free" as const : "paid" as const, price: c.price, quantity, lastValidQuantity: quantity, includes: "Nömrəli oturacaq" }];
  });
}
export function reusablePlan(plan: SeatPlanDraft): SeatPlanDraft {
  return { ...plan, categories: plan.categories.map(c => ({ ...c, price: "", free: false })) };
}
// Reject malformed local drafts instead of trusting arbitrary serialized geometry.
export function readSeatPlan(value: unknown): SeatPlanDraft | null {
  if (!value || typeof value !== "object") return null;
  const p = value as SeatPlanDraft;
  if (p.version !== 1 || typeof p.id !== "string" || typeof p.name !== "string" || typeof p.venueKey !== "string" || typeof p.background !== "string" || p.background.length > 1_200_000 || (p.background && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(p.background) && !/^https:\/\//.test(p.background)) || !Array.isArray(p.blocks) || p.blocks.length > 50 || !Array.isArray(p.categories) || p.categories.length > 20) return null;
  if (typeof p.sourceId !== "string" || typeof p.sourceName !== "string" || !Number.isInteger(p.page) || p.page < 1 || !Number.isInteger(p.pageCount) || p.pageCount < p.page) return null;
  if (p.categories.some(c => !c || typeof c.id !== "string" || typeof c.name !== "string" || typeof c.price !== "string" || typeof c.free !== "boolean")) return null;
  if (p.blocks.some(b => !b || typeof b.id !== "string" || typeof b.name !== "string" || typeof b.firstRow !== "string" || blockInputError(b) || ![b.x,b.y,b.scale,b.rotation].every(n => typeof n === "number" && Number.isFinite(n)) || b.scale < .1 || b.scale > 3 || !Array.isArray(b.seats) || (b.seats.length < 1 || b.seats.length > b.rows * b.columns) || b.seats.some(s => !s || typeof s.id !== "string" || typeof s.row !== "string" || !Number.isInteger(s.number) || ![s.x,s.y].every(Number.isFinite) || typeof s.blocked !== "boolean" || typeof s.reason !== "string" || !(s.categoryId === null || typeof s.categoryId === "string")))) return null;
  if (allSeats(p).length > MAX_SEATS) return null;
  return p;
}
