"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type UserProfile } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { LifecycleDialog, LifecycleIntro, LifecycleLoading, LifecyclePage, Notice } from "./lifecycle-ui";
import ui from "./lifecycle-ui.module.css";
import css from "./organizer-profile.module.css";

const groups = [
  { title: "Əlaqə məlumatların", fields: [
    ["display_name", "Ad və soyad", "Ad və soyadını daxil et", 150],
    ["phone_number", "Əlaqə nömrəsi", "+994 50 123 45 67", 32],
  ] },
  { title: "Təşkilatçı məlumatların", fields: [
    ["organizer_name", "Təşkilatçı / brend adı", "Tədbirlərdə görünəcək ad", 150],
    ["organizer_description", "Fəaliyyət haqqında", "Hansı tədbirləri təşkil edirsən?", 1000],
    ["organizer_website", "Sayt və ya sosial şəbəkə", "Link əlavə et (istəyə bağlı)", 500],
  ] },
  { title: "VÖEN məlumatların", fields: [
    ["tax_id", "VÖEN", "VÖEN nömrəsini daxil et", 10],
    ["tax_legal_name", "Vergi ödəyicisinin rəsmi adı", "Ad, soyad və ya şirkətin hüquqi adı", 255],
  ] },
] as const;
type Field = typeof groups[number]["fields"][number][0];
type Values = Record<Field, string>;
function values(user: UserProfile): Values {
  return Object.fromEntries(groups.flatMap(group => group.fields.map(([key]) => [key, user[key] || (key === "display_name" ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "")]))) as Values;
}

