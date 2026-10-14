import { describe, expect, it } from "vitest";
import { initTheme } from "../../web/theme";

function fakeMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  return {
    matches,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    fire: (dark: boolean) => listeners.forEach((fn) => fn({ matches: dark } as MediaQueryListEvent)),
    listeners,
  };
}

function fakeRoot() {
  return { dataset: {} as DOMStringMap } as HTMLElement;
}

describe("initTheme", () => {
  it("sets data-mode from the current preference", () => {
    const root = fakeRoot();
    initTheme(root, fakeMedia(true) as unknown as MediaQueryList);
    expect(root.dataset.mode).toBe("dark");
  });

  it("follows preference changes until cleaned up", () => {
    const root = fakeRoot();
    const media = fakeMedia(false);
    const stop = initTheme(root, media as unknown as MediaQueryList);
    expect(root.dataset.mode).toBe("light");

    media.fire(true);
    expect(root.dataset.mode).toBe("dark");

    stop();
    expect(media.listeners.size).toBe(0);
    media.fire(false);
    expect(root.dataset.mode).toBe("dark");
  });
});
