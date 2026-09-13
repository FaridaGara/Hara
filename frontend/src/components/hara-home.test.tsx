import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { eventFixture } from "@/test/fixtures";

import { FavoritesProvider } from "./favorites-provider";
import { HaraHome, NearbyMapCard } from "./hara-home";

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
    vi.setSystemTime(new Date("2026-08-10T08:00:00Z"));
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

    expect(screen.getAllByText("Tədbirlər yüklənir…").length).toBeGreaterThan(0);
    expect(await screen.findAllByText(eventFixture.title)).toHaveLength(2);
    expect(screen.getAllByText(secondEvent.title)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: eventFixture.title })[0].getAttribute("href"))
      .toBe(`/events/${eventFixture.slug}`);
    expect(loadEvents).toHaveBeenCalledWith(
      { ordering: "start_at", upcoming: true },
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
        { ordering: "start_at", upcoming: true, search: "caz" },
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
  it("opens real filters and filters using database category and price", async () => {
    const free = {...eventFixture, id: "free", slug: "free", title: "Ödənişsiz sərgi", min_price: "0.00", category: {id: 9, slug: "art", name: "Sərgi"}};
    renderHome(vi.fn().mockResolvedValue([eventFixture, free]));
    await screen.findAllByText(free.title);
    await userEvent.click(screen.getByRole("button", {name: "Filterləri aç"}));
    await userEvent.selectOptions(screen.getByLabelText("Bilet qiyməti"), "free");
    expect(screen.queryByText(eventFixture.title)).toBeNull();
    expect(screen.getAllByText(free.title)).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText("Kateqoriya"), "musiqi");
    expect(screen.getByText("Uyğun tədbir tapılmadı.")).toBeTruthy();
  });

  it("clearing search restores the unfiltered request and never shows 14 fake events", async () => {
    const load = vi.fn().mockResolvedValueOnce([eventFixture]).mockResolvedValueOnce([]).mockResolvedValue([eventFixture]);
    renderHome(load);
    await screen.findAllByText(eventFixture.title);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, {target: {value: "missing"}});
    await userEvent.click(screen.getByRole("button", {name: "Axtar"}));
    await screen.findByText("Uyğun tədbir tapılmadı.");
    expect(screen.queryByText(/14 tədbir/)).toBeNull();
    fireEvent.change(input, {target: {value: ""}});
    await screen.findAllByText(eventFixture.title);
    expect(load).toHaveBeenLastCalledWith({ordering: "start_at", upcoming: true}, expect.any(AbortSignal));
    expect(screen.getByRole("link", {name: "Xəritədə gör"}).getAttribute("href")).toBe("/map");
  });

  it("excludes past events and keeps later events out of the weekly section", async () => {
    const later = {...eventFixture, id: "later", title: "Next week", start_at: "2026-08-19T10:00:00Z", end_at: "2026-08-19T12:00:00Z"};
    const past = {...eventFixture, id: "past", title: "Old event", start_at: "2026-08-01T10:00:00Z", end_at: "2026-08-01T12:00:00Z"};
    renderHome(vi.fn().mockResolvedValue([eventFixture, later, past]));
    await screen.findAllByText(eventFixture.title);
    expect(screen.getAllByText(later.title)).toHaveLength(1);
    expect(screen.queryByText(past.title)).toBeNull();
  });

  it("only counts real nearby events after permission and shows permission failures", async () => {
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((_success, failure) => failure({code: 1}))
      .mockImplementationOnce((success) => success({coords: {latitude: 40.4, longitude: 49.8}}));
    Object.defineProperty(navigator, "geolocation", {configurable: true, value: {getCurrentPosition}});
    const near = {...eventFixture, venue: {...eventFixture.venue, latitude: 40.4, longitude: 49.8}};
    const far = {...eventFixture, id: "far", venue: {...eventFixture.venue, latitude: 41.4, longitude: 49.8}};
    const load = vi.fn().mockResolvedValue([near, far]);
    render(<NearbyMapCard loadEvents={load} />);
    expect(load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", {name: "Məkanımı seç"}));
    expect(screen.getByRole("alert").textContent).toContain("İcazəni yoxlayıb");
    expect(load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", {name: "Məkanımı seç"}));
    await screen.findByText("5 km radiusda 1 tədbir tapıldı");
    expect(load).toHaveBeenCalledWith({ordering: "start_at", upcoming: true}, expect.any(AbortSignal));
    expect(screen.getByRole("link", {name: "Xəritədə gör"}).getAttribute("href"))
      .toBe("/map?lat=40.4&lon=49.8&radius=5");
    Reflect.deleteProperty(navigator, "geolocation");
  });

});
