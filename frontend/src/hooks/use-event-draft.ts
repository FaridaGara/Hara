"use client";

import { useEffect, useRef, useState } from "react";
import { readEventDraft, saveEventDraft, type EventDraft } from "@/lib/event-draft";

export function useEventDraft(userId: number) {
  const [draft, setDraft] = useState(() => readEventDraft(userId));
  const latest = useRef(draft);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const persist = () => { saveEventDraft(userId, latest.current); };
    const whenHidden = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", whenHidden);
    return () => {
      persist();
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", whenHidden);
    };
  }, [userId]);

  function replaceDraft(next: EventDraft) {
    latest.current = next;
    setDraft(next);
    setNotice(null);
  }

  function save(announce = true) {
    const saved = saveEventDraft(userId, latest.current);
    setStorageError(!saved);
    if (announce || !saved) setNotice(saved ? "Qaralama bu brauzerdə saxlanıldı." : null);
    return saved;
  }

  return { draft, replaceDraft, save, notice, storageError };
}
