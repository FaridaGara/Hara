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
    expect(screen.getByText(secondEvent.title)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: eventFixture.title })[0].getAttribute("href"))
      .toBe(`/events/${eventFixture.slug}`);
    expect(loadEvents).toHaveBeenCalledWith(
      { ordering: "start_at" },
      expect.any(AbortSignal),
    );
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

  it("filter chip-in vizual seçimini qoruyur", () => {
    render(<HaraHome loadEvents={vi.fn().mockResolvedValue([])} />);
    const chip = screen.getByRole("button", { name: "Pulsuz" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});
