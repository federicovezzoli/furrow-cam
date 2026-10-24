import { textPaths } from "@furrow/cam-core";
import { loadFont } from "../lib/fonts";
import type { TextLayoutRequest, TextLayoutResponse } from "../lib/text-layout";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<TextLayoutRequest>) => void;
  postMessage: (response: TextLayoutResponse) => void;
};

/** Lays text items out (`layoutText`), loading each bundled font once. */
scope.onmessage = async ({ data: { id, settings } }) => {
  const font = loadFont(settings.font);
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
