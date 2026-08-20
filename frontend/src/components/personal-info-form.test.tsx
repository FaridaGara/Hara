import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UserProfile } from "@/lib/api";

import { PersonalInfoForm } from "./personal-info-form";

const updateProfile = vi.fn();
const user: UserProfile = {
  id: 1,
  email: "sn.alyva@example.com",
  display_name: "Monika Aliyeva",
  first_name: "Monika",
  last_name: "Aliyeva",
  phone_number: "+99410 123 45 67",
  avatar_url: "",
  birth_date: "1996-11-12",
  interests: ["Musiqi", "Səyahət", "Festival", "Texnologiya", "Rəqs", "İncəsənət"],
  account_type: "user",
  role: "user",
  providers: ["google"],
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./auth-provider", () => ({
  useAuth: () => ({ user, updateProfile }),
}));

describe("Personal info", () => {
  it("Figma məlumat kartını real profil dəyərləri ilə göstərir", () => {
    const { container } = render(<PersonalInfoForm />);

    expect(screen.getByRole("heading", { name: "Şəxsi məlumatlar" })).toBeTruthy();
    expect(screen.getAllByText("Monika Aliyeva")).toHaveLength(2);
    expect(screen.getByText("sn.alyva@example.com")).toBeTruthy();
    expect(screen.getByText("+99410 123 45 67")).toBeTruthy();
    expect(screen.getByText("12 Noyabr, 1996")).toBeTruthy();
    expect(screen.getByText("♫ Musiqi")).toBeTruthy();
    expect(screen.getByText("🎨 İncəsənət")).toBeTruthy();
    expect(container.innerHTML).not.toContain("9:41");
    expect(container.innerHTML).not.toContain("battery");
  });

  it("redaktə rejimində telefon, doğum tarixi və maraqları backend payload-a daxil edir", async () => {
    updateProfile.mockResolvedValue(user);
    render(<PersonalInfoForm />);

    await userEvent.click(
      screen.getByRole("button", { name: "Profil məlumatlarını redaktə et" }),
    );
    await userEvent.clear(screen.getByLabelText("Telefon nömrəsi"));
    await userEvent.type(screen.getByLabelText("Telefon nömrəsi"), "+994501112233");
    await userEvent.click(screen.getByRole("button", { name: "♫ Musiqi" }));
    await userEvent.click(screen.getByRole("button", { name: "Yadda saxla" }));

    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Monika Aliyeva",
        phone_number: "+994501112233",
        birth_date: "1996-11-12",
        interests: ["Səyahət", "Festival", "Texnologiya", "Rəqs", "İncəsənət"],
      }),
    );
  });
});
