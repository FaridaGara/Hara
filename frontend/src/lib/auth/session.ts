const REFRESH_TOKEN_KEY = "hara.refresh-token";
const AUTH_EVENT = "hara:auth-change";

let accessToken: string | null = null;

function canUseSessionStorage() {
  return typeof window !== "undefined" && "sessionStorage" in window;
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function hasSession() {
  return Boolean(accessToken || getRefreshToken());
}

export function setSession(tokens: { access: string; refresh?: string }) {
  accessToken = tokens.access;

  if (tokens.refresh && canUseSessionStorage()) {
    try {
      window.sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh);
    } catch {
      // The access token remains usable for this page session.
    }
  }

  emitAuthChange();
}

export function clearSession() {
  accessToken = null;

  if (canUseSessionStorage()) {
    try {
      window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Nothing else can be cleared when storage is unavailable.
    }
  }

  emitAuthChange();
}

export function clearAccessToken() {
  accessToken = null;
}

export function subscribeToAuthChange(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(AUTH_EVENT, listener);
  return () => window.removeEventListener(AUTH_EVENT, listener);
}

function emitAuthChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EVENT));
  }
}

export function resetSessionForTests() {
  clearSession();
}
