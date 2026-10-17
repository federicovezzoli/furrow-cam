import {
  createCache,
  createReliefCache,
  generateToolpath,
  MissingMeshError,
  parseStl,
  type SimulationCut,
  type StlMesh,
  type Toolpath,
  toolpathCuts,
  toolpathKey,
  toolpathLines,
  toolpathLinesBuffers,
  toolpathMeshes,
  toolpathSteps,
} from "@furrow/cam-core";
import { sha256Hex } from "@/features/workspace/lib/mesh-worker-protocol";
import { exportFromResults, ToolpathResults } from "@/features/workspace/lib/toolpath-export";
import type {
  GcodeExportRequest,
  ToolpathMessage,
  ToolpathRequest,
  ToolpathWorkerResponse,
} from "@/features/workspace/stores/toolpath-scheduler";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<ToolpathMessage>) => void;
  postMessage: (response: ToolpathWorkerResponse, transfer?: Transferable[]) => void;
};

/** How long a toolpath computes before it lets messages (a cancel) in. */
const SLICE_MS = 50;
/** Least time between two progress reports of one toolpath. */
const PROGRESS_MS = 100;

/**
 * Meshes of the models toolpaths machine, by hash, least recently used
 * first. A 2-million-triangle mesh takes 72 MB, so only a couple are kept.
 */
const meshes = new Map<string, StlMesh>();
const KEPT_MESHES = 2;
/** Model heightmaps (up to 64 MB each), kept so changing the step-over doesn't rasterise again. */
const reliefCache = createReliefCache(2);
/**
 * The moves of the last toolpaths computed (24 bytes a move), so a rest
 * operation (#118) takes the operations before it from here instead of
 * computing them again.
 */
const cuts = createCache<SimulationCut[]>(8);
/**
 * The latest toolpath of each enabled operation, so exporting G-code posts
 * them instead of computing them again (#133). The scheduler's `retain`
 * messages drop those of operations disabled or deleted.
 */
const results = new ToolpathResults();

function keep(sha256: string, mesh: StlMesh) {
  meshes.delete(sha256);
  meshes.set(sha256, mesh);
  for (const oldest of meshes.keys()) {
    if (meshes.size <= KEPT_MESHES) break;
    meshes.delete(oldest);
  }
}

function mesh(sha256: string): Float32Array | undefined {
  const found = meshes.get(sha256);
  if (found) keep(sha256, found);
  return found?.positions;
}

/** A stored mesh was checked when it was imported; limits lowered since don't refuse it. */
const NO_LIMITS = { maxBytes: Infinity, maxTriangles: Infinity };

/** Lets the worker's messages in, without the delay nested timers get. */
const channel = new MessageChannel();
let resume: (() => void) | null = null;
channel.port1.onmessage = () => resume?.();
function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => {
    resume = resolve;
    channel.port2.postMessage(null);
  });
}

/** Keeps a model's STL file, checked against the hashes of the meshes it may be (ADR-0029). */
async function keepMesh(bytes: ArrayBuffer, hashes: ReadonlySet<string>) {
  const sha256 = await sha256Hex(bytes);
  if (!hashes.has(sha256)) throw new Error("The stored model doesn't match its file.");
  keep(sha256, parseStl(new Uint8Array(bytes), NO_LIMITS));
}

type Job = { cancelled: boolean };

/** The job of each operation with a request here, so a cancel can reach it. */
const jobs = new Map<string, Job>();

