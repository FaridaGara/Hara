import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventFixture } from "@/test/fixtures";

import { FavoritesProvider, useFavorites } from "./favorites-provider";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());
const authState = vi.hoisted((): {
  status: "loading" | "authenticated" | "anonymous";
  user: { id: number } | null;
} => ({ status: "authenticated", user: { id: 7 } }));

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

function FavoriteProbe() {
  const { error, favorites, isFavorite, loading, toggleFavorite } = useFavorites();
  return (
    <>
      <output>{loading ? "yüklənir" : favorites.map((event) => event.title).join(", ") || "boş"}</output>
      {error ? <p>{error}</p> : null}
      <button type="button" onClick={() => void toggleFavorite(eventFixture)}>
        {isFavorite(eventFixture.id) ? "Sil" : "Əlavə et"}
      </button>
    </>
  );
}

describe("Favorites provider", () => {
  beforeEach(() => {
    push.mockClear();
    apiMocks.list.mockReset().mockResolvedValue([]);
    apiMocks.add.mockReset().mockResolvedValue(eventFixture);
    apiMocks.remove.mockReset().mockResolvedValue(undefined);
    authState.status = "authenticated";
    authState.user = { id: 7 };
  });

  const renderProvider = () =>
    render(
      <FavoritesProvider>
        <FavoriteProbe />
      </FavoritesProvider>,
    );

  it("hesabın serverdə saxlanmış sevimlilərini yükləyir", async () => {
    apiMocks.list.mockResolvedValue([eventFixture]);
    renderProvider();

    expect(screen.getByText("yüklənir")).toBeTruthy();
    expect(await screen.findByText(eventFixture.title)).toBeTruthy();
    expect(apiMocks.list).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("tədbiri optimistik əlavə edib silir", async () => {
    renderProvider();
    await screen.findByText("boş");

    await userEvent.click(screen.getByRole("button", { name: "Əlavə et" }));
    expect(screen.getByText(eventFixture.title)).toBeTruthy();
    await waitFor(() => expect(apiMocks.add).toHaveBeenCalledWith(eventFixture.id));

    await userEvent.click(screen.getByRole("button", { name: "Sil" }));
    expect(screen.getByText("boş")).toBeTruthy();
    await waitFor(() => expect(apiMocks.remove).toHaveBeenCalledWith(eventFixture.id));
  });

  it("API xətasında optimistik dəyişikliyi geri qaytarır", async () => {
    apiMocks.add.mockRejectedValue(new Error("offline"));
    renderProvider();
    await screen.findByText("boş");

    await userEvent.click(screen.getByRole("button", { name: "Əlavə et" }));

    expect(await screen.findByText("boş")).toBeTruthy();
    expect(screen.getByText("Sevimliləri yeniləmək mümkün olmadı.")).toBeTruthy();
  });

  it("anonim istifadəçini login səhifəsinə yönləndirir", async () => {
    authState.status = "anonymous";
    authState.user = null;
    renderProvider();

    await userEvent.click(screen.getByRole("button", { name: "Əlavə et" }));

    expect(push).toHaveBeenCalledWith("/login?next=%2F");
    expect(apiMocks.add).not.toHaveBeenCalled();
  });
});
