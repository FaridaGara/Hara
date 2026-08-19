"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";

import { EventRow } from "./hara-home";
import { useFavorites } from "./favorites-provider";

export function FavoritesView() {
  const router = useRouter();
  const { error, favorites, loading, refreshFavorites } = useFavorites();

  return (
    <main className="hara-home relative mx-auto min-h-dvh w-full max-w-[402px] overflow-x-hidden bg-[var(--hara-page)] pb-[calc(24px+var(--hara-safe-bottom))] transition-colors sm:my-6 sm:min-h-[calc(100dvh-48px)] sm:rounded-[32px]">
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between bg-[var(--hara-page)] px-4 transition-colors">
        <button
          type="button"
          aria-label="Geri qayıt"
          onClick={() => router.back()}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--hara-surface)] transition active:scale-95"
        >
          <Image src="/figma/more/back.svg" alt="" width={24} height={24} className="hara-theme-icon size-6" />
        </button>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-base leading-[21px] font-semibold tracking-[-0.31px] text-[var(--hara-primary)]">
          Sevimlilər
        </h1>
        <span className="grid min-w-10 place-items-center rounded-full bg-[var(--hara-surface)] px-2 py-1 text-xs font-semibold text-[var(--hara-primary)]">
          {favorites.length}
        </span>
      </header>

      {loading ? (
        <section className="mx-4 mt-3 h-[280px] animate-pulse rounded-3xl bg-[var(--hara-surface)]">
          <span className="sr-only">Sevimlilər yüklənir…</span>
        </section>
      ) : error ? (
        <section className="mx-4 mt-3 grid min-h-[280px] place-items-center rounded-3xl bg-[var(--hara-surface)] px-8 text-center" role="alert">
          <div>
            <p className="text-sm leading-5 text-[var(--hara-secondary)]">{error}</p>
            <button
              type="button"
              onClick={refreshFavorites}
              className="mt-4 min-h-10 rounded-full bg-[var(--hara-retry-bg)] px-4 text-sm font-bold text-[var(--hara-retry-text)]"
            >
              Yenidən cəhd et
            </button>
          </div>
        </section>
      ) : favorites.length ? (
        <section className="flex flex-col gap-3 px-4 py-3" aria-label="Sevimli tədbirlər">
          {favorites.map((event, index) => (
            <EventRow key={event.id} event={event} index={index} />
          ))}
        </section>
      ) : (
        <section className="mx-4 mt-3 grid min-h-[280px] place-items-center rounded-3xl bg-[var(--hara-surface)] px-8 text-center">
          <div>
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--hara-page)] text-2xl" aria-hidden="true">
              ♡
            </div>
            <h2 className="mt-4 text-lg font-semibold text-[var(--hara-primary)]">Sevimli tədbir yoxdur</h2>
            <p className="mt-2 text-sm leading-5 text-[var(--hara-muted)]">
              Bəyəndiyin tədbirlərdə ürək işarəsinə toxun, burada siyahı şəklində görünsün.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
