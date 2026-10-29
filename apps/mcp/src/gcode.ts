import { lstat, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  createCache,
  createReliefCache,
  DEFAULT_STL_LIMITS,
  MissingMeshError,
  parseStl,
  type SimulationCut,
  type Toolpath,
  type ToolpathContext,
  toolpathSteps,
} from "@furrow/cam-core";
import {
  MessageError,
  type ProjectDocument,
  projectNameFromFileName,
  toolProblem,
} from "@furrow/document";
import {
  type ComputedToolpath,
  enabledInputs,
  GcodeExportError,
  type PostWarning,
  postToolpaths,
} from "@furrow/post";
import { formatWarning } from "@furrow/ui/lib/i18n";
import { writeFileAtomic } from "./files";
import { type Project, ToolError, t } from "./projects";

/**
 * Reports how far computing the toolpaths has got: `done` of `total`
 * operations, fractions included, while computing `operation`.
 */
export type Progress = (done: number, total: number, operation: string) => Promise<void> | void;

/** How long a computation runs before it lets other requests and a cancellation in, in ms. */
const SLICE_MS = 50;

/** The name the app gives the project: its file's, written in the G-code's header and file names. */
export function projectName(project: Project): string {
  return projectNameFromFileName(basename(project.path)) ?? "Untitled";
}

/** The toolpaths' meshes, from the project's file, each read once. */
function meshes(project: Project): ToolpathContext["mesh"] {
  const read = new Map<string, Float32Array>();
  return (sha256) => {
    const bytes = project.meshes.get(sha256);
    if (!bytes) return undefined;
    let positions = read.get(sha256);
    if (!positions) {
      // The archive checked the mesh when the project was opened.
      positions = parseStl(bytes, DEFAULT_STL_LIMITS).positions;
      read.set(sha256, positions);
    }
    return positions;
  };
}

/** A warning or problem as the app words it, e.g. `Cut out: …`. */
const warning = (each: PostWarning) => formatWarning(t, each);

/** Why operation `operation`'s toolpath couldn't be computed, as a `ToolError` in the app's words. */
function toolpathError(error: unknown, operation: string): unknown {
  if (error instanceof MissingMeshError) {
    return new ToolError(
      `“${operation}”: this file doesn't hold its model's mesh. Open the project's .furrow or .furrow.zip file.`,
    );
  }
  if (error instanceof MessageError) {
    return new ToolError(
      warning({ operation: error.operation ?? operation, message: error.detail }),
    );
  }
  return error;
}

/**
 * The toolpaths of `document`'s enabled operations, in order, computed as
 * the app's toolpath worker computes them (ADR-0004: on the user's
 * computer), step by step: every `SLICE_MS` they report `progress` and let
 * other requests in, and stop if `signal` is aborted.
 */
async function computeToolpaths(
  project: Project,
  document: ProjectDocument,
  progress?: Progress,
  signal?: AbortSignal,
): Promise<ComputedToolpath[]> {
  const inputs = enabledInputs(document);
  const context: ToolpathContext = {
    mesh: meshes(project),
    cache: createReliefCache(),
    cuts: createCache<SimulationCut[]>(inputs.length),
  };
  const computed: ComputedToolpath[] = [];
  for (const [i, input] of inputs.entries()) {
    const { name } = input.operation;
    await progress?.(i, inputs.length, name);
    const steps = toolpathSteps(input, context);
    let slice = performance.now();
    let toolpath: Toolpath | undefined;
    while (!toolpath) {
      let step: IteratorResult<number, Toolpath>;
      try {
        step = steps.next();
      } catch (error) {
        throw toolpathError(error, name);
      }
      if (step.done) toolpath = step.value;
      else if (performance.now() - slice >= SLICE_MS) {
        await progress?.(i + step.value, inputs.length, name);
        await new Promise((resolve) => setImmediate(resolve));
        signal?.throwIfAborted();
        slice = performance.now();
      }
    }
    computed.push({ input, toolpath });
  }
  await progress?.(inputs.length, inputs.length, "");
  // A cancellation during the last step still stops what comes after.
  await new Promise((resolve) => setImmediate(resolve));
  signal?.throwIfAborted();
  return computed;
}

/**
 * Each toolpath's warnings, and a note for each that cuts nothing, as
 * `postToolpaths` gives them before posting.
 */
