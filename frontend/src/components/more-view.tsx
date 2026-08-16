"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "./auth-provider";
import { MobileTabBar } from "./mobile-tab-bar";
import { type ThemePreference, useTheme } from "./theme-provider";

type MenuItem = {
  label: string;
  icon: string;
  href?: string;
  action?: "logout" | "appearance";
};

const ACCOUNT_ITEMS: MenuItem[] = [
  { label: "Şəxsi məlumatlar", icon: "/figma/more/user.svg", href: "/personal-info" },
];

const APP_ITEMS: MenuItem[] = [
  { label: "Dil", icon: "/figma/more/language.svg" },
  { label: "Bildirişlər", icon: "/figma/more/notifications.svg" },
  { label: "Görünüş", icon: "/figma/more/appearance.svg", action: "appearance" },
  { label: "İcazələr", icon: "/figma/more/permissions.svg" },
];

const SUPPORT_ITEMS: MenuItem[] = [
  { label: "Kömək mərkəzi", icon: "/figma/more/help.svg" },
  { label: "Bizimlə əlaqə", icon: "/figma/more/contact.svg" },
  { label: "Tətbiq haqqında", icon: "/figma/more/about.svg" },
  { label: "Məxfilik siyasəti", icon: "/figma/more/privacy.svg" },
  { label: "Şərtlər və qaydalar", icon: "/figma/more/terms.svg" },
];

const ACCOUNT_ACTIONS: MenuItem[] = [
  { label: "Hesabı sil", icon: "/figma/more/delete.svg" },
  { label: "Çıxış", icon: "/figma/more/logout.svg", action: "logout" },
];

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  {
    value: "system",
    label: "Sistem",
    description: "Cihazın görünüş parametrinə uyğun",
  },
  { value: "light", label: "İşıqlı", description: "Həmişə işıqlı görünüş" },
  { value: "dark", label: "Qaranlıq", description: "Həmişə qaranlıq görünüş" },
];

function MenuRow({
  item,
  last,
  onAppearance,
  onLogout,
  onNavigate,
}: {
  item: MenuItem;
  last: boolean;
  onAppearance: () => void;
  onLogout: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={
        item.action === "logout"
          ? onLogout
          : item.action === "appearance"
            ? onAppearance
          : item.href
            ? () => onNavigate(item.href!)
            : undefined
      }
      className="flex min-h-16 w-full items-center gap-3 px-3 text-left transition active:bg-[var(--hara-divider)]"
    >
      <Image src={item.icon} alt="" width={24} height={24} className="hara-theme-icon size-6 shrink-0" />
      <span
        className={`flex min-h-16 min-w-0 flex-1 items-center py-3 ${last ? "" : "border-b border-[var(--hara-divider)]"}`}
      >
        <span className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.23px] text-[var(--hara-primary)]">
          {item.label}
        </span>
      </span>
      {item.action === "logout" ? null : (
        <Image
          src="/figma/more/arrow-right.svg"
          alt=""
          width={16}
          height={16}
          className="hara-theme-icon size-4 shrink-0"
        />
      )}
    </button>
  );
}

