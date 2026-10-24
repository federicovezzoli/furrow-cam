import { type Font, parseFont, textPaths } from "@furrow/cam-core";
import { loadFont } from "../lib/fonts";
import type { TextLayoutRequest, TextLayoutResponse } from "../lib/text-layout";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<TextLayoutRequest>) => void;
  postMessage: (response: TextLayoutResponse) => void;
};

/** The project's uploaded fonts this worker was sent, parsed, by hash (ADR-0062). */
const uploaded = new Map<string, Font>();

/** Lays text items out (`layoutText`), loading each bundled font once and keeping uploaded ones. */
scope.onmessage = async ({ data: { id, settings, font: file } }) => {
  if (file) {
    try {
      uploaded.set(settings.font, parseFont(file.bytes, file.singleStroke));
    } catch {
      scope.postMessage({ id, error: { code: "workspace.fontUnreadable" } });
      return;
    }
  }
  const font = uploaded.get(settings.font) ?? loadFont(settings.font);
  if (!font) {
    scope.postMessage({
      id,
      error: { code: "workspace.unknownFont", values: { font: settings.font } },
    });
    return;
  }
  try {
    scope.postMessage({ id, paths: textPaths(await font, settings) });
  } catch (error) {
    console.error(error);
    scope.postMessage({ id, error: { code: "workspace.textLayoutFailed" } });
  }
};
