import { type ToolpathInput, toolpathInputs, toolpathKey } from "@furrow/cam-core";
import type { DocumentStore } from "./document-store";
import type { ToolpathPreview, ToolpathStore } from "./toolpath-store";

/**
 * Computes the toolpath of `input`. A 3D operation's request carries its
 * model's STL file in `mesh` once the worker said it lacks it.
 */
export type ToolpathRequest = {
  operationId: string;
  inputHash: string;
  input: ToolpathInput;
  mesh?: ArrayBuffer;
};

/** Stops computing the operation's request, if the worker hasn't answered it yet. */
export type ToolpathCancel = { cancel: string };

export type ToolpathMessage = ToolpathRequest | ToolpathCancel;

/**
 * The worker's answers: the toolpath, why it failed, how far it got (any
 * number of times before the others), that it was cancelled, or that it
 * needs the mesh `missingMesh` to be sent with the request.
 */
export type ToolpathResponse = { operationId: string; inputHash: string } & (
  | ToolpathPreview
  | { error: string }
  | { progress: number }
  | { cancelled: true }
  | { missingMesh: string }
);

/**
 * Keeps the toolpath store in step with the document: whenever the inputs of
 * an enabled operation change, it marks the operation as computing and sends
 * a request to the worker through `post`; `receive` files the worker's
 * responses. Disabled and deleted operations lose their toolpaths. A rest
 * operation's inputs hold those of the enabled operations before it, so it
 * is computed again whenever one of them changes.
 *
 * Each operation has at most one request at the worker: changes made while it
 * computes (scrubbing a value) cancel it and wait, and only the latest is sent
 * once it answers. When the worker lacks a model's mesh, `loadMesh` fetches
 * its file and the request is sent again with it. `cancel` stops computing an
 * operation, which stays cancelled until it changes or `retry` computes it
 * again. `stop` stops listening; `fail` gives up on every pending request,
 * e.g. when the worker crashed and was replaced.
 */
