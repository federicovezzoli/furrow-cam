import { type Toolpath, type ToolpathInput, toolpathInput } from "@furrow/cam-core";
import type { DocumentStore } from "./document-store";
import type { ToolpathStore } from "./toolpath-store";

export type ToolpathRequest = { operationId: string; inputHash: string; input: ToolpathInput };

export type ToolpathResponse = { operationId: string; inputHash: string } & (
  | { result: Toolpath }
  | { error: string }
);

/**
 * Keeps the toolpath store in step with the document: whenever the inputs of
 * an enabled operation change, it marks the operation as computing and sends
 * a request to the worker through `post`; `receive` files the worker's
 * responses. Disabled and deleted operations lose their toolpaths. Returns a
 * function that stops listening.
 */
export function scheduleToolpaths(
  documents: DocumentStore,
  toolpaths: ToolpathStore,
  post: (request: ToolpathRequest) => void,
) {
  function update() {
    const { document } = documents.getState();
    const enabled = document.operations.filter((operation) => operation.enabled);
    const { entries, startComputing, retain } = toolpaths.getState();
    retain(enabled.map((operation) => operation.id));
    for (const { id } of enabled) {
      const input = toolpathInput(document, id);
      const inputHash = hash(JSON.stringify(input));
      if (entries[id]?.inputHash === inputHash) continue;
      startComputing(id, inputHash);
      post({ operationId: id, inputHash, input });
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
      const { setResult, setError } = toolpaths.getState();
      if ("result" in response)
        setResult(response.operationId, response.inputHash, response.result);
      else setError(response.operationId, response.inputHash, response.error);
    },
  };
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
