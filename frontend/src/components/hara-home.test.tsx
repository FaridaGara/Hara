import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HaraHome } from "./hara-home";

describe("Hara home", () => {
  it("Figma ekranının əsas discovery bölmələrini göstərir", () => {
    render(<HaraHome />);

    expect(screen.getByText("Salam, Monika 👋")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Bu həftə nə var?" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Yaxınlaşan tədbirlər" })).toBeTruthy();
    expect(screen.getByText("Baku Jazz Festival 2025")).toBeTruthy();
    expect(screen.getByText("Flamenko Axşamı")).toBeTruthy();
  });

  it("search və filter controls əlçatandır", () => {
    render(<HaraHome />);

    const input = screen.getByRole("searchbox", { name: "Tədbir axtar" });
    fireEvent.change(input, { target: { value: "caz" } });
    expect(input.getAttribute("value")).toBe("caz");

    const chip = screen.getByRole("button", { name: "Pulsuz" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});
