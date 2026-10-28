import { type Font, fontName, parseFont, textPaths } from "@furrow/cam-core";
import { Sha256 } from "@furrow/document";
import { loadFont } from "../lib/fonts";
import type { TextWorkerRequest, TextWorkerResponse } from "../lib/text-layout";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<TextWorkerRequest>) => void;
  postMessage: (response: TextWorkerResponse) => void;
};

/**
 * Uploaded fonts sent lately, parsed, by hash, least recently used first
 * (ADR-0062). The worker outlives projects, so only a few are kept; one
 * dropped is asked for again (`missing`).
 */
const uploaded = new Map<string, Font>();
const KEPT_FONTS = 8;

function keep(sha256: string, font: Font) {
  uploaded.delete(sha256);
  uploaded.set(sha256, font);
  for (const oldest of uploaded.keys()) {
    if (uploaded.size <= KEPT_FONTS) break;
    uploaded.delete(oldest);
  }
}

/** The uploaded font `file`, parsed and kept as `sha256`, or `null` if it can't be read. */
function take(sha256: string, file: { bytes: ArrayBuffer; singleStroke: boolean }) {
  try {
    const font = parseFont(file.bytes, file.singleStroke);
    keep(sha256, font);
    return font;
  } catch {
    return null;
  }
}

const UNREADABLE = { code: "workspace.fontUnreadable" } as const;

/** Lays text items out (`layoutText`) and checks uploaded fonts (`inspectFont`). */
scope.onmessage = async ({ data }) => {
  const { id } = data;
  if (data.kind === "inspect") {
    const font = take(data.sha256, data.font);
    scope.postMessage(font ? { id, name: fontName(font) } : { id, error: UNREADABLE });
    return;
  }
  const { settings } = data;
  let font: Font | Promise<Font> | null;
  if (Sha256.safeParse(settings.font).success) {
    font = data.font ? take(settings.font, data.font) : (uploaded.get(settings.font) ?? null);
    if (data.font && !font) return scope.postMessage({ id, error: UNREADABLE });
    if (!font) return scope.postMessage({ id, missing: true });
    keep(settings.font, font);
  } else {
    font = loadFont(settings.font);
    if (!font) {
      return scope.postMessage({
        id,
        error: { code: "workspace.unknownFont", values: { font: settings.font } },
      });
    }
  }
  try {
    scope.postMessage({ id, paths: textPaths(await font, settings) });
  } catch (error) {
    console.error(error);
    scope.postMessage({ id, error: { code: "workspace.textLayoutFailed" } });
  }
};
