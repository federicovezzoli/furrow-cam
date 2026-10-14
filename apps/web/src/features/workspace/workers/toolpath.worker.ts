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
    const toolpath = generateToolpath(data.input);
    const { warnings } = toolpath;
    // Only drills make holes; other straight plunges enter a cut that shows.
    const holeRadius = operation.type === "drill" ? operation.tool.diameter / 2 : null;
    // A V-carve's depth varies along each pass, which a top view wouldn't show.
    const shadeDepth = operation.type === "vcarve";
    const lines = toolpathLines(toolpath, { holeRadius, shadeDepth });
    const clearing = toolpath.clearing
      ? toolpathLines({ moves: toolpath.clearing, warnings: [] })
      : undefined;
    // Only what the main thread shows crosses over, and the viewport's typed
    // arrays move there instead of being copied: cloning every move would cost
    // more than drawing them.
    scope.postMessage(
      clearing
        ? { operationId, inputHash, warnings, lines, clearing }
        : { operationId, inputHash, warnings, lines },
      [...toolpathLinesBuffers(lines), ...(clearing ? toolpathLinesBuffers(clearing) : [])],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ operationId, inputHash, error: message });
  }
};
