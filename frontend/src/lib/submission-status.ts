import type { EventSubmission } from "./api/event-submissions";

export const submissionStatuses: Record<EventSubmission["status"], { label: string; description: string }> = {
  pending: { label: "Yoxlanılır", description: "Tədbir HARA komandasına göndərilib. Hazırda yoxlanılır; təsdiqlənəndən sonra yayımlanacaq." },
  changes_requested: { label: "Düzəliş tələb olunur", description: "Moderatorun qeydini oxu, məlumatları düzəlt və yenidən yoxlamaya göndər." },
  published: { label: "Yayımlanıb", description: "Tədbir təsdiqlənib və iştirakçılara görünür." },
  cancelled: { label: "Ləğv edilib", description: "Tədbir ləğv edilib." },
  completed: { label: "Tamamlanıb", description: "Tədbir tamamlanıb." },
};

export function submissionTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("az-AZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" }).format(new Date(value));
}
