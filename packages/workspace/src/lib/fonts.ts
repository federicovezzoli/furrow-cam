import { type Font, parseFont } from "@furrow/cam-core";

/**
 * The fonts the app ships (PRD-0010 T4, `src/fonts/README.md`), by the id a
 * text item stores, so a project opens with the same font everywhere. Their
 * files are bundled with the workspace: no font is fetched from the internet.
 */
export const FONTS = [
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    // The interface's font.
    kind: "mono",
    singleStroke: false,
    url: new URL("../fonts/JetBrainsMono-Regular.ttf", import.meta.url),
  },
  {
    id: "arvo",
    name: "Arvo",
    kind: "serif",
    singleStroke: false,
    url: new URL("../fonts/Arvo-Regular.ttf", import.meta.url),
  },
  {
    id: "pacifico",
    name: "Pacifico",
    kind: "script",
    singleStroke: false,
    url: new URL("../fonts/Pacifico-Regular.ttf", import.meta.url),
  },
  {
    id: "relief-singleline",
    name: "Relief SingleLine",
    kind: "singleStroke",
    singleStroke: true,
    url: new URL("../fonts/ReliefSingleLineCAD-Regular.ttf", import.meta.url),
  },
] as const;

export type BundledFont = (typeof FONTS)[number];

/** The font a new text item gets. */
export const DEFAULT_FONT: BundledFont["id"] = "jetbrains-mono";

const loaded = new Map<string, Promise<Font>>();

/**
 * Bundled font `id`, parsed once and kept, or `null` for an id the app
 * doesn't ship (an uploaded font's, #352). A failed load isn't kept, so the
 * next call tries again.
 */
export function loadFont(id: string): Promise<Font> | null {
  const font = FONTS.find((bundled) => bundled.id === id);
  if (!font) return null;
  let promise = loaded.get(id);
  if (!promise) {
    promise = fetch(font.url)
      .then((response) => {
        if (!response.ok) throw new Error(`Font ${id}: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => parseFont(bytes, font.singleStroke));
    promise.catch(() => loaded.delete(id));
    loaded.set(id, promise);
  }
  return promise;
}
