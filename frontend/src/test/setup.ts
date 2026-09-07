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
