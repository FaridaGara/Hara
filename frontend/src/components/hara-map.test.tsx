import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { eventFixture } from "@/test/fixtures";

import { HaraMap } from "./hara-map";

const secondEvent = {
  ...eventFixture,
  id: "10000000-0000-4000-8000-000000000002",
  slug: "future-tech-baku",
  title: "Future Tech Baku",
  category: { id: 2, name: "Texnologiya", slug: "texnologiya" },
};

describe("Hara map", () => {
  it("xəritə route-u üçün tabbar və ilkin Figma vəziyyətini göstərir", async () => {
    const loadEvents = vi.fn().mockResolvedValue([eventFixture, secondEvent]);
    const { container } = render(<HaraMap loadEvents={loadEvents} />);

    expect(await screen.findByRole("button", { name: `${eventFixture.title} pinini seç 1` })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Xəritə" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Əsas səhifə" }).getAttribute("href")).toBe("/");
    expect(screen.getByTestId("map-canvas")).toBeTruthy();
    expect(screen.getByTestId("map-canvas").className).toContain("inset-0");
    expect(screen.getByTestId("map-canvas").className).not.toContain("top-[116px]");
    expect(screen.getByTestId("map-canvas").className).not.toContain("bottom-[92px]");
    const navigation = screen.getByRole("navigation", { name: "Əsas naviqasiya" });
    expect(navigation.className).toContain("hara-tab-bar");
    expect(navigation.className).not.toContain("h-[92px]");
    expect(navigation.querySelector(".h-\\[5px\\]")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Əsas naviqasiya" }).className).toContain(
      "absolute",
    );
    expect(container.querySelector('img[src="/figma/map/filter.svg"]')).toBeTruthy();
    expect(container.querySelector('img[src="/figma/map/setting.svg"]')).toBeTruthy();
    expect(screen.queryByText("9:41")).toBeNull();
    expect(container.innerHTML).not.toContain("cellular");
    expect(container.innerHTML).not.toContain("battery");
  });

  it("siyahı və xəritə görünüşləri arasında vəziyyəti itirmədən keçir", async () => {
    render(<HaraMap loadEvents={vi.fn().mockResolvedValue([eventFixture, secondEvent])} />);

    const mapCanvas = screen.getByTestId("map-canvas");
    const listView = screen.getByTestId("event-list-view");
    const listButton = await screen.findByRole("button", { name: "Siyahı görünüşünə keç" });

    expect(mapCanvas.getAttribute("aria-hidden")).toBe("false");
    expect(listView.getAttribute("aria-hidden")).toBe("true");
    expect(listView.className).toContain("translate-x-full");

    await userEvent.click(listButton);

    expect(mapCanvas.getAttribute("aria-hidden")).toBe("true");
    expect(mapCanvas.className).toContain("-translate-x-8");
    expect(listView.getAttribute("aria-hidden")).toBe("false");
    expect(listView.className).toContain("translate-x-0");
    expect(listView.textContent).toContain(eventFixture.title);
    expect(listView.textContent).toContain(secondEvent.title);
    expect(listView.textContent).toContain("20 AZN-dən");

    await userEvent.click(screen.getByRole("button", { name: "Xəritə görünüşünə keç" }));

    expect(mapCanvas.getAttribute("aria-hidden")).toBe("false");
    expect(mapCanvas.className).toContain("translate-x-0");
    expect(listView.getAttribute("aria-hidden")).toBe("true");
  });

  it("filteri xəritə və siyahı görünüşündə açır, X və kənar kliklə bağlayır", async () => {
    render(<HaraMap loadEvents={vi.fn().mockResolvedValue([eventFixture, secondEvent])} />);

    const filterButton = await screen.findByRole("button", { name: "Filterləri aç" });
    await userEvent.click(filterButton);

    expect(screen.getByRole("dialog", { name: "Filter" })).toBeTruthy();
    expect(screen.getByText("Qiymət aralığı")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tədbirləri göstər" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Filteri bağla" }));
    expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Siyahı görünüşünə keç" }));
    await userEvent.click(screen.getByRole("button", { name: "Filterləri aç" }));
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Filter pəncərəsinin xaricini bağla" }),
    );
    expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
  });

  it("qiymət filterini API tədbirlərinə tətbiq edir və sıfırlayır", async () => {
    render(<HaraMap loadEvents={vi.fn().mockResolvedValue([eventFixture, secondEvent])} />);

    await screen.findByRole("button", { name: "Filterləri aç" });
    await userEvent.click(screen.getByRole("button", { name: "Siyahı görünüşünə keç" }));
    await userEvent.click(screen.getByRole("button", { name: "Filterləri aç" }));
    await userEvent.click(screen.getByRole("button", { name: "50+ AZN" }));
    await userEvent.click(screen.getByRole("button", { name: "Tədbirləri göstər" }));

    expect(screen.getByText("Uyğun tədbir tapılmadı.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Filterləri aç" }));
    await userEvent.click(screen.getByRole("button", { name: "Filteri sıfırla" }));
    await userEvent.click(screen.getByRole("button", { name: "Tədbirləri göstər" }));

    expect(screen.queryByText("Uyğun tədbir tapılmadı.")).toBeNull();
    expect(screen.getByTestId("event-list-view").textContent).toContain(eventFixture.title);
  });

  it("pin seçiləndə API tədbirini Figma kartında açır", async () => {
    render(<HaraMap loadEvents={vi.fn().mockResolvedValue([eventFixture, secondEvent])} />);

    await userEvent.click(
      await screen.findByRole("button", { name: `${eventFixture.title} pinini seç 1` }),
    );

    const selectedRegion = screen.getByRole("region", { name: "Seçilmiş tədbir" });
    expect(selectedRegion.textContent).toContain(eventFixture.title);
    expect(selectedRegion.textContent).toContain("10 Avqust • 22:00");
    expect(selectedRegion.textContent).toContain(eventFixture.venue.name);
  });

  it("klaster seçiləndə sürüşən yaxın tədbirlər vəziyyətini açır", async () => {
    render(<HaraMap loadEvents={vi.fn().mockResolvedValue([eventFixture, secondEvent])} />);
    await screen.findByRole("button", { name: `${eventFixture.title} pinini seç 1` });

    await userEvent.click(screen.getByRole("button", { name: "Tədbir klasterini aç" }));

    const clusterRegion = screen.getByRole("region", { name: "Yaxın tədbirlər" });
    expect(clusterRegion.textContent).toContain(eventFixture.title);
    expect(clusterRegion.textContent).toContain(secondEvent.title);
    expect(screen.getByRole("button", { name: "Seçilmiş tədbir klasteri" })).toBeTruthy();
  });
});
