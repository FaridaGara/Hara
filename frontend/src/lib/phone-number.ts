export const PHONE_PREFIX = "+994";

export function formatPhoneDigits(digits: string) {
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)]
    .filter(Boolean).join(" ");
}

// Accept national digits or a complete Azerbaijan number pasted/autofilled.
export function phoneDigitsFromInput(value: string): string | null {
  let digits = value.replace(/[^0-9]/g, "");
  if (value.trim().startsWith("+")) {
    if (!value.trim().startsWith(PHONE_PREFIX)) return null;
    digits = digits.slice(3);
  } else if (digits.length === 14 && digits.startsWith("00994")) {
    digits = digits.slice(5);
  } else if (digits.length === 12 && digits.startsWith("994")) {
    digits = digits.slice(3);
  }
  return digits.slice(0, 9);
}

export function phoneNumberError(digits: string): string | null {
  if (!/^[0-9]{9}$/.test(digits)) return "+994 ölkə kodundan sonra 9 rəqəm daxil edin.";
  if (new Set(digits).size === 1 || "01234567890123456789".includes(digits) || "98765432109876543210".includes(digits)) {
    return "Telefon nömrəsinin bütün rəqəmləri eyni və ya ardıcıl ola bilməz.";
  }
  return null;
}
