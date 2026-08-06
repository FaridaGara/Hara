import Image from "next/image";
import Link from "next/link";

type ActiveTab = "home" | "map" | "tickets" | "more";

const NAV_ITEMS = [
  {
    id: "home",
    href: "/",
    label: "Əsas səhifə",
    activeIcon: "/figma/home/home-active.svg",
    icon: "/figma/map/home.svg",
  },
  {
    id: "map",
    href: "/map",
    label: "Xəritə",
    activeIcon: "/figma/map/map-active.svg",
    icon: "/figma/home/map.svg",
  },
  {
    id: "tickets",
    href: "/tickets",
    label: "Bilet",
    activeIcon: "/figma/map/ticket.svg",
    icon: "/figma/home/ticket.svg",
  },
  {
    id: "more",
    href: "#more",
    label: "Daha çox",
    activeIcon: "/figma/map/category.svg",
    icon: "/figma/home/category.svg",
  },
] as const;

export function MobileTabBar({
  active,
  placement = "viewport",
}: {
  active: ActiveTab;
  placement?: "viewport" | "container";
}) {
  return (
    <nav
      className={`${placement === "container" ? "absolute" : "fixed"} right-0 bottom-0 left-0 z-40 mx-auto flex h-[92px] w-full max-w-[402px] flex-col border-t border-[#f2f2f2] bg-white/[0.72] backdrop-blur-[10px]`}
      aria-label="Əsas naviqasiya"
    >
      <div className="flex h-[58px] items-center px-4 pt-3">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id;

          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-3 text-[13px] leading-[18px] tracking-[-0.08px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#565dd8]"
            >
              <Image
                src={isActive ? item.activeIcon : item.icon}
                alt=""
                width={24}
                height={24}
                className="size-6"
              />
              <span className={isActive ? "text-[#565dd8]" : "text-black/[0.38]"}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="relative h-[34px]">
        <div
          aria-hidden="true"
          className="absolute bottom-2 left-1/2 h-[5px] w-36 -translate-x-1/2 rounded-full bg-[#1a1a1a]"
        />
      </div>
    </nav>
  );
}
