import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { eventFixture } from "@/test/fixtures";

import { HaraHome } from "./hara-home";

describe("Hara home", () => {
  it("public API event-lərini mövcud discovery dizaynında göstərir", async () => {
    const secondEvent = {
      ...eventFixture,
      id: "10000000-0000-4000-8000-000000000002",
      slug: "texnologiya-gecesi",
      title: "Texnologiya gecəsi",
      is_featured: false,
    };
    const loadEvents = vi.fn().mockResolvedValue([eventFixture, secondEvent]);
    render(<HaraHome loadEvents={loadEvents} />);

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
    render(<HaraHome loadEvents={loadEvents} />);
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
    render(<HaraHome loadEvents={loadEvents} />);
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
    render(<HaraHome loadEvents={loadEvents} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Əlaqə yoxdur");
    await userEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByText("Uyğun tədbir tapılmadı.")).toBeTruthy();
  });

  it("Figma tab bar-da əsas səhifəni aktiv göstərir", () => {
    const { container } = render(<HaraHome loadEvents={vi.fn().mockResolvedValue([])} />);
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
    const { container } = render(<HaraHome loadEvents={vi.fn().mockResolvedValue([])} />);
    const main = container.querySelector("main.hara-home");

    expect(main?.classList.contains("transition-colors")).toBe(true);
    expect(container.innerHTML).toContain("/figma/home/hara-logo-32.svg");
    expect(container.innerHTML).not.toContain("/figma/home/avatar.png");
  });

  it("telefonun sistem status bar-ını tətbiq UI-sində göstərmir", () => {
    const { container } = render(<HaraHome loadEvents={vi.fn().mockResolvedValue([])} />);

    expect(screen.queryByText("9:41")).toBeNull();
    expect(container.innerHTML).not.toContain("/figma/home/cellular.svg");
    expect(container.innerHTML).not.toContain("/figma/home/wifi.svg");
    expect(container.innerHTML).not.toContain("/figma/home/battery.svg");
  });
});
