import {
  createCache,
  generateToolpath,
  type SimulationCut,
  type Toolpath,
  type ToolpathContext,
  type ToolpathInput,
  toolpathInputs,
} from "@furrow/cam-core";
import { type PostProcessorId, type ProjectDocument, toolProblem } from "@furrow/document";
import { grbl } from "./grbl/grbl";
import { GcodeExportError, type PostProcessor, type PostWarning, type SideSetup } from "./post";

/** Every dialect, by the id machine profiles store. */
export const POST_PROCESSORS: Record<PostProcessorId, PostProcessor> = { grbl };

/** Used when the project has no machine profile. */
export const DEFAULT_POST_PROCESSOR: PostProcessorId = "grbl";

/** One program to save, e.g. `Plate.gcode`. */
export type GcodeFile = { fileName: string; gcode: string };

/**
 * What exporting gives: one file, or in a two-sided project one per side
 * with something to cut, top first (ADR-0060); and the warnings about them.
 */
export type GcodeExport = { files: GcodeFile[]; warnings: PostWarning[] };

/**
 * What names an exported program besides the project: the label of the
 * version the document is (`null` for none) and the day it is exported,
 * today by default.
 */
export type GcodeNaming = { version?: string | null; date?: Date };

// Spaces, dashes, characters reserved on Windows or macOS, and control characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it matches
const FILE_NAME_SEPARATORS = /[\s<>:"/\\|?*\u0000-\u001f\u007f-]+/g;

/**
 * `text` lowercased, each run of separators made one dash, with no dash or
 * dot at either end (a leading dot hides a file, Windows drops trailing ones).
 */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(FILE_NAME_SEPARATORS, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * The file name of the project `name`'s program, e.g.
 * `cutting-board-final-2026-11-01-top.gcode`: the project, the version
 * (when there is one), the local date and the stock side of a two-sided
 * project's program.
 */
export function gcodeFileName(
  name: string,
  { version = null, date = new Date() }: GcodeNaming,
  side: "top" | "bottom" | null,
  extension: string,
): string {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  const parts = [slug(name) || "project", version === null ? "" : slug(version), day, side ?? ""];
  return `${parts.filter((part) => part !== "").join("-")}${extension}`;
}

/** An operation's inputs and the toolpath computed from them. */
export type ComputedToolpath = { input: ToolpathInput; toolpath: Toolpath };

/**
 * The G-code of the project `name`, for its machine's post-processor: the
 * enabled operations in order, toolpath warnings included. Computes every
 * toolpath, so it runs in a Web Worker (ADR-0004); 3D operations take their
 * models' meshes from `context`. Rest operations take the toolpaths before
 * them from the ones computed here. The files are named by `gcodeFileName`.
 * Throws when there is nothing to cut.
 */
export function exportGcode(
  doc: ProjectDocument,
  name: string,
  context?: ToolpathContext,
  naming: GcodeNaming = {},
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
    naming,
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
  computed: readonly ComputedToolpath[],
  naming: GcodeNaming = {},
): GcodeExport {
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
  const toPost = computed.flatMap(({ input, toolpath }) => {
    const { name: operationName } = input.operation;
    warnings.push(...toolpath.warnings.map((message) => ({ operation: operationName, message })));
    if (toolpath.moves.length > 0 || (toolpath.clearing?.length ?? 0) > 0) {
      return [{ operation: input.operation, toolpath }];
    }
    // Not every empty toolpath warns, e.g. an operation whose shapes were deleted.
    warnings.push({ operation: operationName, message: { code: "export.noToolpath" } });
    return [];
  });
  if (toPost.length === 0) {
    throw new GcodeExportError({ message: { code: "export.noneHasToolpath" } });
  }

  const processor = POST_PROCESSORS[doc.machine?.postProcessor ?? DEFAULT_POST_PROCESSOR];
  // One date for every file of the export, even across midnight.
  const fileNaming = { date: new Date(), ...naming };
  const fileName = (side: "top" | "bottom" | null) =>
    gcodeFileName(name, fileNaming, side, processor.extension);
  const post = (operations: typeof toPost, side: SideSetup | null, fileName: string) => {
    const output = processor.post({
      name,
      stock: doc.stock,
      machine: doc.machine,
      safeZ: first.input.safeZ,
      operations,
      side,
    });
    // Each side's program may say the same, e.g. of a custom block.
    const said = new Set(warnings.map((warning) => JSON.stringify(warning)));
    warnings.push(...output.warnings.filter((warning) => !said.has(JSON.stringify(warning))));
    return { fileName, gcode: output.gcode };
  };
  if (!doc.stock.twoSided) {
    return { files: [post(toPost, null, fileName(null))], warnings };
  }
  const sides = (["top", "bottom"] as const).flatMap((side) => {
    const operations = toPost.filter(({ operation }) => operation.stockSide === side);
    return operations.length > 0 ? [{ side, operations, fileName: fileName(side) }] : [];
  });
  const pins = toPost.some(
    ({ operation }) =>
      operation.stockSide === "top" && operation.type === "drill" && operation.params.pins,
  );
  const files = sides.map(({ side, operations, fileName }) => {
    const other = sides.some((each) => each.side !== side);
    return post(operations, { side, other, pins }, fileName);
  });
  return { files, warnings };
}
