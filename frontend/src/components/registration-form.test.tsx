import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RegistrationForm } from "./registration-form";
import { clearRegistrationDraft, readRegistrationDraft } from "@/lib/registration-draft";
import { emailError, passwordErrors } from "@/lib/registration-validation";
import { phoneNumberError, phoneDigitsFromInput } from "@/lib/phone-number";
const register = vi.hoisted(() => vi.fn());
vi.mock("./auth-provider", () => ({ useAuth: () => ({ register, status: "anonymous" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({push: vi.fn(), replace: vi.fn()}), useSearchParams: () => new URLSearchParams() }));
beforeEach(() => { clearRegistrationDraft(); register.mockReset(); });
it("marks every empty field and blocks submission", () => {
  render(<RegistrationForm />);
  fireEvent.click(screen.getByRole("button", {name: "Qeydiyyatdan keç"}));
  for (const name of ["Ad", "Soyad", "E-poçt", "Telefon nömrəsi", "Şifrə", "Şifrəni təkrarla"]) {
    expect(screen.getByLabelText(name).getAttribute("aria-invalid")).toBe("true");
  }
  expect(register).not.toHaveBeenCalled();
});
it("updates password feedback immediately in Azerbaijani", () => {
  render(<RegistrationForm />);
  fireEvent.change(screen.getByLabelText("Şifrə"), {target: {value: "abc"}});
  expect(screen.getByText(/Şifrə ən azı 8 simvoldan/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Şifrə"), {target: {value: "Təhlükəsiz77"}});
  expect(screen.queryByText(/Şifrə ən azı 8 simvoldan/)).toBeNull();
});
it("retains all fields on return without persisting passwords to storage", () => {
  const view = render(<RegistrationForm />);
  for (const [name, value] of [["Ad", "Aysel"], ["Soyad", "Əliyeva"], ["E-poçt", "aysel@example.com"], ["Telefon nömrəsi", "507569083"], ["Şifrə", "Təhlükəsiz77"], ["Şifrəni təkrarla", "Təhlükəsiz77"]]) {
    fireEvent.change(screen.getByLabelText(name), {target: {value}});
  }
  fireEvent.click(screen.getByRole("checkbox"));
  view.unmount(); render(<RegistrationForm />);
  expect((screen.getByLabelText("Ad") as HTMLInputElement).value).toBe("Aysel");
  expect((screen.getByLabelText("Şifrə") as HTMLInputElement).value).toBe("Təhlükəsiz77");
  expect(readRegistrationDraft()?.accept_terms).toBe(true);
  expect(JSON.stringify({...sessionStorage, ...localStorage})).not.toContain("Təhlükəsiz77");
  clearRegistrationDraft(); expect(readRegistrationDraft()).toBeNull();
});
it("rejects malformed emails and accepts ordinary plus addresses", () => {
  for (const value of ["random", "a@", "a@b", "a..b@example.com", "a@-example.com", "a b@example.com"]) expect(emailError(value)).toBeTruthy();
  expect(emailError(" aysel+hara@example.com ")).toBeNull();
  expect(passwordErrors("abc")).toHaveLength(3);
});
it("accepts Azerbaijani mobile prefixes and rejects bogus numbers", () => {
  for (const prefix of ["10", "50", "51", "55", "60", "70", "77", "99"]) expect(phoneNumberError(`${prefix}7569083`)).toBeNull();
  for (const number of ["9941923235", "197569083", "123456789", "50756908"]) expect(phoneNumberError(number)).toBeTruthy();
  expect(phoneDigitsFromInput("+994 50 756 90 83")).toBe("507569083");
  expect(phoneDigitsFromInput("9941923235")).toBeNull();
});
