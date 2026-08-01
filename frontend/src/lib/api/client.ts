import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
} from "@/lib/auth/session";

import type { AuthRefreshResponse } from "./contracts";

const DEFAULT_TIMEOUT_MS = 12_000;
const FALLBACK_API_BASE_URL = "http://127.0.0.1:8000";

export type ApiErrorKind =
  | "cancelled"
  | "network"
  | "timeout"
  | "http"
  | "invalid-response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly payload: unknown;

  constructor({
    message,
    kind,
    status = null,
    payload = null,
  }: {
    message: string;
    kind: ApiErrorKind;
    status?: number | null;
    payload?: unknown;
  }) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.payload = payload;
  }
}

type RequestAuth = "none" | "optional" | "required";

export type ApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  auth?: RequestAuth;
  body?: unknown;
  headers?: HeadersInit;
  timeoutMs?: number;
};

let refreshPromise: Promise<string> | null = null;

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

export const API_BASE_URL = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_HARA_API_BASE_URL || FALLBACK_API_BASE_URL,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstValidationMessage(payload: Record<string, unknown>) {
  for (const [field, value] of Object.entries(payload)) {
    if (field === "detail") {
      continue;
    }

    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0];
    }
  }

  return null;
}

export function safeApiErrorMessage(status: number, payload: unknown) {
  if (isRecord(payload)) {
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail.trim();
    }

    const validationMessage = firstValidationMessage(payload);
    if (validationMessage) {
      return validationMessage;
    }
  }

  if (status === 400) {
    return "Göndərilən məlumatları yoxlayın.";
  }
  if (status === 401) {
    return "Sessiya bitib. Yenidən daxil olun.";
  }
  if (status === 404) {
    return "Axtardığınız məlumat tapılmadı.";
  }
  if (status === 409) {
    return "Əməliyyat hazırkı vəziyyətdə yerinə yetirilə bilmədi.";
  }

  return status >= 500
    ? "Serverdə müvəqqəti problem var. Bir az sonra yenidən cəhd edin."
    : "Sorğu yerinə yetirilə bilmədi.";
}

function createRequestSignal(externalSignal: AbortSignal | null, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

async function parseResponse(response: Response) {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    return text || undefined;
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError({
      kind: "invalid-response",
      status: response.status,
      message: "Server etibarlı JSON cavabı qaytarmadı.",
    });
  }
}

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refresh = getRefreshToken();
  if (!refresh) {
    clearSession();
    throw new ApiError({
      kind: "http",
      status: 401,
      message: "Sessiya bitib. Yenidən daxil olun.",
    });
  }

  refreshPromise = (async () => {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/api/auth/refresh/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ refresh }),
        },
        DEFAULT_TIMEOUT_MS,
      );
      const payload = (await parseResponse(response)) as AuthRefreshResponse;

      if (!response.ok || !payload?.access) {
        throw new ApiError({
          kind: "http",
          status: response.status,
          payload,
          message: safeApiErrorMessage(response.status, payload),
        });
      }

      setSession({ access: payload.access, refresh: payload.refresh });
      return payload.access;
    } catch (error) {
      clearSession();
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const requestSignal = createRequestSignal(init.signal ?? null, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: requestSignal.signal });
  } catch (error) {
    if (requestSignal.signal.aborted) {
      throw new ApiError({
        kind: requestSignal.didTimeOut() ? "timeout" : "cancelled",
        message: requestSignal.didTimeOut()
          ? "Sorğunun cavab müddəti bitdi."
          : "Sorğu dayandırıldı.",
      });
    }

    throw new ApiError({
      kind: "network",
      message: "API ilə əlaqə yaratmaq mümkün olmadı.",
      payload: error,
    });
  } finally {
    requestSignal.cleanup();
  }
}

async function requestOnce<T>(
  path: string,
  options: ApiRequestOptions,
  token: string | null,
) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new ApiError({
      kind: "http",
      status: response.status,
      payload,
      message: safeApiErrorMessage(response.status, payload),
    });
  }

  return payload as T;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const auth = options.auth ?? "optional";
  let token = auth === "none" ? null : getAccessToken();

  if (!token && auth === "required") {
    token = await refreshAccessToken();
  }

  try {
    return await requestOnce<T>(path, options, token);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      auth !== "none"
    ) {
      const refreshedToken = await refreshAccessToken();
      return requestOnce<T>(path, options, refreshedToken);
    }

    throw error;
  }
}

export function resetApiClientForTests() {
  refreshPromise = null;
}