function MenuSection({
  title,
  items,
  onAppearance,
  onLogout,
  onNavigate,
}: {
  title?: string;
  items: MenuItem[];
  onAppearance: () => void;
  onLogout: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <section className="px-4 pb-3">
      {title ? (
        <h2 className="flex h-[34px] items-center px-6 py-2 text-[13px] leading-[18px] font-semibold tracking-[-0.08px] text-[var(--hara-muted)]">
          {title}
        </h2>
      ) : null}
      <div className="overflow-hidden rounded-3xl bg-[var(--hara-surface)]">
        {items.map((item, index) => (
          <MenuRow
            key={item.label}
            item={item}
            last={index === items.length - 1}
            onAppearance={onAppearance}
            onLogout={onLogout}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </section>
  );
}

export function MoreView() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const { preference, setPreference } = useTheme();
  const [favorite, setFavorite] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
  const displayName = user?.display_name || fullName || "HARA istifadəçisi";
  const email = user?.email || "Profil məlumatları yüklənir…";
  const avatarUrl = user?.avatar_url?.startsWith(
    "https://lh3.googleusercontent.com/",
  )
    ? user.avatar_url
    : "/figma/more/avatar.png";

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  useEffect(() => {
    if (!appearanceOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppearanceOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appearanceOpen]);

  const chooseTheme = (nextPreference: ThemePreference) => {
    setPreference(nextPreference);
    setAppearanceOpen(false);
  };

  return (
    <main className="hara-home relative mx-auto h-dvh min-h-[620px] w-full max-w-[402px] overflow-hidden transition-colors sm:my-6 sm:h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <header className="hara-more-header absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-[var(--hara-page)] p-4 transition-colors">
        <button
          type="button"
          aria-label="Geri qayıt"
          onClick={() => router.back()}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--hara-surface)] transition active:scale-95"
        >
          <Image src="/figma/more/back.svg" alt="" width={24} height={24} className="size-6" />
        </button>
        <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base leading-[21px] font-semibold tracking-[-0.31px] text-[var(--hara-primary)]">
          Profil
        </h1>
        <button
          type="button"
          aria-label={favorite ? "Sevimliləri bağla" : "Sevimliləri aç"}
          aria-pressed={favorite}
          onClick={() => setFavorite((value) => !value)}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--hara-surface)] transition active:scale-95"
        >
          <Image src="/figma/more/heart.svg" alt="" width={24} height={24} className="size-6" />
        </button>
      </header>

      <div className="hara-more-content scrollbar-none absolute inset-x-0 overflow-y-auto bg-[var(--hara-page)] transition-colors">
        <section className="px-4 py-3" aria-label="Profil məlumatı">
          <div className="flex items-center gap-4 rounded-3xl bg-[var(--hara-surface)] py-3 pr-4 pl-3">
            <Image
              src={avatarUrl}
              alt={displayName}
              width={64}
              height={64}
              priority
              className="size-16 shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl leading-[25px] font-semibold tracking-[-0.45px] text-[var(--hara-primary)]">
                {displayName}
              </p>
              <p className="mt-1 truncate text-[15px] leading-5 tracking-[-0.23px] text-[var(--hara-muted)]">
                {email}
              </p>
            </div>
            <button
              type="button"
              aria-label="Profil məlumatlarını redaktə et"
              onClick={() => router.push("/personal-info?edit=1")}
              className="grid size-10 shrink-0 place-items-center rounded-full transition active:scale-95"
            >
              <Image src="/figma/more/edit.svg" alt="" width={24} height={24} className="size-6" />
            </button>
          </div>
        </section>

        <MenuSection title="Hesab" items={ACCOUNT_ITEMS} onAppearance={() => setAppearanceOpen(true)} onLogout={handleLogout} onNavigate={router.push} />
        <MenuSection title="Tətbiq" items={APP_ITEMS} onAppearance={() => setAppearanceOpen(true)} onLogout={handleLogout} onNavigate={router.push} />
        <MenuSection title="Dəstək" items={SUPPORT_ITEMS} onAppearance={() => setAppearanceOpen(true)} onLogout={handleLogout} onNavigate={router.push} />
        <MenuSection items={ACCOUNT_ACTIONS} onAppearance={() => setAppearanceOpen(true)} onLogout={handleLogout} onNavigate={router.push} />
      </div>

      <MobileTabBar active="more" placement="container" theme="adaptive" />

      {appearanceOpen ? (
        <div
          className="absolute inset-0 z-50 flex items-end bg-black/45"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setAppearanceOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="appearance-title"
            className="w-full rounded-t-[28px] bg-[var(--hara-page)] px-4 pt-3 pb-[calc(24px+var(--hara-safe-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,.18)]"
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--hara-muted)]" />
            <div className="flex h-12 items-center justify-between">
              <h2 id="appearance-title" className="text-xl font-semibold text-[var(--hara-primary)]">
                Görünüş
              </h2>
              <button
                type="button"
                aria-label="Görünüş panelini bağla"
                onClick={() => setAppearanceOpen(false)}
                className="grid size-10 place-items-center rounded-full bg-[var(--hara-surface)] text-2xl leading-none text-[var(--hara-primary)]"
              >
                ×
              </button>
            </div>
            <div role="radiogroup" aria-label="Tema seçimi" className="mt-2 overflow-hidden rounded-3xl bg-[var(--hara-surface)]">
              {THEME_OPTIONS.map((option, index) => {
                const selected = preference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => chooseTheme(option.value)}
                    className={`flex min-h-[68px] w-full items-center gap-3 px-4 text-left ${index === THEME_OPTIONS.length - 1 ? "" : "border-b border-[var(--hara-divider)]"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-[var(--hara-primary)]">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-[var(--hara-muted)]">
                        {option.description}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`grid size-6 place-items-center rounded-full border-2 ${selected ? "border-[var(--hara-tab-active)]" : "border-[var(--hara-muted)]"}`}
                    >
                      {selected ? <span className="size-3 rounded-full bg-[var(--hara-tab-active)]" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
