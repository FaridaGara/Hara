import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from "./theme-provider";

function ThemeControls() {
  const { preference, setPreference } = useTheme();
  return (
    <>
      <span>{preference}</span>
      <button type="button" onClick={() => setPreference("system")}>
        Sistem
      </button>
    </>
  );
}

describe("Theme provider", () => {
  let dark = false;
  let systemListener: (() => void) | undefined;

  beforeEach(() => {
    dark = false;
    systemListener = undefined;
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: dark,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => {
        systemListener = listener;
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("yadda saxlanmış seçim olmadıqda sistem temasını izləyir", () => {
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>,
    );

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");

    dark = true;
    act(() => systemListener?.());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
