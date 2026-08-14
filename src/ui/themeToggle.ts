/**
 * Theme persistence and header toggle for dark/light chrome (issue #17).
 */

import { parseStoredTheme, THEME_STORAGE_KEY, type ThemeMode } from "../render/theme.ts";

/**
 * Read the user's persisted theme preference from `localStorage`.
 *
 * @returns Stored {@link ThemeMode}, or `"dark"` when unset, invalid, or storage is unavailable.
 */
export function readStoredTheme(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return parseStoredTheme(raw);
  } catch {
    return "dark";
  }
}

/**
 * Apply a theme to the document root and persist it when storage allows.
 *
 * @param mode - Chrome palette to activate.
 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // private mode / quota — DOM theme still applies
  }
}

/**
 * Restore the persisted theme (or default) on boot before UI mounts.
 *
 * @returns The theme mode that was applied.
 */
export function applyStoredTheme(): ThemeMode {
  const mode = readStoredTheme();
  applyTheme(mode);
  return mode;
}

/**
 * Mount a header button that flips between dark and light chrome.
 *
 * Does not call `onChange` during mount — callers apply canvas chrome when constructing
 * renderers. Does not call {@link applyStoredTheme}; `main.ts` applies storage first.
 *
 * @param parent - Container to append the toggle into (e.g. header chrome).
 * @param onChange - Invoked after a user click with the new active mode.
 * @returns The mounted toggle button.
 */
export function mountThemeToggle(
  parent: HTMLElement,
  onChange: (mode: ThemeMode) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";

  let currentMode = readStoredTheme();

  /**
   * Sync visible label and ARIA to the active mode (target mode on the button face).
   *
   * @param mode - Active chrome palette.
   */
  function syncLabel(mode: ThemeMode): void {
    const target: ThemeMode = mode === "dark" ? "light" : "dark";
    button.textContent = target === "light" ? "Light" : "Dark";
    button.setAttribute("aria-pressed", mode === "light" ? "true" : "false");
    button.setAttribute(
      "aria-label",
      target === "light" ? "Switch to light theme" : "Switch to dark theme",
    );
  }

  syncLabel(currentMode);

  button.addEventListener("click", () => {
    const next: ThemeMode = currentMode === "dark" ? "light" : "dark";
    currentMode = next;
    applyTheme(next);
    syncLabel(next);
    onChange(next);
  });

  parent.append(button);
  return button;
}