export function OrganizerProfile() {
  const { user } = useAuth();
  return user ? <Editor key={user.id} user={user} /> : <LifecycleLoading label="Profil yüklənir…" />;
}
function Editor({ user }: { user: UserProfile }) {
  const { updateProfile } = useAuth();
  const router = useRouter();
  const fromEvent = useSearchParams().get("from") === "event";
  const [form, setForm] = useState(() => values(user));
  const [saved, setSaved] = useState(() => values(user));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [leave, setLeave] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current) return false;
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) as Values;
    const validation: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) if (key !== "organizer_website" && !value) validation[key] = "Bu sahə məcburidir.";
    payload.phone_number = payload.phone_number.replace(/[\s()-]/g, "");
    if (!/^\+994[0-9]{9}$/.test(payload.phone_number)) validation.phone_number = "+994 ölkə kodundan sonra 9 rəqəm daxil et.";
    if (!/^[0-9]{10}$/.test(payload.tax_id)) validation.tax_id = "VÖEN 10 rəqəmdən ibarət olmalıdır.";
    if (payload.organizer_website) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(payload.organizer_website)) payload.organizer_website = `https://${payload.organizer_website}`;
      try { const url = new URL(payload.organizer_website); if (!["https:", "http:"].includes(url.protocol) || !url.hostname.includes(".")) throw new Error(); }
      catch { validation.organizer_website = "Düzgün sayt və ya sosial şəbəkə linki daxil et."; }
    }
    setErrors(validation); setMessage("");
    if (Object.keys(validation).length) return false;
    inFlight.current = true; setBusy(true);
    try {
      const result = await updateProfile(payload);
      if (result.tax_id !== payload.tax_id || result.organizer_name !== payload.organizer_name) throw new Error("Profil yeniləməsi hazırda tamamlanmadı. Məlumatların bu formada saxlanılıb; yenidən cəhd et.");
      const next = values(result); setForm(next); setSaved(next); setMessage("Məlumatların yadda saxlanıldı."); return true;
    } catch (cause) {
      const fields: Record<string, string> = {};
      if (cause instanceof ApiError && cause.payload && typeof cause.payload === "object") {
        for (const [key, value] of Object.entries(cause.payload)) fields[key] = Array.isArray(value) ? value.join(" ") : String(value);
      }
      setErrors({ ...fields, general: cause instanceof Error ? cause.message : "Saxlamaq mümkün olmadı. Yenidən cəhd et." }); return false;
    } finally { inFlight.current = false; setBusy(false); }
  }
  function createEvent() {
    if (dirty) setLeave(true);
    else router.push("/create-event");
  }
  return <LifecyclePage title="Təşkilatçı məlumatları" backHref="/more">
    <form className={css.form} onSubmit={event => void save(event)} noValidate>
      <LifecycleIntro title={fromEvent ? "Ödənişli tədbirlərə hazır ol" : "Təşkilatçı profilin"}>Əlaqə, təşkilatçı və VÖEN məlumatların burada saxlanılır.</LifecycleIntro>
      {groups.map((group, index) => <section className={css.section} key={group.title} aria-label={group.title}>
        <h2>{group.title}</h2>
        {group.fields.map(([key, label, placeholder, maxLength], fieldIndex) => <div key={key}>
          <label className={css.field} htmlFor={key}><span>{label}{key !== "organizer_website" ? " *" : ""}</span>
            <input id={key} name={key} value={form[key]} placeholder={placeholder} maxLength={maxLength} required={key !== "organizer_website"} disabled={busy} inputMode={key === "tax_id" ? "numeric" : key === "phone_number" ? "tel" : "text"} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-error` : undefined} onChange={event => { setForm(current => ({ ...current, [key]: event.target.value })); setMessage(""); setErrors(current => ({ ...current, [key]: "", general: "" })); }} />
          </label>
          {errors[key] ? <p id={`${key}-error`} className={css.error}>{errors[key]}</p> : null}
          {index === 0 && fieldIndex === 0 ? <label className={css.field}><span>E-poçt</span><input value={user.email} readOnly aria-label="E-poçt" /></label> : null}
        </div>)}
        {index === 2 ? <p className={ui.meta}>Rəsmi adı VÖEN qeydiyyatındakı kimi yaz. Bu məlumatlar tədbir səhifəsində göstərilməyəcək.</p> : null}
      </section>)}
      {!user.is_email_verified ? <Notice title="E-poçtunu təsdiqlə"><p>Tədbiri göndərmək üçün e-poçt təsdiqi lazımdır.</p><Link className={ui.secondary} href={`/verify?email=${encodeURIComponent(user.email)}`}>E-poçtu təsdiqlə</Link></Notice> : null}
      <Notice title="Yeni tədbir yarat"><p>Bu məlumatlar təşkilatçı profilinə aiddir. Yaratdığın tədbir ayrıca yoxlamaya göndərilir.</p>{user.account_type !== "organizer" && user.role !== "superadmin" ? <p>Ödənişli tədbiri göndərmək üçün HARA tərəfindən təşkilatçı hesabının təsdiqi lazımdır. Profilin saxlanması bu icazəni avtomatik vermir.</p> : null}</Notice>
      {message ? <p role="status" className={ui.meta}>{message}</p> : null}
      {errors.general || Object.values(errors).some(Boolean) ? <p role="alert" className={css.error}>{errors.general || "İşarələnmiş sahələri yoxla."}</p> : null}
      <div className={css.actions}><button type="submit" className={ui.primary} disabled={busy}>{busy ? "Saxlanılır…" : "Yadda saxla"}</button><button type="button" className={ui.secondary} disabled={busy} onClick={createEvent}>{fromEvent ? "Qaralamaya qayıt" : "Tədbir yarat"}</button></div>
    </form>
    {leave ? <LifecycleDialog title="Dəyişikliklər saxlanılmayıb" onClose={() => { if (!busy) setLeave(false); }} footer={<><button className={ui.primary} disabled={busy} onClick={async () => { if (await save()) router.push("/create-event"); }}>{busy ? "Saxlanılır…" : "Yadda saxla və davam et"}</button><button className={ui.secondary} disabled={busy} onClick={() => router.push("/create-event")}>Saxlamadan davam et</button><button className={ui.textButton} disabled={busy} onClick={() => setLeave(false)}>Profilə qayıt</button></>}><p>Profilə etdiyin dəyişiklikləri saxlamaq istəyirsən?</p>{errors.general || Object.values(errors).some(Boolean) ? <p role="alert">Saxlanılmadı. Profilə qayıdıb işarələnmiş sahələri yoxla.</p> : null}</LifecycleDialog> : null}
  </LifecyclePage>;
}
