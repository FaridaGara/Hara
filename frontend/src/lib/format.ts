const AZERBAIJANI_MONTHS = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "İyun",
  "İyul",
  "Avqust",
  "Sentyabr",
  "Oktyabr",
  "Noyabr",
  "Dekabr",
] as const;

const bakuDatePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Baku",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatBakuDate(isoDate: string, short = false) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Tarix məlum deyil";
  }

  const parts = Object.fromEntries(
    bakuDatePartsFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  const month = AZERBAIJANI_MONTHS[Number(parts.month) - 1];

  if (!month || !parts.day || !parts.year || !parts.hour || !parts.minute) {
    return "Tarix məlum deyil";
  }

  const dateAndTime = `${Number(parts.day)} ${month}${short ? " •" : ` ${parts.year},`} ${parts.hour}:${parts.minute}`;
  return dateAndTime;
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
