import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./auth-provider";
import { MoreView } from "./more-view";

const back = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push }),
}));

describe("More view", () => {
  beforeEach(() => {
    back.mockClear();
    push.mockClear();
  });

  it("Figma profil ekranını və aktiv Daha çox tabını göstərir", () => {
    const { container } = render(
      <AuthProvider>
        <MoreView />
      </AuthProvider>,
    );

    expect(screen.getByRole("heading", { name: "Profil" })).toBeTruthy();
    expect(screen.getByText("Monika Aliyeva")).toBeTruthy();
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
    render(
      <AuthProvider>
        <MoreView />
      </AuthProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Geri qayıt" }));
    expect(back).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Çıxış" }));
    expect(push).toHaveBeenCalledWith("/");
  });
});
