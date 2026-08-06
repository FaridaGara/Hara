"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "./auth-provider";

const links = [
  { href: "/", label: "Kəşf et" },
  { href: "/tickets", label: "Biletlərim" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, logout } = useAuth();
  const usesDiscoveryShell = pathname === "/" || pathname === "/map";

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <div className={usesDiscoveryShell ? "min-h-screen bg-[#f2f2f2] sm:py-px" : "min-h-screen bg-[#09090e] text-white"}>
      {!usesDiscoveryShell ? <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#111118]/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-2 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
            aria-label="Hara ana səhifə"
          >
            <Image
              src="/figma/hara-logo.svg"
              alt=""
              width={36}
              height={36}
              priority
            />
            <span className="hidden text-xl font-bold tracking-tight min-[390px]:inline">
              Hara
            </span>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Əsas naviqasiya">
            {links.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`grid min-h-11 place-items-center rounded-xl px-2 text-xs font-semibold transition min-[390px]:px-3 min-[390px]:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00] ${
                    active
                      ? "bg-white/10 text-[#98ff00]"
                      : "text-white/65 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}

            {status === "authenticated" ? (
              <button
                type="button"
                onClick={handleLogout}
                className="min-h-11 rounded-xl px-2 text-xs font-semibold text-white/65 transition min-[390px]:px-3 min-[390px]:text-sm hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#98ff00]"
              >
                Çıxış
              </button>
            ) : status === "anonymous" ? (
              <Link
                href="/login"
                className="grid min-h-11 place-items-center rounded-xl bg-[#98ff00] px-2 text-xs font-bold text-[#18181a] transition min-[390px]:px-3 min-[390px]:text-sm hover:bg-[#b0ff3d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Giriş
              </Link>
            ) : (
              <span className="h-11 w-16 animate-pulse rounded-xl bg-white/5" />
            )}
          </nav>
        </div>
      </header> : null}
      {children}
    </div>
  );
}
