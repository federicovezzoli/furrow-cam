import {
  createCache,
  generateToolpath,
  type SimulationCut,
  type Toolpath,
  type ToolpathContext,
  type ToolpathInput,
  toolpathInputs,
} from "@furrow/cam-core";
import { type PostProcessorId, type ProjectDocument, projectFileName } from "@furrow/document";
import { grbl } from "./grbl";
import type { PostOutput, PostProcessor } from "./post";

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
 * same toolpaths. Throws when there is nothing to cut.
 */
export function postToolpaths(
  doc: ProjectDocument,
  name: string,
  computed: readonly ComputedToolpath[],
): GcodeExport {
  const first = computed[0];
  if (first === undefined) throw new Error("There are no enabled operations to export.");

  const warnings: string[] = [];
  const operations = computed.flatMap(({ input, toolpath }) => {
    const { name: operationName } = input.operation;
    warnings.push(...toolpath.warnings.map((warning) => `${operationName}: ${warning}`));
    if (toolpath.moves.length > 0 || (toolpath.clearing?.length ?? 0) > 0) {
      return [{ operation: input.operation, toolpath }];
    }
    // Not every empty toolpath warns, e.g. an operation whose shapes were deleted.
    warnings.push(`${operationName}: no toolpath, left out of the program.`);
    return [];
  });
  if (operations.length === 0) {
    throw new Error("None of the enabled operations has a toolpath to export.");
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
