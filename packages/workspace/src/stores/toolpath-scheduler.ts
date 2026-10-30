import { type ToolpathInput, toolpathInputs, toolpathKey, toolpathMeshes } from "@furrow/cam-core";
import {
  type Machine,
  type Message,
  machineSpinUpDelay,
  type ProjectDocument,
} from "@furrow/document";
import type { GcodeExport } from "@furrow/post";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { ExportInput } from "../lib/toolpath-export";
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

/** Drops the toolpaths the worker keeps of operations other than these (#133). */
export type ToolpathRetain = { retain: string[] };

/**
 * The project's machine, which toolpath times are estimated for (#420): the
 * worker estimates the toolpaths it holds again and every one after.
 */
export type ToolpathMachine = { machine: Machine | null };

/**
 * Exports the G-code of `document` from the toolpaths the worker holds for
 * `inputs`, the enabled operations' (#133), computing only those it lacks.
 * It carries every STL file the worker said it lacks so far in `meshes`,
 * so each attempt gets further than the one before.
 */
export type GcodeExportRequest = {
  export: number;
  document: ProjectDocument;
  name: string;
  inputs: ExportInput[];
  meshes?: ArrayBuffer[];
};

export type ToolpathMessage =
  | ToolpathRequest
  | ToolpathCancel
  | ToolpathRetain
  | ToolpathMachine
  | GcodeExportRequest;

/** How many times an export is made again for edits before it gives up (#252). */
const MAX_EXPORT_RESTARTS = 5;
const KEPT_CHANGING: Message = { code: "workspace.keptChanging" };

/** An export waiting for the worker: its latest request, and the meshes sent so far by hash. */
type PendingExport = {
  request: GcodeExportRequest;
  /** The project's name now, for the file and the program's header. */
  name: () => string;
  meshes: Map<string, ArrayBuffer>;
  restarts: number;
  resolve: (result: GcodeExportResult) => void;
};

/** The program, why it couldn't be exported, or the mesh the worker needs for it. */
/** An export's error is a core package's message, with the operation it is about, if any. */
export type GcodeExportResult = GcodeExport | { error: string | Message; operation?: string };
export type GcodeExportResponse = { export: number } & (
  | GcodeExportResult
  | { missingMesh: string }
);

/**
 * The worker's answers: the toolpath, why it failed, how far it got (any
 * number of times before the others), that it was cancelled, or that it
 * needs the mesh `missingMesh` to be sent with the request. A toolpath it
 * holds is also estimated again when the machine changes (`estimate`).
 */
export type ToolpathResponse = { operationId: string; inputHash: string } & (
  | ToolpathPreview
  | { estimate: number }
  | { error: Translatable }
  | { progress: number }
  | { cancelled: true }
  | { missingMesh: string }
);

