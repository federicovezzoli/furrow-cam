import { type ToolpathInput, toolpathInputs, toolpathKey } from "@furrow/cam-core";
import type { DocumentStore } from "./document-store";
import type { ToolpathPreview, ToolpathStore } from "./toolpath-store";

export type ToolpathRequest = { operationId: string; inputHash: string; input: ToolpathInput };

export type ToolpathResponse = { operationId: string; inputHash: string } & (
  | ToolpathPreview
  | { error: string }
);

/**
 * Keeps the toolpath store in step with the document: whenever the inputs of
 * an enabled operation change, it marks the operation as computing and sends
 * a request to the worker through `post`; `receive` files the worker's
 * responses. Disabled and deleted operations lose their toolpaths.
 *
 * Each operation has at most one request at the worker: changes made while it
 * computes (scrubbing a value) wait, and only the latest is sent once it
 * answers. `stop` stops listening; `fail` gives up on every pending request,
 * e.g. when the worker crashed and was replaced.
 */
export function scheduleToolpaths(
  documents: DocumentStore,
  toolpaths: ToolpathStore,
  post: (request: ToolpathRequest) => void,
) {
  /** The inputs each operation was last hashed with, so unchanged ones skip hashing. */
  const hashed = new Map<string, { input: ToolpathInput; inputHash: string }>();
  /** Operations with a request at the worker. */
  const inFlight = new Set<string>();
  /** The latest request of each operation still waiting for its previous one. */
  const waiting = new Map<string, ToolpathRequest>();

  function send(request: ToolpathRequest) {
    inFlight.add(request.operationId);
    post(request);
  }

  /** The hash of `input`, reusing the last one when nothing it holds was replaced. */
  function hashInput(input: ToolpathInput): string {
    const id = input.operation.id;
    const last = hashed.get(id);
    if (last && sameInput(last.input, input)) return last.inputHash;
    const inputHash = hash(toolpathKey(input));
    hashed.set(id, { input, inputHash });
    return inputHash;
  }

  function update() {
    const { document } = documents.getState();
    const enabled = document.operations.filter((operation) => operation.enabled);
    const ids = new Set(enabled.map((operation) => operation.id));
    toolpaths.getState().retain(ids);
    for (const map of [hashed, waiting]) {
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    }
    for (const input of toolpathInputs(document, enabled)) {
      const id = input.operation.id;
      const inputHash = hashInput(input);
      if (toolpaths.getState().entries[id]?.inputHash === inputHash) continue;
      toolpaths.getState().startComputing(id, inputHash);
      const request = { operationId: id, inputHash, input };
      if (inFlight.has(id)) waiting.set(id, request);
      else send(request);
    }
  }

  update();
  // Only document changes matter: undo, redo and transactions all replace it.
  const stop = documents.subscribe((state, previous) => {
    if (state.document !== previous.document) update();
  });

  return {
    stop,
    receive(response: ToolpathResponse) {
      const { operationId, inputHash } = response;
      inFlight.delete(operationId);
      const { setResult, setError } = toolpaths.getState();
      if ("error" in response) setError(operationId, inputHash, response.error);
      else {
        const { operationId: _, inputHash: __, ...preview } = response;
        setResult(operationId, inputHash, preview);
      }
      const next = waiting.get(operationId);
      if (next) {
        waiting.delete(operationId);
        send(next);
      }
    },
    fail(error: string) {
      inFlight.clear();
      waiting.clear();
      const { entries, setError } = toolpaths.getState();
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.status === "computing") setError(id, entry.inputHash, error);
      }
    },
  };
}

/**
 * Whether two inputs hold the same objects. Immer replaces every object on the
 * path to a change, so unchanged operations and shapes keep their identity.
 */
function sameInput(a: ToolpathInput, b: ToolpathInput): boolean {
  return (
    a.operation === b.operation &&
    a.safeZ === b.safeZ &&
    a.entryClearance === b.entryClearance &&
    a.shapes.length === b.shapes.length &&
    a.shapes.every((shape, i) => shape === b.shapes[i])
  );
}

/** cyrb53: a fast 53-bit string hash, enough to tell inputs apart. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
