import { type Font, parseFont } from "@furrow/cam-core";
import { FONTS } from "./font-files";

export { FONTS };

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
      .then((bytes) => parseFont(bytes, font.kind === "singleStroke"));
    promise.catch(() => loaded.delete(id));
    loaded.set(id, promise);
  }
  return promise;
}
