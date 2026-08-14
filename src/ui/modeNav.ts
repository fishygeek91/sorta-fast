/**
 * Shared header chrome for Race / Lens / Story mode switching (issue #64).
 */

/** Application surface: race replay, lens explorer, or story walkthrough. */
export type AppMode = "race" | "lens" | "story";

/**
 * Create a mode navigation button with active-state chrome when selected.
 *
 * @param label - Visible button text.
 * @param mode - Mode this button represents.
 * @param active - Currently active application mode.
 * @returns A mode nav button (never disabled).
 */
function createModeNavButton(label: string, mode: AppMode, active: AppMode): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = mode === active ? "mode-nav-btn mode-nav-btn-current" : "mode-nav-btn";
  button.textContent = label;
  if (mode === active) {
    button.setAttribute("aria-current", "page");
  }
  return button;
}

/**
 * Mount shared header chrome for switching between Race, Lens, and Story modes.
 *
 * Appends a chrome container to {@link parent} with the mode nav and a trailing
 * separator. Callers append extras (theme toggle, Skip, etc.) onto the returned
 * `chrome` after this helper returns. Does not attach click handlers — the active
 * mode button is expected to remain a no-op without a listener.
 *
 * @param parent - Element to append the chrome container into.
 * @param active - Currently active application mode.
 * @param options - Optional configuration (e.g. stable DOM id for the Story button).
 * @returns Chrome container and the three mode buttons.
 */
export function mountModeNav(
  parent: HTMLElement,
  active: AppMode,
  options?: { storyButtonId?: string },
): {
  chrome: HTMLDivElement;
  race: HTMLButtonElement;
  lens: HTMLButtonElement;
  story: HTMLButtonElement;
} {
  const chrome = document.createElement("div");
  chrome.className = "lens-header-chrome";

  const nav = document.createElement("nav");
  nav.className = "lens-mode-nav";
  nav.setAttribute("aria-label", "Mode");

  const race = createModeNavButton("Race", "race", active);
  const lens = createModeNavButton("Lens", "lens", active);
  const story = createModeNavButton("Story", "story", active);

  const storyButtonId = options?.storyButtonId;
  if (typeof storyButtonId === "string" && storyButtonId.length > 0) {
    story.id = storyButtonId;
  }

  nav.append(race, lens, story);

  const sep = document.createElement("span");
  sep.className = "lens-header-sep";
  sep.setAttribute("aria-hidden", "true");

  chrome.append(nav, sep);
  parent.append(chrome);

  return { chrome, race, lens, story };
}
