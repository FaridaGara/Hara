import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./auth-provider";
import { MoreView } from "./more-view";
import { THEME_STORAGE_KEY, ThemeProvider } from "./theme-provider";

const back = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push }),
}));

describe("More view", () => {
  beforeEach(() => {
    back.mockClear();
    push.mockClear();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  const renderView = () =>
    render(
      <ThemeProvider>
        <AuthProvider>
          <MoreView />
        </AuthProvider>
      </ThemeProvider>,
    );

  it("Figma profil ekranını və aktiv Daha çox tabını göstərir", () => {
    const { container } = renderView();

    expect(screen.getByRole("heading", { name: "Profil" })).toBeTruthy();
    expect(screen.getByText("HARA istifadəçisi")).toBeTruthy();
    expect(screen.getByText("Şəxsi məlumatlar")).toBeTruthy();
    expect(screen.getByText("Bildirişlər")).toBeTruthy();
    expect(screen.getByText("Məxfilik siyasəti")).toBeTruthy();
    expect(screen.getByText("Çıxış")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Daha çox" }).getAttribute("href")).toBe("/more");
    expect(screen.getByRole("link", { name: "Daha çox" }).getAttribute("aria-current")).toBe("page");
    expect(container.innerHTML).not.toContain("9:41");
    expect(container.innerHTML).not.toContain("battery");
  });

  it("geri düyməsini və çıxışı işlək saxlayır", async () => {
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Geri qayıt" }));
    expect(back).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Çıxış" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("Görünüş panelində Sistem-i ilkin seçim edir və tema seçimini yadda saxlayır", async () => {
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Görünüş" }));
    expect(screen.getByRole("dialog", { name: "Görünüş" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Sistem/ }).getAttribute("aria-checked")).toBe("true");

    await userEvent.click(screen.getByRole("radio", { name: /Qaranlıq/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.queryByRole("dialog", { name: "Görünüş" })).toBeNull();
  });
});
