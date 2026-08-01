import "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { resetApiClientForTests } from "@/lib/api/client";
import { resetSessionForTests } from "@/lib/auth/session";

afterEach(() => {
  cleanup();
  resetApiClientForTests();
  resetSessionForTests();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
