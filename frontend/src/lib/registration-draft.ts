import type { RegistrationRequest } from "@/lib/api";

// Memory only: retain passwords across client navigation, never browser storage.
let draft: RegistrationRequest | null = null;
export const readRegistrationDraft = () => draft;
export const saveRegistrationDraft = (value: RegistrationRequest) => { draft = value; };
export const clearRegistrationDraft = () => { draft = null; };
