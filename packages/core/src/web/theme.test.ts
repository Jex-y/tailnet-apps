import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_THEME, parseTheme, THEME_BOOT_SCRIPT, THEMES } from "./theme";

const ROOT = join(import.meta.dir, "../../../..");

const declaredTokens = (block: string) => new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map(([, token]) => token));

/** A theme file's first block, before any `@media` override. */
const themeBlocks = async (id: string) => {
  const css = await Bun.file(join(import.meta.dir, "themes", `${id}.css`)).text();
  const mediaAt = css.indexOf("@media");
  return { base: mediaAt < 0 ? css : css.slice(0, mediaAt), overrides: mediaAt < 0 ? "" : css.slice(mediaAt) };
};

describe("themes", async () => {
  const reference = declaredTokens((await themeBlocks(DEFAULT_THEME)).base);

  test.each(THEMES.map((theme) => theme.id))("%s declares every token and a colour scheme", async (id) => {
    const { base } = await themeBlocks(id);
    expect(base).toContain(`[data-theme="${id}"]`);
    expect(base).toMatch(/color-scheme:/);
    expect([...declaredTokens(base)].sort()).toEqual([...reference].sort());
  });

  test.each(THEMES.map((theme) => theme.id))("%s overrides only tokens it declares", async (id) => {
    const { overrides } = await themeBlocks(id);
    expect([...declaredTokens(overrides)].filter((token) => !reference.has(token))).toEqual([]);
  });
});

test("every page applies the stored theme before first paint", async () => {
  const pages = (
    await Promise.all(
      ["apps/*/src/web/*.html", "packages/core/src/shell/*.html"].map((pattern) =>
        Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: ROOT, absolute: true })),
      ),
    )
  ).flat();
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    const html = await Bun.file(page).text();
    expect(html.indexOf(THEME_BOOT_SCRIPT), page).toBeGreaterThan(-1);
    expect(html.indexOf(THEME_BOOT_SCRIPT), page).toBeLessThan(html.indexOf('rel="stylesheet"'));
  }
});

test("an unknown stored theme falls back to the default", () => {
  expect(parseTheme("drafting")).toBe("drafting");
  expect(parseTheme(null)).toBe(DEFAULT_THEME);
  expect(parseTheme("vellum")).toBe(DEFAULT_THEME);
});
