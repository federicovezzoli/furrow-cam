import { generateToolpath, toolpathLines, toolpathLinesBuffers } from "@furrow/cam-core";
import type {
  ToolpathRequest,
  ToolpathResponse,
} from "@/features/workspace/stores/toolpath-scheduler";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<ToolpathRequest>) => void;
  postMessage: (response: ToolpathResponse, transfer?: Transferable[]) => void;
};

// Computes toolpaths off the main thread (ADR-0004), one request at a time.
scope.onmessage = ({ data }) => {
  const { operationId, inputHash } = data;
  try {
    const { operation } = data.input;
    const { moves, warnings } = generateToolpath(data.input);
    // Only drills make holes; other straight plunges enter a cut that shows.
    const holeRadius = operation.type === "drill" ? operation.tool.diameter / 2 : null;
    const lines = toolpathLines({ moves, warnings }, { holeRadius });
    // Only what the main thread shows crosses over, and the viewport's typed
    // arrays move there instead of being copied: cloning every move would cost
    // more than drawing them.
    scope.postMessage({ operationId, inputHash, warnings, lines }, toolpathLinesBuffers(lines));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ operationId, inputHash, error: message });
  }
};
