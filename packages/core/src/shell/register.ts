import { appShellPath, appSlugAt } from "./contract";
import { followSavedTheme } from "./saved-theme";

const append = (tag: "link" | "meta", attributes: Record<string, string>) => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.head.append(element);
};

export type ShellOptions = {
  /**
   * `shared` follows the theme the viewer chose for every app; `own` leaves the theme the page pins on its `<html>`,
   * for an app with a look of its own.
   */
  readonly theme?: "shared" | "own";
};

/**
 * Applies the viewer's theme unless the app keeps its own, makes the page installable as its app's own Home Screen app and registers the worker that
 * receives that app's push. The head tags are added here rather than in each index.html because Bun's HTML bundler
 * tries to resolve their hrefs as files.
 */
export const installApp = async (
  slug: string,
  { theme = "shared" }: ShellOptions = {},
): Promise<ServiceWorkerRegistration | null> => {
  if (theme === "shared") {
    followSavedTheme();
  }
  const shell = appShellPath(slug);
  append("link", { rel: "manifest", href: `${shell}/manifest.webmanifest` });
  append("link", { rel: "icon", type: "image/png", href: `${shell}/icons/icon-192.png` });
  append("link", { rel: "apple-touch-icon", href: `${shell}/icons/icon-180.png` });
  append("meta", { name: "mobile-web-app-capable", content: "yes" });
  return "serviceWorker" in navigator
    ? navigator.serviceWorker.register(`${shell}/sw.js`, { scope: `/${slug}/` })
    : null;
};

/** {@link installApp} for the app the page is served under. */
export const installShell = (options: ShellOptions = {}): Promise<ServiceWorkerRegistration | null> => {
  const slug = appSlugAt(location.pathname);
  if (slug === null) {
    throw new Error(`${location.pathname} is not an app's page`);
  }
  return installApp(slug, options);
};
