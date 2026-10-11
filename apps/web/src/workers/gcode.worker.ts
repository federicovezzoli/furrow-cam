import type { ProjectDocument } from "@furrow/document";
import { exportGcode, type GcodeExport } from "@furrow/post";

export type GcodeRequest = { document: ProjectDocument; name: string };
export type GcodeResponse = GcodeExport | { error: string };

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<GcodeRequest>) => void;
  postMessage: (response: GcodeResponse) => void;
};

// Computes every toolpath and posts the program off the main thread (ADR-0004).
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage(exportGcode(data.document, data.name));
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
