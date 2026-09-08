import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventDetailsStep } from "./event-wizard";

const profile = {
  id: 7, email: "aysel@example.com", display_name: "Aysel Məmmədova",
  first_name: "Aysel", last_name: "Məmmədova", phone_number: "",
  avatar_url: "", birth_date: null, interests: [], account_type: "user" as const,
  role: "user" as const, providers: [], is_email_verified: true,
};

beforeEach(() => window.localStorage.clear());

describe("event details draft", () => {
  it("starts empty and restores only the current account's draft after reopening", async () => {
    const view = render(<EventDetailsStep user={profile} />);
    const input = screen.getByLabelText("Tədbirin adı") as HTMLInputElement;
    expect(input.value).toBe("");
    await userEvent.type(input, "Caz gecəsi");
    await userEvent.selectOptions(screen.getByLabelText("Kateqoriya"), "musiqi");
    view.unmount();
    const other = render(<EventDetailsStep user={{ ...profile, id: 8 }} />);
    expect((screen.getByLabelText("Tədbirin adı") as HTMLInputElement).value).toBe("");
    other.unmount();
    render(<EventDetailsStep user={profile} />);
    expect((screen.getByLabelText("Tədbirin adı") as HTMLInputElement).value).toBe("Caz gecəsi");
    expect((screen.getByLabelText("Kateqoriya") as HTMLSelectElement).value).toBe("musiqi");
  });

  it("enforces the description limit and accepts only digits for minutes", async () => {
    const user = userEvent.setup();
    render(<EventDetailsStep user={profile} />);
    const description = screen.getByLabelText("Tədbir haqqında") as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: "a".repeat(999) } });
    await user.type(description, "bc");
    expect(description.value).toHaveLength(1000);
    expect(screen.getByText("1000 / 1000")).toBeTruthy();
    await user.type(screen.getByLabelText("Müddət (dəqiqə)"), "abc120!");
    expect((screen.getByLabelText("Müddət (dəqiqə)") as HTMLInputElement).value).toBe("120");
  });

  it("reports a storage failure without clearing the form or claiming success", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    render(<EventDetailsStep user={profile} />);
    await userEvent.type(screen.getByLabelText("Tədbirin adı"), "Mənim tədbirim");
    await userEvent.click(screen.getByRole("button", { name: "Qaralamanı bu brauzerdə saxla" }));
    expect(screen.getByRole("alert").textContent).toContain("saxlanılmadı");
    expect(screen.queryByText("Qaralama bu brauzerdə saxlanıldı.")).toBeNull();
    expect((screen.getByLabelText("Tədbirin adı") as HTMLInputElement).value).toBe("Mənim tədbirim");
  });

  it("validates required fields before handing a draft to the next stage", async () => {
    const onNext = vi.fn();
    render(<EventDetailsStep user={profile} onNext={onNext} />);
    const next = screen.getByRole("button", { name: "Növbəti addım" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Tədbirin adı"), "Caz gecəsi");
    await userEvent.selectOptions(screen.getByLabelText("Kateqoriya"), "musiqi");
    await userEvent.type(screen.getByLabelText("Tədbir haqqında"), "Canlı caz ifaları.");
    expect(next.disabled).toBe(false);
    await userEvent.click(next);
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ title: "Caz gecəsi", category: "musiqi", description: "Canlı caz ifaları." }));
  });
});
