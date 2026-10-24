import {
  createCache,
  generateToolpath,
  type SimulationCut,
  type Toolpath,
  type ToolpathContext,
  type ToolpathInput,
  toolpathInputs,
} from "@furrow/cam-core";
import {
  type PostProcessorId,
  type ProjectDocument,
  projectFileName,
  toolProblem,
} from "@furrow/document";
import { grbl } from "./grbl";
import { GcodeExportError, type PostOutput, type PostProcessor, type PostWarning } from "./post";

/** Every dialect, by the id machine profiles store. */
export const POST_PROCESSORS: Record<PostProcessorId, PostProcessor> = { grbl };

/** Used when the project has no machine profile. */
export const DEFAULT_POST_PROCESSOR: PostProcessorId = "grbl";

export type GcodeExport = PostOutput & { fileName: string };

/** An operation's inputs and the toolpath computed from them. */
export type ComputedToolpath = { input: ToolpathInput; toolpath: Toolpath };

/**
 * The G-code of the project `name`, for its machine's post-processor: the
 * enabled operations in order, toolpath warnings included. Computes every
 * toolpath, so it runs in a Web Worker (ADR-0004); 3D operations take their
 * models' meshes from `context`. Rest operations take the toolpaths before
 * them from the ones computed here. Throws when there is nothing to cut.
 */
export function exportGcode(
  doc: ProjectDocument,
  name: string,
  context?: ToolpathContext,
): GcodeExport {
  const inputs = enabledInputs(doc);
  const toolpathContext: ToolpathContext = {
    ...context,
    cuts: context?.cuts ?? createCache<SimulationCut[]>(inputs.length),
  };
  return postToolpaths(
    doc,
    name,
    inputs.map((input) => ({ input, toolpath: generateToolpath(input, toolpathContext) })),
  );
}

/** The inputs of the document's enabled operations, in order, as `exportGcode` posts them. */
export function enabledInputs(doc: ProjectDocument): ToolpathInput[] {
  return toolpathInputs(
    doc,
    doc.operations.filter((operation) => operation.enabled),
  );
}

/**
 * The G-code of the project `name` from toolpaths already computed (#133),
 * one for each of the document's enabled operations in order
 * (`enabledInputs`), as `exportGcode` posts them: the same program for the
 * same toolpaths. Throws when there is nothing to cut or an operation can't
 * cut with its tool, e.g. a drill bit on a profile.
 */
export function postToolpaths(
  doc: ProjectDocument,
  name: string,
  all: readonly ComputedToolpath[],
): GcodeExport {
  // shortcut: one program for the top side only; the bottom side's toolpaths
  // are in its own coordinates and need the stock turned over first, so they
  // wait for one file per side (#359).
  const computed = all.filter(({ input }) => input.operation.stockSide === "top");
  const first = computed[0];
  if (first === undefined) {
    throw new GcodeExportError({ message: { code: "export.noEnabled" } });
  }
  // Leaving such an operation out could run the next bit into stock it was meant to clear.
  for (const { input } of computed) {
    const problem = toolProblem(input.operation);
    if (problem) throw new GcodeExportError({ operation: input.operation.name, message: problem });
  }

  const warnings: PostWarning[] = [];
  const operations = computed.flatMap(({ input, toolpath }) => {
    const { name: operationName } = input.operation;
    warnings.push(...toolpath.warnings.map((message) => ({ operation: operationName, message })));
    if (toolpath.moves.length > 0 || (toolpath.clearing?.length ?? 0) > 0) {
      return [{ operation: input.operation, toolpath }];
    }
    // Not every empty toolpath warns, e.g. an operation whose shapes were deleted.
    warnings.push({ operation: operationName, message: { code: "export.noToolpath" } });
    return [];
  });
  if (operations.length === 0) {
    throw new GcodeExportError({ message: { code: "export.noneHasToolpath" } });
  }

  const processor = POST_PROCESSORS[doc.machine?.postProcessor ?? DEFAULT_POST_PROCESSOR];
  const output = processor.post({
    name,
    stock: doc.stock,
    machine: doc.machine,
    safeZ: first.input.safeZ,
    operations,
  });
  return {
    gcode: output.gcode,
    warnings: [...warnings, ...output.warnings],
    fileName: projectFileName(name, processor.extension),
  };
}
