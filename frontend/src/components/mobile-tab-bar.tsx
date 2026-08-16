import Image from "next/image";
import Link from "next/link";

type ActiveTab = "home" | "map" | "tickets" | "more";

const NAV_ITEMS = [
  {
    id: "home",
    href: "/",
    label: "Əsas səhifə",
    activeIcon: "/figma/home/home-active.svg",
    darkActiveIcon: "/figma/home-dark/home-active.svg",
    icon: "/figma/map/home.svg",
  },
  {
    id: "map",
    href: "/map",
    label: "Xəritə",
    activeIcon: "/figma/map/map-active.svg",
    darkActiveIcon: "/figma/map/map-active.svg",
    icon: "/figma/home/map.svg",
  },
  {
    id: "tickets",
    href: "/tickets",
    label: "Bilet",
    activeIcon: "/figma/tickets/ticket-active.svg",
    darkActiveIcon: "/figma/tickets/ticket-active.svg",
    icon: "/figma/home/ticket.svg",
  },
  {
    id: "more",
    href: "/more",
    label: "Daha çox",
    activeIcon: "/figma/more/category-active.svg",
    darkActiveIcon: "/figma/more/category-active.svg",
    icon: "/figma/home/category.svg",
  },
] as const;

export function MobileTabBar({
  active,
  placement = "viewport",
  theme = "light",
}: {
  active: ActiveTab;
  placement?: "viewport" | "container";
  theme?: "light" | "dark" | "adaptive";
}) {
  const isDark = theme === "dark";
  const isAdaptive = theme === "adaptive";

  return (
    <nav
      className={`${placement === "container" ? "absolute" : "fixed"} hara-tab-bar right-0 bottom-0 left-0 z-40 mx-auto flex w-full max-w-[402px] flex-col border-t backdrop-blur-[10px] ${
        isAdaptive
          ? "border-[var(--hara-tab-border)] bg-[var(--hara-tab-bg)]"
          : isDark
          ? "border-[#1a1a1a] bg-[#111118]/[0.72]"
          : "border-[#f2f2f2] bg-white/[0.72]"
      }`}
      aria-label="Əsas naviqasiya"
      data-theme={theme}
    >
      <div className="hara-tab-bar-items flex shrink-0 items-center px-2 pt-3 min-[360px]:px-4">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id;

          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[12px] leading-[18px] tracking-[-0.08px] min-[360px]:px-2 min-[360px]:text-[13px] min-[390px]:px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
            >
              {isAdaptive && isActive ? (
                <span
                  aria-hidden="true"
                  className="size-6 bg-[var(--hara-tab-active)]"
                  style={{
                    WebkitMaskImage: `url("${item.activeIcon}")`,
                    maskImage: `url("${item.activeIcon}")`,
                    WebkitMaskPosition: "center",
                    maskPosition: "center",
                    WebkitMaskRepeat: "no-repeat",
                    maskRepeat: "no-repeat",
                    WebkitMaskSize: "contain",
                    maskSize: "contain",
                  }}
                />
              ) : (
                <Image
                  src={isActive ? (isDark ? item.darkActiveIcon : item.activeIcon) : item.icon}
                  alt=""
                  width={24}
                  height={24}
                  className={isAdaptive ? "hara-theme-icon size-6 opacity-40" : "size-6"}
                />
              )}
              <span
                className={`whitespace-nowrap ${
                  isActive
                    ? isAdaptive
                      ? "text-[var(--hara-tab-active)]"
                      : isDark
                      ? "text-[#98ff00]"
                      : "text-[#565dd8]"
                    : isAdaptive
                      ? "text-[var(--hara-muted)]"
                      : isDark
                      ? "text-white/[0.38]"
                      : "text-black/[0.38]"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
