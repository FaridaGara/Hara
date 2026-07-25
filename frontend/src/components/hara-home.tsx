"use client";

import Image from "next/image";
import { useState } from "react";

type FeaturedEvent = {
  id: string;
  title: string;
  category: string;
  date: string;
  price: string;
  image: string;
};

type UpcomingEvent = {
  id: string;
  title: string;
  details: string;
  price: string;
  free?: boolean;
  image: string;
};

const categories = ["Hamısı", "Musiqi", "Festival", "Tech", "İdman", "Sənət", "Komedi"];

const featuredEvents: FeaturedEvent[] = [
  {
    id: "jazz",
    title: "Baku Jazz Festival 2025",
    category: "Musiqi",
    date: "24 Oktyabr, 20:00",
    price: "30 AZN",
    image: "/figma/jazz.png",
  },
  {
    id: "networking",
    title: "Tech Networking Night",
    category: "Networking",
    date: "26 Oktyabr, 19:00",
    price: "Pulsuz",
    image: "/figma/networking.png",
  },
  {
    id: "art",
    title: "Underground Art",
    category: "Sənət",
    date: "27 Oktyabr, 18:00",
    price: "15 AZN",
    image: "/figma/art.png",
  },
];

const upcomingEvents: UpcomingEvent[] = [
  {
    id: "flamenco",
    title: "Flamenko Axşamı",
    details: "28 Oktyabr • Rotunda Hall",
    price: "25 AZN",
    image: "/figma/flamenco.png",
  },
  {
    id: "startup",
    title: "Startup Pitch Night",
    details: "30 Oktyabr • Baku Tech",
    price: "Pulsuz",
    free: true,
    image: "/figma/startup.png",
  },
  {
    id: "marathon",
    title: "Bakı Marafonu 2025",
    details: "2 Noyabr • Seafront",
    price: "10 AZN",
    image: "/figma/marathon.png",
  },
];

const navItems = [
  { label: "Əsas", icon: "/figma/home.svg", active: true },
  { label: "Xəritə", icon: "/figma/map.svg" },
  { label: "Tickets", icon: "/figma/ticket.svg" },
  { label: "More", icon: "/figma/more.svg" },
];

function StatusBar() {
  return (
    <div className="flex h-11 items-center justify-between px-5 text-[15px] font-semibold text-white">
      <span>9:41</span>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <div className="flex h-3 items-end gap-[2px]">
          {[4, 6, 8, 10].map((height) => (
            <span
              key={height}
              className="block w-[2px] rounded-full bg-white"
              style={{ height }}
            />
          ))}
        </div>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path
            d="M2 4.8C5.4 1.8 10.6 1.8 14 4.8M4.5 7.3c2-1.7 5-1.7 7 0M7 9.7c.6-.5 1.4-.5 2 0"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <div className="flex items-center gap-[2px]">
          <span className="block h-[9px] w-[19px] rounded-[3px] border border-white/80 p-[1px]">
            <span className="block h-full w-full rounded-[1px] bg-white" />
          </span>
          <span className="block h-1 w-[1.5px] rounded-r bg-white/70" />
        </div>
      </div>
    </div>
  );
}

function FeaturedCard({
  event,
  favorite,
  onFavorite,
}: {
  event: FeaturedEvent;
  favorite: boolean;
  onFavorite: () => void;
}) {
  return (
    <article className="relative h-[180px] w-[260px] shrink-0 overflow-hidden rounded-2xl">
      <Image
        src={event.image}
        alt=""
        fill
        priority={event.id === "jazz"}
        sizes="260px"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-[rgba(12,12,16,0.9)]" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
        <span className="rounded-md bg-[#565dd8] px-[9px] py-[3px] text-[10px] font-bold uppercase text-white">
          {event.category}
        </span>
        <button
          type="button"
          onClick={onFavorite}
          aria-label={favorite ? `${event.title} seçimini sil` : `${event.title} tədbirini seç`}
          aria-pressed={favorite}
          className="grid size-[30px] cursor-pointer place-items-center rounded-full bg-black/30 transition hover:bg-black/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
        >
          <Image
            src={favorite ? "/figma/heart-active.svg" : "/figma/heart.svg"}
            alt=""
            width={15}
            height={15}
          />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5">
        <h3 className="text-[17px] leading-tight font-bold text-white">
          {event.title}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-white/60">{event.date}</p>
          <span className="shrink-0 rounded-md bg-[#1a1a22] px-2 py-[3px] text-xs font-bold text-[#7379ef]">
            {event.price}
          </span>
        </div>
      </div>
    </article>
  );
}

function NearbyCard() {
  return (
    <section className="relative h-[150px] overflow-hidden rounded-[20px] border border-white/10 bg-[#0d0d14] p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_45%,rgba(86,93,216,0.20),transparent_38%)]" />

      <div className="absolute top-[34px] right-[84px] h-px w-10 rotate-[8deg] bg-[#565dd8]/25" />
      <div className="absolute top-[36px] right-[83px] size-2 rounded-full bg-[#565dd8] shadow-[0_0_12px_#565dd8]" />
      <div className="absolute top-[78px] right-[43px] h-px w-8 -rotate-[12deg] bg-[#565dd8]/25" />
      <div className="absolute top-[76px] right-[42px] size-[7px] rounded-full bg-[#565dd8] shadow-[0_0_12px_#565dd8]" />
      <div className="absolute top-[91px] right-[16px] size-[5px] rounded-full bg-[#565dd8]" />

      <div className="relative">
        <h2 className="text-xl font-bold text-white">14 Yaxın Tədbir</h2>
        <p className="mt-1 text-[13px] text-white/50">
          Sənin ətrafında baş verənləri gör
        </p>
      </div>

      <button
        type="button"
        className="absolute bottom-[18px] left-5 flex cursor-pointer items-center gap-1 rounded-full bg-[#98ff00] px-3.5 py-2 text-[13px] font-bold text-[#18181a] transition hover:bg-[#b0ff3d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Xəritədə gör
        <Image src="/figma/arrow-right.svg" alt="" width={13} height={13} />
      </button>
    </section>
  );
}

