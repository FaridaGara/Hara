export function safeLocalRedirect(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const url = new URL(value, "http://hara.local");
    return url.origin === "http://hara.local"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function loginHref(nextRoute: string) {
  return `/login?next=${encodeURIComponent(safeLocalRedirect(nextRoute))}`;
}
