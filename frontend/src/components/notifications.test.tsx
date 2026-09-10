import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { notificationsApi, type AppNotification } from "@/lib/api/notifications";
import { NotificationLink, Notifications } from "./notifications";

const auth = vi.hoisted(() => ({ user: { id: 7 } as { id: number } | null }));
vi.mock("./auth-provider", () => ({ useAuth: () => auth }));
const notification = (id: number, type: string): AppNotification => ({
  id, type, title: type === "refund_pending" ? "Geri ödəniş gözlənilir" : "Tədbir ləğv edildi",
  body: type === "refund_pending" ? "Məbləğ hələ qaytarılmayıb." : "Bilet etibarsızdır.",
  event_slug: "caz", event_title: "Caz gecəsi", event_status: "cancelled", cancellation_reason: "Məkan bağlanıb",
  organizer_name: "Organizer", read_at: null, created_at: "2026-09-10T10:00:00Z",
});
beforeEach(() => {
  auth.user = { id: 7 };
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ results: [notification(1, "refund_pending"), notification(2, "event_cancelled")], count: 2, next: null, previous: null, unread_count: 2 });
  vi.spyOn(notificationsApi, "count").mockResolvedValue({ unread_count: 2 });
  vi.spyOn(notificationsApi, "read").mockResolvedValue({ id: 1, read_at: "2026-09-10T11:00:00Z" });
});

it("shows cancellation and honest refund notices and links to tickets instead of a removed event", async () => {
  render(<Notifications />);
  const paid = await screen.findByRole("article", { name: "Geri ödəniş gözlənilir" });
  expect(within(paid).getByText("Məbləğ hələ qaytarılmayıb.")).toBeTruthy();
  expect(within(paid).getByText("Ləğv səbəbi: Məkan bağlanıb")).toBeTruthy();
  expect(within(paid).getByRole("link").getAttribute("href")).toBe("/tickets");
  expect(screen.getByRole("article", { name: "Tədbir ləğv edildi" })).toBeTruthy();
  await userEvent.click(within(paid).getByRole("button", { name: "Oxunmuş kimi işarələ" }));
  await screen.findByText("1 oxunmamış bildiriş");
  expect(notificationsApi.read).toHaveBeenCalledWith(1);
  expect(within(paid).getByText("Oxunub")).toBeTruthy();
});

it("keeps failed read receipts unread and allows retry", async () => {
  vi.mocked(notificationsApi.read).mockRejectedValueOnce(new Error("Şəbəkə xətası"));
  render(<Notifications />);
  const paid = await screen.findByRole("article", { name: "Geri ödəniş gözlənilir" });
  await userEvent.click(within(paid).getByRole("button"));
  await screen.findByText("Şəbəkə xətası");
  expect(screen.getByText("2 oxunmamış bildiriş")).toBeTruthy();
  expect(within(paid).getByText("Yeni")).toBeTruthy();
  await userEvent.click(within(paid).getByRole("button"));
  await screen.findByText("1 oxunmamış bildiriş");
});

it("hides a previous account's inbox while another account loads", async () => {
  const view = render(<Notifications />);
  await screen.findByRole("article", { name: "Geri ödəniş gözlənilir" });
  vi.mocked(notificationsApi.list).mockImplementation(() => new Promise(() => {}));
  auth.user = { id: 8 }; view.rerender(<Notifications />);
  expect(screen.queryByRole("article")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("yüklənir");
});

it("shows only a real unread count and discards stale account responses", async () => {
  let resolve!: (value: { unread_count: number }) => void;
  vi.mocked(notificationsApi.count).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<NotificationLink>Bell</NotificationLink>);
  expect(screen.queryByText("9+")).toBeNull();
  auth.user = null; view.rerender(<NotificationLink>Bell</NotificationLink>);
  await act(async () => resolve({ unread_count: 5 }));
  expect(screen.getByRole("link", { name: "Bildirişlər" }).getAttribute("href")).toBe("/notifications");
  expect(screen.queryByText("5")).toBeNull();
  auth.user = { id: 8 }; view.rerender(<NotificationLink>Bell</NotificationLink>);
  await waitFor(() => expect(screen.getByRole("link").getAttribute("aria-label")).toBe("Bildirişlər, 2 oxunmamış"));
});
