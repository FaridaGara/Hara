import type { EventSubmission } from "./api/event-submissions";

export const submissionStatuses: Record<EventSubmission["status"], { label: string; description: string }> = {
  pending: { label: "Yoxlamadadır", description: "Tədbir HARA komandasına göndərilib. Təsdiq və ya düzəliş rəyi burada görünəcək." },
  changes_requested: { label: "Düzəliş tələb olunur", description: "Moderatorun qeydini oxu, məlumatları düzəlt və yenidən yoxlamaya göndər." },
  published: { label: "Yayımlanıb", description: "Tədbir təsdiqlənib və iştirakçılara görünür." },
  cancelled: { label: "Dayandırılıb", description: "Tədbir yayımdan çıxarılıb. Bilet satışı və giriş bağlıdır." },
  completed: { label: "Başa çatıb", description: "Tədbir başa çatıb." },
};

export function submissionTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("az-AZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" }).format(new Date(value));
}
