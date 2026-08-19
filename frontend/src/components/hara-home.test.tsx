import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { eventFixture } from "@/test/fixtures";

import { FavoritesProvider } from "./favorites-provider";
import { HaraHome } from "./hara-home";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());
const authState = vi.hoisted((): {
  status: "loading" | "authenticated" | "anonymous";
  user: { id: number; first_name: string; display_name: string } | null;
} => ({ status: "anonymous", user: null }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, favoritesApi: apiMocks };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push }),
}));

vi.mock("./auth-provider", () => ({
  useAuth: () => authState,
}));

describe("Hara home", () => {
  beforeEach(() => {
    push.mockClear();
    apiMocks.list.mockReset().mockResolvedValue([]);
    apiMocks.add.mockReset().mockResolvedValue(eventFixture);
    apiMocks.remove.mockReset().mockResolvedValue(undefined);
    authState.status = "anonymous";
    authState.user = null;
  });

  const renderHome = (loadEvents: Parameters<typeof HaraHome>[0]["loadEvents"]) =>
    render(
      <FavoritesProvider>
        <HaraHome loadEvents={loadEvents} />
      </FavoritesProvider>,
    );

  it("public API event-lərini mövcud discovery dizaynında göstərir", async () => {
    const secondEvent = {
      ...eventFixture,
      id: "10000000-0000-4000-8000-000000000002",
      slug: "texnologiya-gecesi",
      title: "Texnologiya gecəsi",
      is_featured: false,
    };
    const loadEvents = vi.fn().mockResolvedValue([eventFixture, secondEvent]);
    renderHome(loadEvents);

    expect(screen.getByText("Tədbirlər yüklənir…")).toBeTruthy();
    expect(await screen.findAllByText(eventFixture.title)).toHaveLength(2);
    expect(screen.getAllByText(secondEvent.title)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: eventFixture.title })[0].getAttribute("href"))
      .toBe(`/events/${eventFixture.slug}`);
    expect(loadEvents).toHaveBeenCalledWith(
      { ordering: "start_at" },
      expect.any(AbortSignal),
    );
  });

  it("Figma carousel boşluğunu və tarix formatını saxlayır", async () => {
    const loadEvents = vi.fn().mockResolvedValue([eventFixture]);
    renderHome(loadEvents);
    await screen.findAllByText(eventFixture.title);

    const carousel = screen
      .getByRole("region", { name: "Popular events" })
      .querySelector(".snap-x");

    expect(carousel).not.toBeNull();
    expect(carousel?.classList.contains("scroll-px-4")).toBe(true);
    expect(screen.getByRole("heading", { name: "Popular events" }).classList.contains("text-[30px]")).toBe(true);
    expect(screen.getByRole("heading", { name: "Popular events" }).classList.contains("min-[360px]:text-[34px]")).toBe(true);
    expect(screen.getAllByText("10 Avqust • 22:00").length).toBeGreaterThan(0);
  });

  it("search submit etdikdə API search filter-i ilə yenidən yükləyir", async () => {
    const loadEvents = vi.fn().mockResolvedValue([eventFixture]);
    renderHome(loadEvents);
    await screen.findAllByText(eventFixture.title);

    const input = screen.getByRole("searchbox", { name: "Tədbir axtar" });
    fireEvent.change(input, { target: { value: "caz" } });
    await userEvent.click(screen.getByRole("button", { name: "Axtar" }));

    await waitFor(() =>
      expect(loadEvents).toHaveBeenLastCalledWith(
        { ordering: "start_at", search: "caz" },
        expect.any(AbortSignal),
      ),
    );
  });

  it("empty və retry edilə bilən error state-ləri göstərir", async () => {
    const loadEvents = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ kind: "network", message: "Əlaqə yoxdur" }))
      .mockResolvedValueOnce([]);
    renderHome(loadEvents);

    expect((await screen.findByRole("alert")).textContent).toContain("Əlaqə yoxdur");
    await userEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByText("Uyğun tədbir tapılmadı.")).toBeTruthy();
  });

  it("Figma tab bar-da əsas səhifəni aktiv göstərir", () => {
    const { container } = renderHome(vi.fn().mockResolvedValue([]));
    const homeLink = screen.getByRole("link", { name: "Əsas səhifə" });
    const tabBar = screen.getByRole("navigation", { name: "Əsas naviqasiya" });

    expect(homeLink.getAttribute("aria-current")).toBe("page");
    expect(tabBar.getAttribute("data-theme")).toBe("adaptive");
    expect(container.innerHTML).toContain("/figma/home/home-active.svg");
    expect(container.innerHTML).toContain("bg-[var(--hara-tab-active)]");
    expect(homeLink.classList.contains("text-[12px]")).toBe(true);
    expect(homeLink.classList.contains("min-[360px]:text-[13px]")).toBe(true);
    expect(homeLink.querySelector("span:last-child")?.classList.contains("whitespace-nowrap")).toBe(true);
  });

  it("light və dark rejimdə eyni Figma HARA loqosunu saxlayır", () => {
    const { container } = renderHome(vi.fn().mockResolvedValue([]));
    const main = container.querySelector("main.hara-home");

    expect(main?.classList.contains("transition-colors")).toBe(true);
    expect(container.innerHTML).toContain("/figma/home/hara-logo-32.svg");
    expect(container.innerHTML).not.toContain("/figma/home/avatar.png");
  });

  it("telefonun sistem status bar-ını tətbiq UI-sində göstərmir", () => {
    const { container } = renderHome(vi.fn().mockResolvedValue([]));

    expect(screen.queryByText("9:41")).toBeNull();
    expect(container.innerHTML).not.toContain("/figma/home/cellular.svg");
    expect(container.innerHTML).not.toContain("/figma/home/wifi.svg");
    expect(container.innerHTML).not.toContain("/figma/home/battery.svg");
  });

  it("istifadəçi adını göstərir, anonim istifadəçiyə isə sadə salam verir", () => {
    const { rerender } = renderHome(vi.fn().mockResolvedValue([]));
    expect(screen.getByText("Salam!")).toBeTruthy();
    expect(screen.queryByText(/Monika/)).toBeNull();

    authState.status = "authenticated";
    authState.user = { id: 7, first_name: "Aysel", display_name: "Aysel Məmmədova" };
    rerender(
      <FavoritesProvider>
        <HaraHome loadEvents={vi.fn().mockResolvedValue([])} />
      </FavoritesProvider>,
    );
    expect(screen.getByText("Salam, Aysel 👋")).toBeTruthy();
  });

  it("ürəyə toxunanda tədbiri ümumi sevimlilər siyahısında saxlayır", async () => {
    authState.status = "authenticated";
    authState.user = { id: 7, first_name: "Aysel", display_name: "Aysel Məmmədova" };
    renderHome(vi.fn().mockResolvedValue([eventFixture]));
    await screen.findAllByText(eventFixture.title);

    await userEvent.click(screen.getAllByRole("button", { name: "Sevimlilərə əlavə et" })[0]);

    expect(screen.getAllByRole("button", { name: "Sevimlilərdən çıxar" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Sevimlilər" }).textContent).toBe("1");
    await waitFor(() => expect(apiMocks.add).toHaveBeenCalledWith(eventFixture.id));
  });
});
