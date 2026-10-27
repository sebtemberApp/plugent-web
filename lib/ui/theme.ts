/**
 * The theme the account menu pins: "light", "dark", or "system" (no attribute, so the
 * stylesheet follows `prefers-color-scheme`). Stored per browser only; it is a convenience.
 */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "plugent-theme";

/** Runs in <head> before paint, so a pinned theme never flashes the other one. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private windows can refuse storage; the theme still applies to this page.
  }
}
