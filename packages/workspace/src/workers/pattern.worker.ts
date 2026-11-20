import {
  generateInside,
  type PatternWorkerRequest,
  type PatternWorkerResponse,
} from "../lib/patterns";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<PatternWorkerRequest>) => void;
  postMessage: (response: PatternWorkerResponse) => void;
};

/** Generates patterns (`generatePatternOffThread`, PRD-0016 P7). */
scope.onmessage = ({ data: { id, boundary, settings } }) => {
  scope.postMessage({ id, ...generateInside(boundary, settings) });
};