/** Everything the toolpath worker sends back. */
export type ToolpathWorkerResponse = ToolpathResponse | GcodeExportResponse;

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
 *
 * The worker keeps each operation's latest toolpath; `retain` messages drop
 * those of operations disabled or deleted. `exportGcode` exports the program
 * from them (#133): its request carries the enabled operations' inputs and
 * hashes, the worker posts the toolpaths it holds for those hashes and
 * computes the rest, and it runs after the requests already at the worker,
 * so toolpaths still computing finish first.
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
  /** The enabled operations the worker was last told to keep toolpaths of, sorted. */
  let retained: string | null = null;
  /** What the toolpaths were last estimated with (`estimateKey`), and whether the worker knows it. */
  let estimatedFor: string | undefined;
  let workerKnows = false;
  /** Operations whose toolpaths a crashed worker took with it, still showing its estimates. */
  const lost = new Set<string>();

  /** Tells the worker the project's machine if it doesn't know it; whether the estimates change. */
  function sendMachine(): boolean {
    const { machine } = documents.getState().document;
    const key = estimateKey(machine);
    const changed = key !== estimatedFor;
    if (changed || !workerKnows) post({ machine });
    estimatedFor = key;
    workerKnows = true;
    return changed;
  }
  /** Exports waiting for the worker, by id. */
  const exports = new Map<number, PendingExport>();
  let lastExport = 0;

  function send(request: ToolpathRequest) {
    // A fresh worker after a crash knows no machine.
    sendMachine();
    lost.delete(request.operationId);
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
    for (const map of [hashed, waiting, lost]) {
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    }
    for (const id of inFlight.keys()) if (!ids.has(id)) cancelInFlight(id);
    const sorted = JSON.stringify([...ids].sort());
    if (sorted !== retained) {
      retained = sorted;
      post({ retain: [...ids] });
    }
    // The worker holds no toolpath of a lost operation to estimate again: it is computed again.
    const machineChanged = sendMachine();
    for (const input of toolpathInputs(document, enabled)) {
      const id = input.operation.id;
      const inputHash = hashInput(input);
      const current = toolpaths.getState().entries[id]?.inputHash === inputHash;
      if (current && !(machineChanged && lost.has(id))) continue;
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

  async function sendExportWithMesh(id: number, sha256: string) {
    const pending = exports.get(id);
    if (!pending) return;
    try {
      const mesh = await loadMesh(sha256);
      if (exports.get(id) !== pending) return;
      pending.meshes.set(sha256, mesh);
      // Edited meanwhile: no point computing the old document's program.
      if (restartIfStale(pending)) return;
      pending.request = { ...pending.request, meshes: [...pending.meshes.values()] };
      post(pending.request);
    } catch (error) {
      if (exports.get(id) !== pending) return;
      exports.delete(id);
      pending.resolve({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  function receiveExport(response: GcodeExportResponse) {
    const id = response.export;
    if ("missingMesh" in response) {
      void sendExportWithMesh(id, response.missingMesh);
      return;
    }
    const pending = exports.get(id);
    if (!pending || restartIfStale(pending)) return;
    exports.delete(id);
    const { export: _, ...result } = response;
    pending.resolve(result);
  }

  /**
   * Whether `pending` was built from a document other than the one on screen,
   * or one mid-gesture: its program would differ from the screen (#252), so it
   * is made again from the document once the gesture commits, keeping the
   * toolpaths the worker holds. After `MAX_EXPORT_RESTARTS`, it gives up.
   */
  function restartIfStale(pending: PendingExport): boolean {
    const { document, inTransaction } = documents.getState();
    if (document === pending.request.document && !inTransaction) return false;
    if (pending.restarts >= MAX_EXPORT_RESTARTS) {
      exports.delete(pending.request.export);
      pending.resolve({ error: KEPT_CHANGING });
      return true;
    }
    pending.restarts++;
    const restart = () => {
      if (exports.get(pending.request.export) === pending) post(exportRequest(pending));
    };
    if (!inTransaction) restart();
    else {
      const unsubscribe = documents.subscribe((state) => {
        if (state.inTransaction) return;
        unsubscribe();
        restart();
      });
    }
    return true;
  }

  /**
   * The export `pending` of the document as it is now, with the inputs the
   * toolpaths were requested with and the meshes they use of those sent.
   */
  function exportRequest(pending: PendingExport): GcodeExportRequest {
    const { document } = documents.getState();
    const enabled = document.operations.filter((operation) => operation.enabled);
    const inputs = toolpathInputs(document, enabled).map((input) => ({
      operationId: input.operation.id,
      inputHash: hashInput(input),
      input,
    }));
    const used = new Set(inputs.flatMap(({ input }) => [...toolpathMeshes(input)]));
    const meshes = [...pending.meshes].flatMap(([sha256, mesh]) =>
      used.has(sha256) ? [mesh] : [],
    );
    pending.request = {
      export: pending.request.export,
      document,
      name: pending.name(),
      inputs,
      ...(meshes.length > 0 && { meshes }),
    };
    return pending.request;
  }

  return {
    stop,
    /**
     * The G-code of the document as it is when the program is ready, from the
     * toolpaths the worker holds (#133): an edit made while it is made starts
     * it again (#252). `name` is read at each attempt, so a rename counts too.
     */
    exportGcode(name: () => string): Promise<GcodeExportResult> {
      return new Promise((resolve) => {
        const pending: PendingExport = {
          // Filled in by `exportRequest`.
          request: {
            export: ++lastExport,
            document: documents.getState().document,
            name: "",
            inputs: [],
          },
          name,
          meshes: new Map(),
          restarts: 0,
          resolve,
        };
        exports.set(pending.request.export, pending);
        post(exportRequest(pending));
      });
    },
    receive(message: ToolpathWorkerResponse) {
      if ("export" in message) {
        receiveExport(message);
        return;
      }
      const response = message;
      const { operationId, inputHash } = response;
      const { setResult, setError, setProgress, setEstimate, setCancelled } = toolpaths.getState();
      if ("estimate" in response) {
        setEstimate(operationId, inputHash, response.estimate);
        return;
      }
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
      // A fresh worker holds no toolpaths: it is told again what to keep, and the machine.
      retained = null;
      workerKnows = false;
      for (const { resolve } of exports.values()) resolve({ error });
      exports.clear();
      const { entries, setError } = toolpaths.getState();
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.status === "computing") setError(id, entry.inputHash, error);
        if (entry.status === "ready") lost.add(id);
      }
    },
  };
}

/** What toolpath times depend on of `machine` (`estimateTime`), so other edits don't estimate again. */
function estimateKey(machine: Machine | null): string {
  if (machine === null) return "none";
  return JSON.stringify([machine.maxFeedXY, machine.maxFeedZ, machineSpinUpDelay(machine)]);
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
 * The inputs before a rest operation are compared without their own
 * `before`, which is a part of its own: recursing would take exponential time
 * with chained rest operations.
 */
function sameInput(a: ToolpathInput, b: ToolpathInput, nested = true): boolean {
  return (
    a.operation === b.operation &&
    a.model === b.model &&
    // A new rectangle every time, for the operations that have one.
    JSON.stringify(a.stock) === JSON.stringify(b.stock) &&
    a.stockBottom === b.stockBottom &&
    a.parting === b.parting &&
    // A new object every time, like the stock rectangle.
    JSON.stringify(a.flip) === JSON.stringify(b.flip) &&
    // Holding tabs too, built afresh for every input.
    JSON.stringify(a.tabs) === JSON.stringify(b.tabs) &&
    a.safeZ === b.safeZ &&
    a.entryClearance === b.entryClearance &&
    // A new disc every time, like the stock rectangle.
    JSON.stringify(a.touchOff) === JSON.stringify(b.touchOff) &&
    a.shapes.length === b.shapes.length &&
    a.shapes.every((shape, i) => shape === b.shapes[i]) &&
    // A rest operation's inputs hold those of the operations before it.
    a.before.length === b.before.length &&
    (!nested ||
      a.before.every((before, i) => sameInput(before, b.before[i] as ToolpathInput, false)))
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
