import { isEventDraftComplete, type EventDraft } from "./event-draft";
import { isScheduleComplete, wallTime } from "./event-schedule";
import { salesError } from "./event-sales";

export type ReviewIssue = { step: 1 | 2 | 3 | 4; message: string };
export function reviewIssues(draft: EventDraft, now = Date.now()): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (!isEventDraftComplete(draft)) issues.push({ step: 1, message: "Əsas məlumatları tamamla." });
  const start = wallTime(draft.schedule.startDate, draft.schedule.startTime);
  if (!isScheduleComplete(draft.schedule)) issues.push({ step: 2, message: "Tarix və məkan məlumatlarını tamamla." });
  else if (start !== null && start - 4 * 3_600_000 <= now) issues.push({ step: 2, message: "Başlanğıc tarixi keçib. Yeni tarix seç." });
  const error = salesError(draft);
  if (error) issues.push({ step: 3, message: error });
  if (draft.sales.admissionType === "seated" && draft.sales.seatPlan?.blocks.some(block => {
    const angle = block.rotation * Math.PI / 180;
    return block.seats.some(seat => {
      const x = block.x + block.scale * (seat.x * Math.cos(angle) - seat.y * Math.sin(angle));
      const y = block.y + block.scale * (seat.x * Math.sin(angle) + seat.y * Math.cos(angle));
      return x < 0 || x > 1000 || y < 0 || y > 650;
    });
  })) issues.push({ step: 3, message: "Oturacaq bloklarını planın görünən sahəsinə yerləşdir." });
  const end = draft.sales.salesEnd === "event_start" ? start : wallTime(draft.sales.salesEndDate, draft.sales.salesEndTime);
  const saleStart = draft.sales.salesStart === "published" ? now + 4 * 3_600_000 : wallTime(draft.sales.salesStartDate, draft.sales.salesStartTime);
  if (end !== null && (end - 4 * 3_600_000 <= now || (saleStart !== null && saleStart >= end))) issues.push({ step: 3, message: "Satışın bitməsi başlanğıcdan sonra və gələcəkdə olmalıdır." });
  if (!draft.media?.cover) issues.push({ step: 4, message: "Üz qabığı çatışmır. Şəkil əlavə et." });
  return issues;
}

// Only the chosen media, ticket settings and applied seat geometry are submitted.
export function submissionDraft(draft: EventDraft) {
  const copy = structuredClone(draft);
  delete copy.submissionId;
  if (copy.sales.seatPlan) delete copy.sales.seatPlan.editorDraft;
  return copy;
}
