import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventFixture } from "@/test/fixtures";

import { FavoritesView } from "./favorites-view";

const back = vi.hoisted(() => vi.fn());
const refreshFavorites = vi.hoisted(() => vi.fn());
const favoritesState = vi.hoisted(() => ({
  favorites: [] as Array<typeof eventFixture>,
  loading: false,
  error: null as string | null,
  refreshFavorites,
  isFavorite: () => false,
  toggleFavorite: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back }),
}));

vi.mock("./favorites-provider", () => ({
  useFavorites: () => favoritesState,
}));

describe("Favorites view", () => {
  beforeEach(() => {
    back.mockClear();
    refreshFavorites.mockClear();
    favoritesState.favorites = [];
    favoritesState.loading = false;
    favoritesState.error = null;
  });

  it("serverdən gələn tədbirləri siyahı şəklində göstərir", () => {
    favoritesState.favorites = [eventFixture];
    render(<FavoritesView />);

    expect(screen.getByRole("heading", { name: eventFixture.title })).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("yüklənmə, xəta retry-si və boş vəziyyəti göstərir", async () => {
    favoritesState.loading = true;
    const { rerender } = render(<FavoritesView />);
    expect(screen.getByText("Sevimlilər yüklənir…")).toBeTruthy();

    favoritesState.loading = false;
    favoritesState.error = "API xətası";
    rerender(<FavoritesView />);
    await userEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(refreshFavorites).toHaveBeenCalledOnce();

    favoritesState.error = null;
    rerender(<FavoritesView />);
    expect(screen.getByText("Sevimli tədbir yoxdur")).toBeTruthy();
  });

  it("geri keçidi işlək saxlayır", async () => {
    render(<FavoritesView />);

    await userEvent.click(screen.getByRole("button", { name: "Geri qayıt" }));
    expect(back).toHaveBeenCalledOnce();
  });
});
