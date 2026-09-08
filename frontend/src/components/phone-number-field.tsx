"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { formatPhoneDigits, phoneDigitsFromInput, phoneNumberError, PHONE_PREFIX } from "@/lib/phone-number";

import { AuthField } from "./auth-ui";

type Props = { value: string; onChange: (value: string) => void; disabled?: boolean };

function digitCount(value: string) {
  return value.replace(/[^0-9]/g, "").length;
}

function caretAfterDigits(formatted: string, count: number) {
  if (count === 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9]/.test(formatted[i]) && ++seen === count) return i + 1;
  }
  return formatted.length;
}

export function PhoneNumberField({ value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const [touched, setTouched] = useState(false);
  const formatted = formatPhoneDigits(value);
  const error = touched || value.length === 9 ? phoneNumberError(value) : null;

  useLayoutEffect(() => {
    if (caretRef.current !== null && inputRef.current) {
      const position = caretAfterDigits(formatted, caretRef.current);
      inputRef.current.setSelectionRange(position, position);
      caretRef.current = null;
    }
  }, [formatted]);

  return (
    <div className="space-y-1">
      <AuthField
        label="Telefon nömrəsi"
        prefix={PHONE_PREFIX}
        placeholder="xx xxx xx xx"
        icon="lock"
        type="tel"
        name="phone_number"
        inputMode="numeric"
        autoComplete="tel-national"
        inputRef={inputRef}
        required
        maxLength={12}
        pattern="[0-9]{2} [0-9]{3} [0-9]{2} [0-9]{2}"
        value={formatted}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "phone-format-hint phone-format-error" : "phone-format-hint"}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          const next = phoneDigitsFromInput(event.target.value);
          if (next === null) return;
          caretRef.current = digitCount(event.target.value.slice(0, event.target.selectionStart ?? 0));
          onChange(next);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const pasted = phoneDigitsFromInput(event.clipboardData.getData("text"));
          if (pasted === null) return;
          const start = digitCount(formatted.slice(0, event.currentTarget.selectionStart ?? 0));
          const end = digitCount(formatted.slice(0, event.currentTarget.selectionEnd ?? 0));
          // Paste over the selected digits, retaining the fixed country prefix.
          const next = (value.slice(0, start) + pasted + value.slice(end)).slice(0, 9);
          caretRef.current = Math.min(9, start + pasted.length);
          onChange(next);
        }}
        onKeyDown={(event) => {
          const start = event.currentTarget.selectionStart ?? 0;
          const end = event.currentTarget.selectionEnd ?? 0;
          if (start !== end) return;
          if (event.key === "Backspace" && formatted[start - 1] === " ") {
            event.preventDefault();
            const index = digitCount(formatted.slice(0, start)) - 1;
            caretRef.current = index;
            onChange(value.slice(0, index) + value.slice(index + 1));
          } else if (event.key === "Delete" && formatted[start] === " ") {
            event.preventDefault();
            const index = digitCount(formatted.slice(0, start));
            caretRef.current = index;
            onChange(value.slice(0, index) + value.slice(index + 1));
          }
        }}
      />
      <p id="phone-format-hint" className="sr-only">Ölkə kodu +994 sabitdir. Ardınca 9 rəqəm daxil edin.</p>
      {error ? <p id="phone-format-error" role="alert" className="px-2 text-[12px] text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
