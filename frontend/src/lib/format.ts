const dateFormatter = new Intl.DateTimeFormat("az-AZ", {
  timeZone: "Asia/Baku",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("az-AZ", {
  timeZone: "Asia/Baku",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatBakuDate(isoDate: string, short = false) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Tarix məlum deyil";
  }

  return (short ? shortDateFormatter : dateFormatter).format(date);
}

export function formatMoney(decimal: string, currency: string) {
  const normalized = decimal.replace(/^(-?)0+(?=\d)/, "$1");
  return `${normalized || "0"} ${currency}`;
}

export function safePosterUrl(value: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