async function compute({ operationId, inputHash, input, mesh: bytes }: ToolpathRequest, job: Job) {
  if (job.cancelled) {
    scope.postMessage({ operationId, inputHash, cancelled: true });
    return;
  }
  if (bytes) {
    // The mesh of the operation's model, or of one before it for rest machining.
    await keepMesh(bytes, toolpathMeshes(input));
  }

  const steps = toolpathSteps(input, { mesh, cache: reliefCache, cuts });
  let toolpath: Toolpath;
  let slice = performance.now();
  let reported = slice;
  for (;;) {
    const step = steps.next();
    if (step.done) {
      toolpath = step.value;
      break;
    }
    const now = performance.now();
    if (now - reported >= PROGRESS_MS) {
      reported = now;
      scope.postMessage({ operationId, inputHash, progress: step.value });
    }
    if (now - slice >= SLICE_MS) {
      await yieldToMessages();
      if (job.cancelled) {
        scope.postMessage({ operationId, inputHash, cancelled: true });
        return;
      }
      slice = performance.now();
    }
  }

  results.keep(operationId, inputHash, toolpath);
  const { operation } = input;
  const { warnings } = toolpath;
  // Only drills make holes; other straight plunges enter a cut that shows.
  const holeRadius = operation.type === "drill" ? operation.tool.diameter / 2 : null;
  // A V-carve's or a relief's depth varies along each pass, and 3D roughing's
  // levels lie on top of each other, which a top view wouldn't show.
  const shadeDepth =
    operation.type === "vcarve" ||
    operation.type === "relief_finish" ||
    operation.type === "relief_rough";
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
}

// Computes toolpaths off the main thread (ADR-0004), one request at a time.
// Long ones (3D operations) let messages in between slices, so a cancel
// stops them early.
let queue = Promise.resolve();

/**
 * Posts the G-code of an export request (#133) from the toolpaths held for
 * its inputs, computing the others; asks for a mesh it lacks.
 */
async function exportProgram({
  export: id,
  document,
  name,
  inputs,
  meshes: files = [],
}: GcodeExportRequest) {
  try {
    // Every mesh asked for so far, for this export only, so the worker's two
    // kept meshes can't evict one it needs again: each attempt gets further.
    const hashes = new Set(inputs.flatMap(({ input }) => [...toolpathMeshes(input)]));
    const exportMeshes = new Map<string, Float32Array>();
    for (const bytes of files) {
      const sha256 = await sha256Hex(bytes);
      if (!hashes.has(sha256)) throw new Error("The stored model doesn't match its file.");
      exportMeshes.set(sha256, parseStl(new Uint8Array(bytes), NO_LIMITS).positions);
    }
    // Room for every operation's cuts, starting with those of the toolpaths
    // held, so a rest operation computed here takes them instead of computing
    // the ones before it again.
    const exportCuts = createCache<SimulationCut[]>(inputs.length + 1);
    for (const { operationId, inputHash, input } of inputs) {
      const held = results.get(operationId, inputHash);
      if (held) exportCuts.set(toolpathKey(input), toolpathCuts(input.operation, held));
    }
    const context = {
      mesh: (sha256: string) => exportMeshes.get(sha256) ?? mesh(sha256),
      cache: reliefCache,
      cuts: exportCuts,
    };
    const program = exportFromResults(document, name, inputs, results, (input) =>
      generateToolpath(input, context),
    );
    scope.postMessage({ export: id, ...program });
  } catch (error) {
    if (error instanceof MissingMeshError) {
      scope.postMessage({ export: id, missingMesh: error.sha256 });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      scope.postMessage({ export: id, error: message });
    }
  }
}

scope.onmessage = ({ data }) => {
  if ("cancel" in data) {
    const job = jobs.get(data.cancel);
    if (job) job.cancelled = true;
    return;
  }
  if ("retain" in data) {
    results.retain(data.retain);
    return;
  }
  if ("export" in data) {
    // After the requests already here, so toolpaths still computing are held by then.
    queue = queue.then(() => exportProgram(data));
    return;
  }
  const { operationId, inputHash } = data;
  const job: Job = { cancelled: false };
  jobs.set(operationId, job);
  queue = queue.then(async () => {
    try {
      await compute(data, job);
    } catch (error) {
      if (error instanceof MissingMeshError) {
        scope.postMessage({ operationId, inputHash, missingMesh: error.sha256 });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        scope.postMessage({ operationId, inputHash, error: message });
      }
    } finally {
      if (jobs.get(operationId) === job) jobs.delete(operationId);
    }
  });
};
