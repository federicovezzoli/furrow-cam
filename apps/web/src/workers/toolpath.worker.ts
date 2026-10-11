import { generateToolpath, toolpathLines, toolpathLinesBuffers } from "@furrow/cam-core";
import type { ToolpathRequest, ToolpathResponse } from "@/stores/toolpath-scheduler";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<ToolpathRequest>) => void;
  postMessage: (response: ToolpathResponse, transfer?: Transferable[]) => void;
};

// Computes toolpaths off the main thread (ADR-0004), one request at a time.
scope.onmessage = ({ data }) => {
  const { operationId, inputHash } = data;
  try {
    const result = generateToolpath(data.input);
    const lines = toolpathLines(result);
    // The viewport's typed arrays move to the main thread instead of being copied.
    scope.postMessage({ operationId, inputHash, result, lines }, toolpathLinesBuffers(lines));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ operationId, inputHash, error: message });
  }
};