function toolpathWarnings(computed: readonly ComputedToolpath[]): string[] {
  return computed.flatMap(({ input, toolpath }) => {
    const operation = input.operation.name;
    const empty = toolpath.moves.length === 0 && (toolpath.clearing?.length ?? 0) === 0;
    return [
      ...toolpath.warnings.map((message) => warning({ operation, message })),
      ...(empty ? [warning({ operation, message: { code: "export.noToolpath" } })] : []),
    ];
  });
}

/**
 * What the app shows of the project's problems (PRD-0012 M6), for its
 * enabled operations, which are the ones exported: each one's tool problem,
 * the toolpath and program warnings, and whether there is anything to cut,
 * and if not why, in the app's English. The warnings are the program's when
 * there is one, and otherwise the toolpaths'.
 */
export async function checkProject(project: Project, progress?: Progress, signal?: AbortSignal) {
  const document = project.store.getState().document;
  const toolProblems = document.operations.flatMap((operation) => {
    const problem = operation.enabled && toolProblem(operation);
    return problem ? [warning({ operation: operation.name, message: problem })] : [];
  });
  const computed = await computeToolpaths(project, document, progress, signal);
  // Posted without the operations the export refuses, so the warnings are those of the rest.
  const postable = computed.filter(({ input }) => !toolProblem(input.operation));
  try {
    const { files, warnings } = postToolpaths(document, projectName(project), postable);
    if (toolProblems.length > 0) {
      return {
        toolProblems,
        warnings: warnings.map(warning),
        canExport: false,
        whyNot: "An operation's tool can't cut it: see toolProblems.",
      };
    }
    const fileNames = files.map(({ fileName }) => fileName);
    return { toolProblems, warnings: warnings.map(warning), canExport: true, files: fileNames };
  } catch (error) {
    if (!(error instanceof GcodeExportError)) throw error;
    const whyNot =
      toolProblems.length > 0
        ? "An operation's tool can't cut it: see toolProblems."
        : warning({ operation: error.operation, message: error.detail });
    return { toolProblems, warnings: toolpathWarnings(postable), canExport: false, whyNot };
  }
}

/** Whether the export may write to `path`; throws a `ToolError` if not. */
async function checkTarget(path: string, overwrite: boolean) {
  const entry = await lstat(path).catch(() => null);
  if (!entry) return;
  if (!overwrite) throw new ToolError(`${path} already exists: pass overwrite to replace it.`);
  // A link to a file is replaced by the program (the link itself, not its target).
  const target = entry.isSymbolicLink() ? await stat(path).catch(() => null) : entry;
  if (!target?.isFile()) throw new ToolError(`${path} isn't a file: it can't be replaced.`);
}

/**
 * Writes the project's G-code into `folder` (beside the project by default),
 * named as the app names its export: one file, or one per side of a
 * two-sided project (PRD-0012 M7). Byte for byte the app's program. Refuses
 * to replace a file unless `overwrite`. Returns the files written and the
 * export's warnings.
 */
export async function exportProject(
  project: Project,
  { folder, overwrite = false }: { folder?: string; overwrite?: boolean },
  progress?: Progress,
  signal?: AbortSignal,
) {
  if (folder !== undefined && !isAbsolute(folder)) {
    throw new ToolError(`Give an absolute folder, not ${JSON.stringify(folder)}.`);
  }
  const document = project.store.getState().document;
  const computed = await computeToolpaths(project, document, progress, signal);
  let posted: ReturnType<typeof postToolpaths>;
  try {
    posted = postToolpaths(document, projectName(project), computed);
  } catch (error) {
    if (!(error instanceof GcodeExportError)) throw error;
    const reason = warning({ operation: error.operation, message: error.detail });
    throw new ToolError(`Nothing to export: ${reason}`);
  }
  const { files, warnings } = posted;
  const paths = files.map(({ fileName }) => join(folder ?? dirname(project.path), fileName));
  for (const path of paths) await checkTarget(path, overwrite);
  signal?.throwIfAborted();
  const written: string[] = [];
  for (const [i, path] of paths.entries()) {
    try {
      await writeFileAtomic(path, new TextEncoder().encode(files[i]?.gcode), overwrite);
      written.push(path);
    } catch (error) {
      // One side alone would be cut without the other, so a two-sided export writes both or neither.
      await Promise.all(written.map((done) => rm(done, { force: true })));
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ToolError(`${path} already exists: pass overwrite to replace it.`);
      }
      throw new ToolError(`Can't write ${path}: ${(error as Error).message}`);
    }
  }
  return { files: paths, warnings: warnings.map(warning) };
}
