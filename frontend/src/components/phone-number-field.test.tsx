import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { phoneNumberError } from "@/lib/phone-number";

import { PhoneNumberField } from "./phone-number-field";

function Example() {
  const [digits, setDigits] = useState("");
  return <PhoneNumberField value={digits} onChange={setDigits} />;
}

function phoneInput() {
  return screen.getByRole("textbox", { name: "Telefon nömrəsi" }) as HTMLInputElement;
}

describe("registration phone input", () => {
  it("keeps +994 fixed and accepts only nine digits in grouped format", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.type(phoneInput(), "ab5078912345678xyz");
    expect(phoneInput().value).toBe("50 789 12 34");
    expect(screen.getByText("+994")).toBeTruthy();
    await user.clear(phoneInput());
    expect(phoneInput().value).toBe("");
    expect(screen.getByText("+994")).toBeTruthy();
  });

  it("pastes a complete number without duplicating the country code", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(phoneInput());
    await user.paste("+994 50 789 12 34");
    expect(phoneInput().value).toBe("50 789 12 34");
    await user.clear(phoneInput());
    await user.paste("994507891234");
    expect(phoneInput().value).toBe("50 789 12 34");
    await user.clear(phoneInput());
    await user.paste("+1 202 555 0100");
    expect(phoneInput().value).toBe("");
  });

  it("supports replacing selected digits and deleting across separators", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.type(phoneInput(), "507891234");
    phoneInput().setSelectionRange(3, 6);
    await user.paste("246");
    expect(phoneInput().value).toBe("50 246 12 34");
    phoneInput().setSelectionRange(3, 3);
    await user.keyboard("{Backspace}");
    expect(phoneInput().value).toBe("52 461 23 4");
    expect(phoneInput().selectionStart).toBe(1);
    phoneInput().setSelectionRange(2, 2);
    await user.keyboard("{Delete}");
    expect(phoneInput().value).toBe("52 612 34");
  });

  it("explains incomplete and repeated numbers", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.type(phoneInput(), "50");
    fireEvent.blur(phoneInput());
    expect(screen.getByRole("alert").textContent).toContain("9 rəqəm");
    await user.clear(phoneInput());
    await user.type(phoneInput(), "555555555");
    expect(screen.getByRole("alert").textContent).toContain("eyni və ya ardıcıl");
    expect(phoneInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("rejects complete ascending, descending and repeating patterns only", () => {
    for (const digits of ["111111111", "000000000", "123456789", "987654321", "789012345", "321098765"]) {
      expect(phoneNumberError(digits)).toContain("eyni və ya ardıcıl");
    }
    for (const digits of ["507891234", "501112233", "701258394"]) {
      expect(phoneNumberError(digits)).toBeNull();
    }
    expect(phoneNumberError("50789123")).toContain("9 rəqəm");
    expect(phoneNumberError("5078912345")).toContain("9 rəqəm");
    expect(phoneNumberError("50789abcd")).toContain("9 rəqəm");
  });
});
