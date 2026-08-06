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

describe("Hara map pin selection", () => {
  it("ilkin vəziyyətdə tədbir seçmir və hər dəfə yalnız son kliklənən pini aktiv saxlayır", async () => {
    render(<HaraMap loadEvents={vi.fn().mockResolvedValue([eventFixture, secondEvent])} />);

    const firstPin = await screen.findByRole("button", {
      name: `${eventFixture.title} pinini seç 1`,
    });
    const secondPin = screen.getByRole("button", {
      name: `${secondEvent.title} pinini seç 2`,
    });

    expect(screen.queryByRole("region", { name: "Seçilmiş tədbir" })).toBeNull();
    expect(firstPin.className).toContain("bg-[#4e55c5]");
    expect(secondPin.className).toContain("bg-[#4e55c5]");

    await userEvent.click(firstPin);
    expect(firstPin.className).toContain("bg-[#6cb500]");
    expect(secondPin.className).toContain("bg-[#4e55c5]");
    expect(screen.getByRole("region", { name: "Seçilmiş tədbir" }).textContent).toContain(
      eventFixture.title,
    );

    await userEvent.click(secondPin);
    expect(firstPin.className).toContain("bg-[#4e55c5]");
    expect(secondPin.className).toContain("bg-[#6cb500]");
    const selectedRegion = screen.getByRole("region", { name: "Seçilmiş tədbir" });
    expect(selectedRegion.textContent).toContain(secondEvent.title);
    expect(selectedRegion.textContent).not.toContain(eventFixture.title);
  });
});
