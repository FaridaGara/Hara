"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "./auth-provider";
import { MobileTabBar } from "./mobile-tab-bar";

type MenuItem = {
  label: string;
  icon: string;
  href?: string;
  action?: "logout";
};

const ACCOUNT_ITEMS: MenuItem[] = [
  { label: "Şəxsi məlumatlar", icon: "/figma/more/user.svg", href: "/personal-info" },
];

const APP_ITEMS: MenuItem[] = [
  { label: "Dil", icon: "/figma/more/language.svg" },
  { label: "Bildirişlər", icon: "/figma/more/notifications.svg" },
  { label: "Görünüş", icon: "/figma/more/appearance.svg" },
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

function MenuRow({
  item,
  last,
  onLogout,
  onNavigate,
}: {
  item: MenuItem;
  last: boolean;
  onLogout: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={
        item.action === "logout"
          ? onLogout
          : item.href
            ? () => onNavigate(item.href!)
            : undefined
      }
      className="flex min-h-16 w-full items-center gap-3 px-3 text-left transition active:bg-black/[0.03]"
    >
      <Image src={item.icon} alt="" width={24} height={24} className="size-6 shrink-0" />
      <span
        className={`flex min-h-16 min-w-0 flex-1 items-center py-3 ${last ? "" : "border-b border-[#ddd]"}`}
      >
        <span className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.23px] text-black/90">
          {item.label}
        </span>
      </span>
      {item.action === "logout" ? null : (
        <Image
          src="/figma/more/arrow-right.svg"
          alt=""
          width={16}
          height={16}
          className="size-4 shrink-0"
        />
      )}
    </button>
  );
}

function MenuSection({
  title,
  items,
  onLogout,
  onNavigate,
}: {
  title?: string;
  items: MenuItem[];
  onLogout: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <section className="px-4 pb-3">
      {title ? (
        <h2 className="flex h-[34px] items-center px-6 py-2 text-[13px] leading-[18px] font-semibold tracking-[-0.08px] text-black/[0.38]">
          {title}
        </h2>
      ) : null}
      <div className="overflow-hidden rounded-3xl bg-[#f3f5f7]">
        {items.map((item, index) => (
          <MenuRow
            key={item.label}
            item={item}
            last={index === items.length - 1}
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
  const [favorite, setFavorite] = useState(false);
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

  return (
    <main className="hara-home relative mx-auto h-dvh min-h-[620px] w-full max-w-[402px] overflow-hidden bg-white text-[#18181a] sm:my-6 sm:h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <header className="hara-more-header absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-white p-4">
        <button
          type="button"
          aria-label="Geri qayıt"
          onClick={() => router.back()}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
        >
          <Image src="/figma/more/back.svg" alt="" width={24} height={24} className="size-6" />
        </button>
        <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base leading-[21px] font-semibold tracking-[-0.31px] text-black/90">
          Profil
        </h1>
        <button
          type="button"
          aria-label={favorite ? "Sevimliləri bağla" : "Sevimliləri aç"}
          aria-pressed={favorite}
          onClick={() => setFavorite((value) => !value)}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f3f5f7] transition active:scale-95"
        >
          <Image src="/figma/more/heart.svg" alt="" width={24} height={24} className="size-6" />
        </button>
      </header>

      <div className="hara-more-content scrollbar-none absolute inset-x-0 overflow-y-auto bg-white">
        <section className="px-4 py-3" aria-label="Profil məlumatı">
          <div className="flex items-center gap-4 rounded-3xl bg-[#f3f5f7] py-3 pr-4 pl-3">
            <Image
              src={avatarUrl}
              alt={displayName}
              width={64}
              height={64}
              priority
              className="size-16 shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl leading-[25px] font-semibold tracking-[-0.45px] text-black/90">
                {displayName}
              </p>
              <p className="mt-1 truncate text-[15px] leading-5 tracking-[-0.23px] text-black/[0.38]">
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

        <MenuSection title="Hesab" items={ACCOUNT_ITEMS} onLogout={handleLogout} onNavigate={router.push} />
        <MenuSection title="Tətbiq" items={APP_ITEMS} onLogout={handleLogout} onNavigate={router.push} />
        <MenuSection title="Dəstək" items={SUPPORT_ITEMS} onLogout={handleLogout} onNavigate={router.push} />
        <MenuSection items={ACCOUNT_ACTIONS} onLogout={handleLogout} onNavigate={router.push} />
      </div>

      <MobileTabBar active="more" placement="container" />
    </main>
  );
}
