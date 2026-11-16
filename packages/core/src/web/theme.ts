export const THEMES = [
  { id: "glass", name: "Glass", description: "Frosted panes over soft colour, rounded and light." },
  { id: "drafting", name: "Drafting", description: "Graphite ink rules on plain grey, square corners, one accent." },
  { id: "blueprint", name: "Blueprint", description: "Ink rules on grid paper, square corners, a blueprint at night." },
  { id: "tracing", name: "Tracing", description: "Graphite on warm tracing paper, square corners, charcoal at night." },
  { id: "dot-grid", name: "Dot grid", description: "Warm tracing paper with a faint dot grid." },
  { id: "command", name: "Command", description: "Dark and dense, whatever your device is set to." },
  { id: "brutal", name: "Brutal", description: "Black ink edges, hard shadows and a loud accent on butter yellow." },
  { id: "editorial", name: "Editorial", description: "A printed page: newsprint, a serif throughout, hairline rules." },
  { id: "y2k", name: "Y2K", description: "Glossy pills and pixel labels under a periwinkle sky." },
  { id: "clay", name: "Clay", description: "Soft pastel putty, pillowy rounded cards you want to press." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "glass";

const STORAGE_KEY = "theme";

/**
 * Inlined in every page's `<head>` so a stored theme applies before first paint. A stored value no theme matches
 * leaves the default's tokens in force, since the default's are also declared on bare `:root`.
 */
export const THEME_BOOT_SCRIPT = `<script>try{document.documentElement.dataset.theme=localStorage.getItem("${STORAGE_KEY}")??"${DEFAULT_THEME}"}catch{}</script>`;

export const findTheme = (value: string | null): ThemeId | null =>
  THEMES.find((theme) => theme.id === value)?.id ?? null;

export const parseTheme = (value: string | null): ThemeId => findTheme(value) ?? DEFAULT_THEME;

/**
 * This browser's copy of the theme, which the boot script paints from before any request can answer. Storage can throw,
 * e.g. in a locked-down private window; the default theme is then used.
 */
export const storedTheme = (): ThemeId => {
  try {
    return parseTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
};

/** The browser chrome takes the page ground's colour, which depends on both the theme and the system scheme. */
const syncThemeColor = () => {
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]') ??
    document.head.appendChild(Object.assign(document.createElement("meta"), { name: "theme-color" }));
  meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
};

export const applyTheme = (theme: ThemeId) => {
  document.documentElement.dataset.theme = theme;
  syncThemeColor();
};

export const saveTheme = (theme: ThemeId) => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Still applied to this page, just not remembered.
  }
  applyTheme(theme);
};

/** Applies this browser's copy of the theme, and follows changes to it from other tabs and to the system colour scheme. */
export const followTheme = () => {
  applyTheme(storedTheme());
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      applyTheme(parseTheme(event.newValue));
    }
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
};