function UpcomingRow({ event }: { event: UpcomingEvent }) {
  return (
    <button
      type="button"
      className="group flex w-full cursor-pointer items-center gap-3 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
    >
      <span className="relative size-[52px] shrink-0 overflow-hidden rounded-[10px]">
        <Image
          src={event.image}
          alt=""
          fill
          sizes="52px"
          className="object-cover transition duration-300 group-hover:scale-105"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">
          {event.title}
        </span>
        <span className="mt-[3px] block truncate text-xs text-white/40">
          {event.details}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className={`rounded-md bg-[#1a1a22] px-[9px] py-1 text-xs font-bold ${
            event.free ? "text-[#98ff00]" : "text-white"
          }`}
        >
          {event.price}
        </span>
        <Image
          src="/figma/chevron-right.svg"
          alt=""
          width={14}
          height={14}
        />
      </span>
    </button>
  );
}

export function HaraHome() {
  const [activeCategory, setActiveCategory] = useState("Hamısı");
  const [favorites, setFavorites] = useState(() => new Set(["jazz"]));

  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <main className="min-h-screen bg-[#09090e] text-white sm:bg-[#050508] sm:py-8">
      <div className="relative mx-auto min-h-screen w-full overflow-hidden bg-[#111118] sm:min-h-[900px] sm:max-w-[390px] sm:rounded-[32px] sm:border sm:border-white/10 sm:shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="pointer-events-none absolute -top-20 -left-20 size-[330px] rounded-full bg-[#565dd8]/20 blur-[75px]" />

        <div className="relative pb-[112px]">
          <StatusBar />

          <header className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2">
              <Image
                src="/figma/hara-logo.svg"
                alt=""
                width={40}
                height={40}
                priority
              />
              <span className="text-[22px] font-bold tracking-[-0.02em]">Hara</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Bildirişlər"
                className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
              >
                <Image
                  src="/figma/notification.svg"
                  alt=""
                  width={36}
                  height={36}
                />
              </button>
              <button
                type="button"
                aria-label="Profil"
                className="size-9 cursor-pointer rounded-full bg-white ring-1 ring-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
              />
            </div>
          </header>

          <section className="px-5 pt-1 pb-4">
            <p className="text-base font-medium text-white/60">Salam, Leyla 👋</p>
            <h1 className="mt-2 text-[34px] leading-[1.08] font-bold tracking-[-0.035em]">
              Bu həftə nə var?
            </h1>
          </section>

          <div className="px-5 pb-5">
            <label className="flex items-center gap-2.5 rounded-3xl border border-white/10 bg-white/5 px-4 py-[13px] backdrop-blur-lg focus-within:border-white/20">
              <Image src="/figma/search.svg" alt="" width={18} height={18} />
              <span className="sr-only">Axtar</span>
              <input
                type="search"
                placeholder="Tədbir, yer, icma axtar..."
                className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/30"
              />
            </label>
          </div>

          <div className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-7">
            {categories.map((category) => {
              const active = category === activeCategory;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`shrink-0 cursor-pointer rounded-full border px-4 py-[7px] text-sm transition ${
                    active
                      ? "border-[#98ff00] bg-[#98ff00] font-bold text-[#18181a]"
                      : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>

          <section className="pb-8">
            <h2 className="px-5 text-[22px] font-bold tracking-[-0.02em]">
              Bu həftənin tədbirləri
            </h2>
            <div className="scrollbar-none mt-3.5 flex snap-x gap-3.5 overflow-x-auto px-5 pb-1">
              {featuredEvents.map((event) => (
                <div key={event.id} className="snap-start">
                  <FeaturedCard
                    event={event}
                    favorite={favorites.has(event.id)}
                    onFavorite={() => toggleFavorite(event.id)}
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="px-5 pb-8">
            <NearbyCard />
          </div>

          <section className="px-5">
            <h2 className="pb-3 text-[22px] font-bold tracking-[-0.02em]">
              Yaxınlaşan tədbirlər
            </h2>
            <div className="divide-y divide-white/[0.08]">
              {upcomingEvents.map((event) => (
                <UpcomingRow key={event.id} event={event} />
              ))}
            </div>
          </section>
        </div>

        <button
          type="button"
          aria-label="Yeni tədbir əlavə et"
          className="fixed right-[max(16px,calc((100vw-390px)/2+16px))] bottom-24 z-20 grid size-[52px] cursor-pointer place-items-center rounded-full bg-[#98ff00] shadow-[0_8px_10px_rgba(0,0,0,0.38)] transition hover:scale-105 hover:bg-[#b0ff3d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-[128px]"
        >
          <Image src="/figma/plus.svg" alt="" width={24} height={24} />
        </button>

        <nav
          aria-label="Əsas naviqasiya"
          className="fixed bottom-0 left-1/2 z-10 flex h-[84px] w-full max-w-[390px] -translate-x-1/2 border-t border-white/[0.08] bg-[rgba(18,18,24,0.86)] px-2 pt-3 pb-6 backdrop-blur-xl sm:bottom-8 sm:rounded-b-[32px]"
        >
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`flex h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 ${
                item.active ? "text-[#98ff00]" : "text-white/40"
              }`}
            >
              <Image src={item.icon} alt="" width={22} height={22} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
