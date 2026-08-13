"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { ApiError, type UserProfile } from "@/lib/api";

import { useAuth } from "./auth-provider";

const INTEREST_OPTIONS = [
  { name: "Musiqi", emoji: "♫" },
  { name: "Səyahət", emoji: "✈" },
  { name: "Festival", emoji: "🎪" },
  { name: "Texnologiya", emoji: "▰" },
  { name: "Rəqs", emoji: "💃" },
  { name: "İncəsənət", emoji: "🎨" },
] as const;

const MONTHS = [
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
];

type ProfileForm = {
  display_name: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  birth_date: string;
  interests: string[];
};

function formatBirthDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return "Əlavə edilməyib";
  }
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]}, ${year}`;
}

function interestLabel(name: string) {
  const option = INTEREST_OPTIONS.find((item) => item.name === name);
  return option ? `${option.emoji} ${option.name}` : name;
}

export function PersonalInfoForm() {
  const { user } = useAuth();

  if (!user) {
    return (
      <main className="hara-home grid min-h-dvh place-items-center bg-white text-sm text-black/45">
        Profil yüklənir…
      </main>
    );
  }

  return <PersonalInfoEditor key={user.id} user={user} />;
}

function PersonalInfoEditor({ user }: { user: UserProfile }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updateProfile } = useAuth();
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [form, setForm] = useState<ProfileForm>(() => ({
    display_name:
      user.display_name ||
      [user.first_name, user.last_name].filter(Boolean).join(" "),
    first_name: user.first_name,
    last_name: user.last_name,
    phone_number: user.phone_number,
    birth_date: user.birth_date || "",
    interests: user.interests,
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const avatarUrl = user.avatar_url.startsWith(
    "https://lh3.googleusercontent.com/",
  )
    ? user.avatar_url
    : "/figma/more/avatar.png";
  const displayName = form.display_name || "HARA istifadəçisi";

  const setField = <Field extends keyof ProfileForm>(
    field: Field,
    value: ProfileForm[Field],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage(null);
  };

  const toggleInterest = (interest: string) => {
    setField(
      "interests",
      form.interests.includes(interest)
        ? form.interests.filter((item) => item !== interest)
        : [...form.interests, interest],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateProfile({
        display_name: form.display_name.trim(),
        first_name: form.first_name,
        last_name: form.last_name,
        phone_number: form.phone_number.trim(),
        birth_date: form.birth_date || null,
        interests: form.interests,
      });
      setEditing(false);
      setMessage("Profil məlumatları yeniləndi.");
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Profil məlumatları yenilənmədi.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="hara-home relative mx-auto h-dvh min-h-[620px] w-full max-w-[402px] overflow-hidden bg-white text-[#18181a] sm:my-6 sm:h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <header className="hara-personal-header absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-white p-4">
        <button
          type="button"
          aria-label="Geri qayıt"
          onClick={() => router.back()}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
        >
          <Image src="/figma/personal-info/back.svg" alt="" width={24} height={24} className="size-6" />
        </button>
        <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base leading-[21px] font-semibold tracking-[-0.31px] text-black/90">
          Şəxsi məlumatlar
        </h1>
        <button
          type="button"
          aria-label={editing ? "Redaktəni bağla" : "Profil məlumatlarını redaktə et"}
          aria-pressed={editing}
          onClick={() => setEditing((value) => !value)}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
        >
          <Image src="/figma/personal-info/edit.svg" alt="" width={24} height={24} className="size-6" />
        </button>
      </header>

      <form
        onSubmit={handleSubmit}
        className="hara-personal-content scrollbar-none absolute inset-x-0 overflow-y-auto bg-white pb-6"
      >
        <section className="flex flex-col items-center gap-4 px-4 py-3" aria-label="Profil">
          <Image
            src={avatarUrl}
            alt={displayName}
            width={100}
            height={100}
            priority
            className="size-[100px] rounded-full object-cover"
          />
          {editing ? (
            <input
              aria-label="Ad və soyad"
              value={form.display_name}
              onChange={(event) => setField("display_name", event.target.value)}
              autoComplete="name"
              className="h-10 w-full max-w-[280px] rounded-xl border border-black/10 bg-[#f3f5f7] px-3 text-center text-xl leading-[25px] font-semibold tracking-[-0.45px] outline-none focus:border-[#565dd8]"
            />
          ) : (
            <p className="text-xl leading-[25px] font-semibold tracking-[-0.45px] text-black/90">
              {displayName}
            </p>
          )}
        </section>

        <section className="px-4 py-3" aria-label="Hesab məlumatları">
          <div className="overflow-hidden rounded-3xl bg-[#f3f5f7]">
            <InfoRow icon="name.svg" label="Ad" value={displayName} last={false} />
            <InfoRow icon="email.svg" label="E-poçt" value={user.email} last={false} />
            <InfoRow
              icon="phone.svg"
              label="Telefon nömrəsi"
              value={form.phone_number || "Əlavə edilməyib"}
              last={false}
              editing={editing}
            >
              <input
                aria-label="Telefon nömrəsi"
                value={form.phone_number}
                onChange={(event) => setField("phone_number", event.target.value)}
                autoComplete="tel"
                inputMode="tel"
                placeholder="+994"
                className="h-9 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-right text-[15px] font-semibold outline-none focus:border-[#565dd8]"
              />
            </InfoRow>
            <InfoRow
              icon="birthday.svg"
              label="Doğum tarixi"
              value={formatBirthDate(form.birth_date)}
              last
              editing={editing}
            >
              <input
                aria-label="Doğum tarixi"
                type="date"
                value={form.birth_date}
                onChange={(event) => setField("birth_date", event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-right text-[13px] font-semibold outline-none focus:border-[#565dd8]"
              />
            </InfoRow>
          </div>
        </section>

        <section className="px-4 pb-3" aria-labelledby="interests-heading">
          <h2 id="interests-heading" className="flex h-[34px] items-center px-6 py-2 text-[13px] leading-[18px] font-semibold tracking-[-0.08px] text-black/[0.38]">
            Maraqlar
          </h2>
          <div className="flex flex-wrap gap-2 rounded-3xl bg-[#f3f5f7] p-4">
            {form.interests.map((interest) => (
              <button
                key={interest}
                type="button"
                onClick={() => editing && toggleInterest(interest)}
                aria-pressed={editing ? true : undefined}
                className="flex h-9 items-center justify-center rounded-xl bg-[#98ff00] px-3 text-[13px] leading-[18px] tracking-[-0.08px] text-black/90"
              >
                {interestLabel(interest)}
              </button>
            ))}
            {editing
              ? INTEREST_OPTIONS.filter(({ name }) => !form.interests.includes(name)).map(
                  ({ name, emoji }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleInterest(name)}
                      className="flex h-9 items-center justify-center rounded-xl border border-dashed border-[#555] bg-[#f2f2f2] px-3 text-[13px] leading-[18px] tracking-[-0.08px] text-black/90"
                    >
                      {emoji} {name}
                    </button>
                  ),
                )
              : null}
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex h-9 items-center justify-center gap-1 rounded-xl border border-dashed border-[#555] bg-[#f2f2f2] px-3 text-[13px] leading-[18px] tracking-[-0.08px] text-black/90"
              >
                <Image src="/figma/personal-info/add.svg" alt="" width={16} height={16} className="size-4" />
                Əlavə et
              </button>
            ) : null}
          </div>
        </section>

        {error ? <p role="alert" className="px-6 pb-3 text-sm text-red-600">{error}</p> : null}
        {message ? <p role="status" className="px-6 pb-3 text-sm text-emerald-700">{message}</p> : null}

        {editing ? (
          <div className="flex gap-3 px-4 pb-4 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-12 flex-1 rounded-2xl bg-[#f3f5f7] px-4 font-semibold text-black/70"
            >
              Ləğv et
            </button>
            <button
              type="submit"
              disabled={saving || !form.display_name.trim()}
              className="min-h-12 flex-1 rounded-2xl bg-[#98ff00] px-4 font-bold text-black disabled:opacity-50"
            >
              {saving ? "Saxlanılır…" : "Yadda saxla"}
            </button>
          </div>
        ) : null}
      </form>
    </main>
  );
}

function InfoRow({
  icon,
  label,
  value,
  last,
  editing = false,
  children,
}: {
  icon: string;
  label: string;
  value: string;
  last: boolean;
  editing?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 pt-3 pr-6 pl-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full">
        <Image src={`/figma/personal-info/${icon}`} alt="" width={24} height={24} className="size-6" />
      </span>
      <div className={`flex min-h-14 min-w-0 flex-1 items-center gap-2 py-3 ${last ? "" : "border-b border-[#ddd]"}`}>
        <span className="shrink-0 text-[13px] leading-[18px] tracking-[-0.08px] text-black/90">
          {label}
        </span>
        {editing && children ? (
          children
        ) : (
          <span className="min-w-0 flex-1 truncate text-right text-[15px] leading-5 font-semibold tracking-[-0.23px] text-black/90">
            {value}
          </span>
        )}
      </div>
    </div>
  );
}