export function scheduleToolpaths(
  documents: DocumentStore,
  toolpaths: ToolpathStore,
  post: (message: ToolpathMessage) => void,
  loadMesh: (sha256: string) => Promise<ArrayBuffer> = () =>
    Promise.reject(new Error("Models can't be loaded here")),
) {
  /** The inputs each operation was last hashed with, so unchanged ones skip hashing. */
  const hashed = new Map<string, { input: ToolpathInput; inputHash: string }>();
  /** The request each operation has at the worker (or waiting for its mesh). */
  const inFlight = new Map<string, ToolpathRequest>();
  /** The latest request of each operation still waiting for its previous one. */
  const waiting = new Map<string, ToolpathRequest>();
  /** Operations whose request at the worker was asked to stop. */
  const cancelled = new Set<string>();

  function send(request: ToolpathRequest) {
    inFlight.set(request.operationId, request);
    post(request);
  }

  function cancelInFlight(id: string) {
    if (!inFlight.has(id) || cancelled.has(id)) return;
    cancelled.add(id);
    post({ cancel: id });
  }

  /** Ends the operation's request at the worker and sends the one waiting, if any. */
  function settle(id: string) {
    inFlight.delete(id);
    cancelled.delete(id);
    const next = waiting.get(id);
    if (next) {
      waiting.delete(id);
      send(next);
    }
  }

  async function sendWithMesh(request: ToolpathRequest, sha256: string) {
    const id = request.operationId;
    let mesh: ArrayBuffer;
    try {
      mesh = await loadMesh(sha256);
    } catch (error) {
      if (inFlight.get(id) !== request) return;
      const message = error instanceof Error ? error.message : String(error);
      toolpaths.getState().setError(id, request.inputHash, message);
      settle(id);
      return;
    }
    // Stopped, failed or cancelled while the file loaded.
    if (inFlight.get(id) !== request) return;
    const next = waiting.get(id) ?? (cancelled.has(id) ? null : request);
    waiting.delete(id);
    cancelled.delete(id);
    if (next) send({ ...next, mesh });
    else {
      inFlight.delete(id);
      toolpaths.getState().setCancelled(id, request.inputHash);
    }
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
    for (const id of inFlight.keys()) if (!ids.has(id)) cancelInFlight(id);
    for (const input of toolpathInputs(document, enabled)) {
      const id = input.operation.id;
      const inputHash = hashInput(input);
      if (toolpaths.getState().entries[id]?.inputHash === inputHash) continue;
      toolpaths.getState().startComputing(id, inputHash, previewKey(input));
      const request = { operationId: id, inputHash, input };
      if (inFlight.has(id)) {
        waiting.set(id, request);
        cancelInFlight(id);
      } else send(request);
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
      const { setResult, setError, setProgress, setCancelled } = toolpaths.getState();
      if ("progress" in response) {
        setProgress(operationId, inputHash, response.progress);
        return;
      }
      if ("missingMesh" in response) {
        const request = inFlight.get(operationId);
        if (request && !waiting.has(operationId) && !cancelled.has(operationId)) {
          void sendWithMesh(request, response.missingMesh);
          return;
        }
        // Changed or cancelled meanwhile: the latest request asks again.
        if (!waiting.has(operationId)) setCancelled(operationId, inputHash);
      } else if ("cancelled" in response) {
        // Only an operation nobody changed since stays cancelled.
        if (!waiting.has(operationId)) setCancelled(operationId, inputHash);
      } else if ("error" in response) setError(operationId, inputHash, response.error);
      else {
        const { operationId: _, inputHash: __, ...preview } = response;
        setResult(operationId, inputHash, preview);
      }
      settle(operationId);
    },
    /** Stops computing the operation `id`; its toolpath stays cancelled until `retry` or a change. */
    cancel(id: string) {
      waiting.delete(id);
      cancelInFlight(id);
    },
    /** Computes the operation `id` again, e.g. after it was cancelled. */
    retry(id: string) {
      if (inFlight.has(id)) return;
      const { document } = documents.getState();
      const operation = document.operations.find((candidate) => candidate.id === id);
      if (!operation?.enabled) return;
      const [input] = toolpathInputs(document, [operation]);
      if (!input) return;
      const inputHash = hashInput(input);
      toolpaths.getState().startComputing(id, inputHash, previewKey(input));
      send({ operationId: id, inputHash, input });
    },
    fail(error: string) {
      inFlight.clear();
      waiting.clear();
      cancelled.clear();
      const { entries, setError } = toolpaths.getState();
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.status === "computing") setError(id, entry.inputHash, error);
      }
    },
  };
}

/**
 * What a toolpath looks like, whatever its numbers: the operation's type
 * and params with every number left out. Scrubbing a depth or a step-over
 * keeps the key, and the last toolpath shows meanwhile; picking another
 * strategy, side or direction changes it.
 */
export function previewKey({ operation }: ToolpathInput): string {
  return JSON.stringify([operation.type, operation.params], (_, value) =>
    typeof value === "number" ? 0 : value,
  );
}

/**
 * Whether two inputs hold the same objects. Immer replaces every object on the
 * path to a change, so unchanged operations and shapes keep their identity.
 */
function sameInput(a: ToolpathInput, b: ToolpathInput): boolean {
  return (
    a.operation === b.operation &&
    a.model === b.model &&
    // A new rectangle every time, for the operations that have one.
    JSON.stringify(a.stock) === JSON.stringify(b.stock) &&
    a.stockBottom === b.stockBottom &&
    a.safeZ === b.safeZ &&
    a.entryClearance === b.entryClearance &&
    a.shapes.length === b.shapes.length &&
    a.shapes.every((shape, i) => shape === b.shapes[i]) &&
    // A rest operation's inputs hold those of the operations before it.
    a.before.length === b.before.length &&
    a.before.every((before, i) => sameInput(before, b.before[i] as ToolpathInput))
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
