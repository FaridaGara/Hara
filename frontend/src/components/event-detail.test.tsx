import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { eventFixture } from "@/test/fixtures";

import { EventDetail } from "./event-detail";

describe("event detail", () => {
  it("faktiki event sahələrini təhlükəsiz mətn kimi göstərir", async () => {
    const event = {
      ...eventFixture,
      description: "<script>unsafe()</script>\nCanlı proqram",
    };
    const { container } = render(
      <EventDetail slug={event.slug} loadEvent={vi.fn().mockResolvedValue(event)} />,
    );

    expect(await screen.findByRole("heading", { name: event.title })).toBeTruthy();
    expect(screen.getByText(event.venue.address)).toBeTruthy();
    expect(screen.getByText(/<script>unsafe/)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/Public event API-si ticket type/)).toBeTruthy();
  });

  it("404 üçün not-found state göstərir", async () => {
    render(
      <EventDetail
        slug="yoxdur"
        loadEvent={vi.fn().mockRejectedValue(
          new ApiError({ kind: "http", status: 404, message: "Tapılmadı" }),
        )}
      />,
    );

    expect(await screen.findByText("Tədbir tapılmadı")).toBeTruthy();
  });
});
