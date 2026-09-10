import { eventsApi } from "@/lib/api/events";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authApi } from "@/lib/api";
import { eventSubmissionsApi } from "@/lib/api/event-submissions";
import { setSession } from "@/lib/auth/session";

import { AuthProvider, useAuth } from "./auth-provider";
import { EventWizard } from "./event-wizard";
import { AppShell } from "./app-shell";
import { EMPTY_EVENT_DRAFT, readEventDraft, saveEventDraft } from "@/lib/event-draft";
import { emptySchedule } from "@/lib/event-schedule";
import { HomeAddButton } from "./home-add-button";
import { LoginForm } from "./login-form";
import { ProtectedRoute } from "./protected-route";
import { RegistrationForm } from "./registration-form";
import { VerificationForm } from "./verification-form";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(), push: vi.fn(), pathname: "/create-event",
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
}));

const profile = {
  id: 7, email: "aysel@example.com", display_name: "Aysel Məmmədova",
  first_name: "Aysel", last_name: "Məmmədova", phone_number: "+994507891234",
  avatar_url: "", birth_date: null, interests: [], account_type: "user" as const,
  role: "user" as const, providers: [], is_email_verified: true,
};
const session = { access: "test-access", refresh: "test-refresh", user: profile };

beforeEach(() => {
  vi.spyOn(eventsApi, "categories").mockResolvedValue([{ id: 1, name: "Musiqi", slug: "musiqi" }]);
  navigation.pathname = "/create-event";
  navigation.searchParams = new URLSearchParams();
  window.localStorage.clear();
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

// Exercise the same AuthProvider social completion used by the Google SDK callback.
function GoogleCompletion() {
  const { socialLogin } = useAuth();
  return <button onClick={() => void socialLogin("google", "test-google-credential")}>Complete Google sign-in</button>;
}

describe("event creation authentication entry", () => {
  it("keeps review edits isolated until applied and cancels without changing the draft", async () => {
    setSession(session);
    vi.spyOn(authApi, "me").mockResolvedValue(profile);
    vi.spyOn(eventSubmissionsApi, "eligibility").mockResolvedValue({ eligible: true, detail: "Hazırdır" });
    saveEventDraft(profile.id, { ...structuredClone(EMPTY_EVENT_DRAFT), title: "Caz", category: "musiqi", description: "Canlı musiqi", lastStep: 5 });
    render(<AuthProvider><ProtectedRoute><EventWizard /></ProtectedRoute></AuthProvider>);
    await screen.findByText("Hesab göndərməyə hazırdır");
    await userEvent.click(screen.getByRole("button", { name: /Əsas məlumatlar: Caz/ }));
    fill("Tədbirin adı", "Ləğv ediləcək ad");
    fireEvent.blur(screen.getByLabelText("Tədbirin adı"));
    expect(readEventDraft(profile.id).title).toBe("Caz");
    await userEvent.click(screen.getByRole("button", { name: "Əvvəlki mərhələyə qayıt" }));
    await screen.findByText("Hesab göndərməyə hazırdır");
    await userEvent.click(screen.getByRole("button", { name: /Əsas məlumatlar: Caz/ }));
    expect((screen.getByLabelText("Tədbirin adı") as HTMLInputElement).value).toBe("Caz");
    fill("Tədbirin adı", "Yeni caz gecəsi");
    await userEvent.click(screen.getByRole("button", { name: "Dəyişiklikləri tətbiq et" }));
    expect(await screen.findByRole("heading", { name: "Yoxla və yayımla" })).toBeTruthy();
    expect(readEventDraft(profile.id).title).toBe("Yeni caz gecəsi");
    expect(readEventDraft(profile.id).lastStep).toBe(5);
  });

  it("links the home action to a protected wizard and does not expose the form before sign-in", async () => {
    render(<AuthProvider><HomeAddButton /><ProtectedRoute><EventWizard /></ProtectedRoute></AuthProvider>);
    expect(screen.getByRole("link", { name: "Tədbir əlavə et" }).getAttribute("href")).toBe("/create-event");
    expect(screen.queryByLabelText("Tədbirin adı")).toBeNull();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?next=%2Fcreate-event"));
  });

  it("lets an existing ordinary user open the wizard without organizer privileges", async () => {
    setSession(session);
    vi.spyOn(authApi, "me").mockResolvedValue(profile);
    render(<AuthProvider><AppShell><ProtectedRoute><EventWizard /></ProtectedRoute></AppShell></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Əsas məlumatlar" })).toBeTruthy();
    expect(screen.getByText("Aysel Məmmədova adından")).toBeTruthy();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/create-event?step=1"));
    expect(screen.queryByRole("link", { name: "Hara ana səhifə" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Çıxış" })).toBeNull();
  });

  it("preserves schedule data through Back, duration edits, and reopening", async () => {
    setSession(session);
    vi.spyOn(authApi, "me").mockResolvedValue(profile);
    saveEventDraft(profile.id, { ...EMPTY_EVENT_DRAFT, title: "Caz", category: "musiqi", description: "Canlı musiqi", duration: "120", lastStep: 2,
      schedule: { ...emptySchedule(), startDate: "2099-10-28", startTime: "20:00", endDate: "2099-10-28", endTime: "22:00" } });
    navigation.searchParams = new URLSearchParams("step=2");
    const tree = () => <AuthProvider><AppShell><ProtectedRoute><EventWizard /></ProtectedRoute></AppShell></AuthProvider>;
    const view = render(tree());
    expect(await screen.findByRole("heading", { name: "Tarix və məkan" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Əvvəlki mərhələyə qayıt" }));
    expect(navigation.push).toHaveBeenCalledWith("/create-event?step=1");
    navigation.searchParams = new URLSearchParams("step=1");
    view.rerender(tree());
    expect((screen.getByLabelText("Tədbirin adı") as HTMLInputElement).value).toBe("Caz");
    fill("Müddət (dəqiqə)", "180");
    await userEvent.click(screen.getByRole("button", { name: "Növbəti addım" }));
    expect(navigation.push).toHaveBeenCalledWith("/create-event?step=2");
    navigation.searchParams = new URLSearchParams("step=2");
    view.rerender(tree());
    expect((screen.getByLabelText("Bitmə saatı") as HTMLInputElement).value).toBe("23:00");
    expect(readEventDraft(profile.id).lastStep).toBe(2);
    view.unmount();
    navigation.searchParams = new URLSearchParams();
    render(tree());
    expect(await screen.findByRole("heading", { name: "Tarix və məkan" })).toBeTruthy();
    expect(navigation.replace).toHaveBeenCalledWith("/create-event?step=2");
  });

  it("keeps an incomplete draft on step one even with a step two URL", async () => {
    setSession(session);
    vi.spyOn(authApi, "me").mockResolvedValue(profile);
    navigation.searchParams = new URLSearchParams("step=2");
    render(<AuthProvider><ProtectedRoute><EventWizard /></ProtectedRoute></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Əsas məlumatlar" })).toBeTruthy();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/create-event?step=1"));
  });

  it("opens step three only after event details and schedule are complete", async () => {
    setSession(session);
    vi.spyOn(authApi, "me").mockResolvedValue(profile);
    saveEventDraft(profile.id, {
      ...EMPTY_EVENT_DRAFT,
      title: "Caz", category: "musiqi", description: "Canlı musiqi", lastStep: 3,
      schedule: {
        ...emptySchedule(), startDate: "2099-10-28", startTime: "20:00", endDate: "2099-10-28", endTime: "22:00",
        venue: { id: "venue-1", source: "catalog", name: "Muğam Mərkəzi", address: "Bakı", city: "Bakı", latitude: 40.4, longitude: 49.8, entry_note: "", plan_id: "plan-1", capacity: 420 },
      },
    });
    navigation.searchParams = new URLSearchParams("step=3");
    render(<AuthProvider><ProtectedRoute><EventWizard /></ProtectedRoute></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Satış və biletlər" })).toBeTruthy();
    expect(screen.getByText("Addım 3 / 5")).toBeTruthy();
  });

  it("falls back from a premature step-three URL to step two", async () => {
    setSession(session);
    vi.spyOn(authApi, "me").mockResolvedValue(profile);
    saveEventDraft(profile.id, { ...EMPTY_EVENT_DRAFT, title: "Caz", category: "musiqi", description: "Canlı musiqi", lastStep: 3 });
    navigation.searchParams = new URLSearchParams("step=3");
    render(<AuthProvider><ProtectedRoute><EventWizard /></ProtectedRoute></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Tarix və məkan" })).toBeTruthy();
    expect(navigation.replace).toHaveBeenCalledWith("/create-event?step=2");
  });

  it("carries the wizard destination through email registration and verification", async () => {
    navigation.searchParams = new URLSearchParams("next=%2Fcreate-event");
    vi.spyOn(authApi, "register").mockResolvedValue({ detail: "Sent", email: profile.email, retry_after: 60 });
    vi.spyOn(authApi, "verifyEmail").mockResolvedValue(session);
    const view = render(<AuthProvider><LoginForm /></AuthProvider>);
    const registrationHref = screen.getByRole("link", { name: "Qeydiyyatdan keç" }).getAttribute("href")!;
    expect(registrationHref).toBe("/register?next=%2Fcreate-event");
    navigation.searchParams = new URL(registrationHref, "https://hara.test").searchParams;
    view.rerender(<AuthProvider><RegistrationForm /></AuthProvider>);
    expect(screen.getByRole("link", { name: "Daxil ol" }).getAttribute("href")).toBe("/login?next=%2Fcreate-event");
    fill("Ad", "Aysel"); fill("Soyad", "Məmmədova"); fill("E-poçt", profile.email);
    fill("Telefon nömrəsi", "507891234"); fill("Şifrə", "ExamplePass9"); fill("Şifrəni təkrarla", "ExamplePass9");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Qeydiyyatdan keç" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledOnce());
    const verificationUrl = new URL(navigation.push.mock.calls[0][0], "https://hara.test");
    expect(verificationUrl.pathname).toBe("/verify");
    expect(verificationUrl.searchParams.get("next")).toBe("/create-event");
    expect(verificationUrl.searchParams.get("email")).toBe(profile.email);
    navigation.searchParams = verificationUrl.searchParams;
    view.rerender(<AuthProvider><VerificationForm /></AuthProvider>);
    expect(screen.getByRole("link", { name: "Geri qayıt" }).getAttribute("href")).toBe("/register?next=%2Fcreate-event");
    for (let i = 1; i <= 4; i++) fill(`Kodun ${i}-ci rəqəmi`, String(i));
    await userEvent.click(screen.getByRole("button", { name: "Təsdiq et" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/create-event"));
    navigation.searchParams = new URLSearchParams();
    view.rerender(<AuthProvider><ProtectedRoute><EventWizard /></ProtectedRoute></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Əsas məlumatlar" })).toBeTruthy();
  });

  it("returns to the wizard after Google sign-in completes", async () => {
    navigation.searchParams = new URLSearchParams("next=%2Fcreate-event");
    const social = vi.spyOn(authApi, "socialLogin").mockResolvedValue(session);
    render(<AuthProvider><LoginForm /><GoogleCompletion /></AuthProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Complete Google sign-in" }));
    expect(social).toHaveBeenCalledWith("google", "test-google-credential", undefined, undefined);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/create-event"));
  });

  it("keeps failed verification on the same screen with its return destination", async () => {
    navigation.searchParams = new URLSearchParams("purpose=registration&email=aysel%40example.com&next=%2Fcreate-event");
    vi.spyOn(authApi, "verifyEmail").mockRejectedValue(new Error("invalid code"));
    render(<AuthProvider><VerificationForm /></AuthProvider>);
    for (let i = 1; i <= 4; i++) fill(`Kodun ${i}-ci rəqəmi`, String(i));
    await userEvent.click(screen.getByRole("button", { name: "Təsdiq et" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.searchParams.get("next")).toBe("/create-event");
  });

  it("rejects an external return destination after verification", async () => {
    navigation.searchParams = new URLSearchParams("purpose=registration&email=aysel%40example.com&next=%2F%2Fevil.example");
    vi.spyOn(authApi, "verifyEmail").mockResolvedValue(session);
    render(<AuthProvider><VerificationForm /></AuthProvider>);
    for (let i = 1; i <= 4; i++) fill(`Kodun ${i}-ci rəqəmi`, String(i));
    await userEvent.click(screen.getByRole("button", { name: "Təsdiq et" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  });
});
