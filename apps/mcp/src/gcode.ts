import { access } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  createCache,
  DEFAULT_STL_LIMITS,
  generateToolpath,
  parseStl,
  type SimulationCut,
  type ToolpathContext,
} from "@furrow/cam-core";
import { projectNameFromFileName, toolProblem } from "@furrow/document";
import {
  type ComputedToolpath,
  enabledInputs,
  type GcodeExport,
  GcodeExportError,
  type PostWarning,
  postToolpaths,
} from "@furrow/post";
import { formatWarning } from "@furrow/ui/lib/i18n";
import { writeFileAtomic } from "./files";
import { type Project, ToolError, t } from "./projects";

/** Reports that operation `done` of `total`, named `operation`, is being computed. */
export type Progress = (done: number, total: number, operation: string) => Promise<void> | void;

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

/**
 * The toolpaths of the project's enabled operations, in order, computed as
 * `exportGcode` computes them (ADR-0004: on the user's computer), one at a
 * time: `progress` hears before each, and `signal` stops them between
 * operations.
 */
async function computeToolpaths(
  project: Project,
  progress?: Progress,
  signal?: AbortSignal,
): Promise<ComputedToolpath[]> {
  const inputs = enabledInputs(project.store.getState().document);
  const context: ToolpathContext = {
    mesh: meshes(project),
    cuts: createCache<SimulationCut[]>(inputs.length),
  };
  const computed: ComputedToolpath[] = [];
  for (const [i, input] of inputs.entries()) {
    // shortcut: an operation computes to its end once started; stop inside one by moving this to a worker thread if long 3D operations need it.
    await progress?.(i, inputs.length, input.operation.name);
    // Lets the cancellation of the request in, between operations.
    await new Promise((resolve) => setImmediate(resolve));
    signal?.throwIfAborted();
    computed.push({ input, toolpath: generateToolpath(input, context) });
  }
  await progress?.(inputs.length, inputs.length, "");
  return computed;
}

/** A warning or problem as the app words it, e.g. `Cut out: …`. */
const warning = (each: PostWarning) => formatWarning(t, each);

/** The project's program, or why there is none, from its toolpaths. */
async function post(project: Project, progress?: Progress, signal?: AbortSignal) {
  const computed = await computeToolpaths(project, progress, signal);
  const document = project.store.getState().document;
  try {
    return { result: postToolpaths(document, projectName(project), computed) };
  } catch (error) {
    if (!(error instanceof GcodeExportError)) throw error;
    const warnings = computed.flatMap(({ input, toolpath }) =>
      toolpath.warnings.map((message) => warning({ operation: input.operation.name, message })),
    );
    return { error: warning({ operation: error.operation, message: error.detail }), warnings };
  }
}

/**
 * What the app shows of the project's problems (PRD-0012 M6): each
 * operation's tool problem, each enabled operation's toolpath warnings, and
 * whether there is anything to cut, and if not why, in the app's English.
 */
export async function checkProject(project: Project, progress?: Progress, signal?: AbortSignal) {
  const { operations } = project.store.getState().document;
  const toolProblems = operations.flatMap((operation) => {
    const problem = toolProblem(operation);
    return problem ? [warning({ operation: operation.name, message: problem })] : [];
  });
  const posted = await post(project, progress, signal);
  if ("error" in posted) {
    return { toolProblems, warnings: posted.warnings, canExport: false, whyNot: posted.error };
  }
  const { files, warnings } = posted.result;
  return {
    toolProblems,
    warnings: warnings.map(warning),
    canExport: true,
    files: files.map(({ fileName }) => fileName),
  };
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
  const posted = await post(project, progress, signal);
  if ("error" in posted) throw new ToolError(`Nothing to export: ${posted.error}`);
  const { files, warnings }: GcodeExport = posted.result;
  const paths = files.map(({ fileName }) => join(folder ?? dirname(project.path), fileName));
  if (!overwrite) {
    for (const path of paths) {
      // Checked for every file first, so a two-sided export isn't left half written.
      if (
        await access(path).then(
          () => true,
          () => false,
        )
      ) {
        throw new ToolError(`${path} already exists: pass overwrite to replace it.`);
      }
    }
  }
  for (const [i, path] of paths.entries()) {
    const bytes = new TextEncoder().encode(files[i]?.gcode);
    try {
      await writeFileAtomic(path, bytes, overwrite);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ToolError(`${path} already exists: pass overwrite to replace it.`);
      }
      throw new ToolError(`Can't write ${path}: ${(error as Error).message}`);
    }
  }
  return { files: paths, warnings: warnings.map(warning) };
}
