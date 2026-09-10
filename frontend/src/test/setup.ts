import "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { resetPendingLogoutsForTests } from "@/lib/api/auth";
import { resetApiClientForTests } from "@/lib/api/client";
import { resetSessionForTests } from "@/lib/auth/session";

afterEach(() => {
  cleanup();
  resetApiClientForTests();
  resetPendingLogoutsForTests();
  resetSessionForTests();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// jsdom has no native top layer; browser verification covers focus containment.
Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
