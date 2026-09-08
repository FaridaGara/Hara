// First-step drafts stay on this device until the remaining creation flow is ready.
// Category slugs follow the existing discovery filters; no event is published here.
export const EVENT_CATEGORIES = [
  ["musiqi", "Musiqi"], ["teatr", "Teatr"], ["workshop", "Workshop"], ["idman", "İdman"],
] as const;
export const EVENT_AGES = ["0+", "6+", "12+", "16+", "18+"] as const;
export const EVENT_LANGUAGES = [
  ["az", "Azərbaycanca"], ["en", "İngiliscə"], ["ru", "Rusca"], ["tr", "Türkcə"],
] as const;

export type EventDraft = {
  title: string;
  category: string;
  description: string;
  age: string;
  language: string;
  duration: string;
};

export const EMPTY_EVENT_DRAFT: EventDraft = {
  title: "", category: "", description: "", age: "", language: "", duration: "",
};

function draftKey(userId: number) {
  return `hara.event-draft.v1:${userId}`;
}

export function readEventDraft(userId: number): EventDraft {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(draftKey(userId)) || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_EVENT_DRAFT };
    const draft = value as Record<string, unknown>;
    const text = (key: string, max: number) => typeof draft[key] === "string" ? draft[key].slice(0, max) : "";
    return {
      title: text("title", 255),
      category: EVENT_CATEGORIES.some(([id]) => id === draft.category) ? String(draft.category) : "",
      description: text("description", 1000),
      age: EVENT_AGES.some((age) => age === draft.age) ? String(draft.age) : "",
      language: EVENT_LANGUAGES.some(([id]) => id === draft.language) ? String(draft.language) : "",
      duration: typeof draft.duration === "string" && /^\d{0,5}$/.test(draft.duration) ? draft.duration : "",
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
    EVENT_CATEGORIES.some(([id]) => id === draft.category) &&
    draft.description.trim() && draft.description.length <= 1000 &&
    (!draft.duration || (/^\d{1,5}$/.test(draft.duration) && Number(draft.duration) > 0)),
  );
}
