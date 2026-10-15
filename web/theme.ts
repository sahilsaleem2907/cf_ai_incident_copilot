export type Mode = "light" | "dark";

const QUERY = "(prefers-color-scheme: dark)";

type ModeSource = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

/**
 * Mirrors the OS colour scheme onto `<html data-mode>`, which Kumo and our `light-dark()` tokens read.
 * Returns a cleanup function that stops listening.
 */
export function initTheme(
  root: HTMLElement = document.documentElement,
  media: ModeSource = window.matchMedia(QUERY),
): () => void {
  const apply = (dark: boolean) => {
    root.dataset.mode = dark ? "dark" : "light";
  };
  const onChange = (e: MediaQueryListEvent) => apply(e.matches);

  apply(media.matches);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
