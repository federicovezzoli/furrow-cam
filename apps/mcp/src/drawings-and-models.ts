import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  DEFAULT_STL_LIMITS,
  DEFAULT_SVG_DPI,
  parseStl,
  rotatedSize,
  StlImportError,
  type StlMesh,
} from "@furrow/cam-core";
import { type Message, sha256Hex, type Units } from "@furrow/document";
import { formatMessage } from "@furrow/ui/lib/i18n";
import {
  DRAWING_FILE_TOO_LARGE,
  type DrawingFile,
  drawingFileNeeds,
  importDrawingFile,
  isDrawingImportError,
  MAX_DRAWING_FILE_SIZE,
  parseDrawingFile,
} from "@furrow/workspace/lib/drawing-import";
import {
  canImportModel,
  DRAWINGS_OR_MODEL,
  fitDrawingToStock,
  setDrawingSize,
} from "@furrow/workspace/stores/geometry-actions";
import {
  addModel,
  fitModelToStock,
  setModelDepth,
  setModelScale,
} from "@furrow/workspace/stores/model-actions";
import type { ActionResult } from "@furrow/workspace/stores/operation-actions";
import { change, type Project, ToolError, t } from "./projects";

/** The app's message for the assistant. */
const text = (message: Message) => formatMessage(t, message);

/** `run`'s result; throws a `ToolError` with the app's message if a drawing file can't be imported. */
function reading<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (isDrawingImportError(error) || error instanceof StlImportError) {
      throw new ToolError(text(error.detail));
    }
    throw error;
  }
}

/**
 * Imports the SVG, DXF or STL file at `path` into `project` as the app does
 * (PRD-0012 M3): a drawing is added beside the others, a model alone, each
 * placed at the zero's anchor. An SVG sized in pixels or not at all needs
 * `dpi`, a DXF that doesn't say its units needs `units`; without them, the
 * request is refused with the question the app asks. Returns the new
 * drawing's or model's id and the import's warnings.
 */
export async function importFile(
  project: Project,
  path: string,
  { dpi, units }: { dpi?: number; units?: Units },
): Promise<{ id: string; warnings: string[] }> {
  if (!isAbsolute(path)) throw new ToolError(`Give an absolute path, not ${JSON.stringify(path)}.`);
  const kind = /\.(svg|dxf|stl)$/i.exec(path)?.[1]?.toLowerCase();
  if (!kind) throw new ToolError(`${JSON.stringify(path)} isn't an SVG, DXF or STL file.`);
  const name = basename(path);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    throw new ToolError(`Can't read ${path}: ${(error as Error).message}`);
  }
  const limit = kind === "stl" ? DEFAULT_STL_LIMITS.maxBytes : MAX_DRAWING_FILE_SIZE;
  if (size > limit) {
    throw new ToolError(
      text(
        kind === "stl"
          ? { code: "stl.tooLarge", values: { mb: limit / 1_000_000 } }
          : DRAWING_FILE_TOO_LARGE,
      ),
    );
  }
  const bytes = new Uint8Array(await readFile(path));
  if (kind === "stl") return importModel(project, name, bytes);

  const file = reading(() => parseDrawingFile(name, bytes));
  const needs = drawingFileNeeds(file);
  if (needs === "dpi" && dpi === undefined) {
    throw new ToolError(
      `${name} gives its size in pixels, or not at all: give its dpi, how many pixels make an inch. Ask the user, who can check the export settings of the program that made it (Inkscape and most others use 96, older Illustrator 72).`,
    );
  }
  if (needs === "units" && units === undefined) {
    throw new ToolError(
      `${name} doesn't say what unit its coordinates are in: give its units, mm or in. Ask the user, who can check the export settings of the program that made it.`,
    );
  }
  return importDrawing(project, file, { dpi: dpi ?? DEFAULT_SVG_DPI, units: units ?? "mm" });
}

function importDrawing(
  project: Project,
  file: DrawingFile,
  options: { dpi: number; units: Units },
) {
  let result: ReturnType<typeof importDrawingFile> | undefined;
  reading(() => change(project, (store) => (result = importDrawingFile(store, file, options))));
  if (!result?.ok) throw new ToolError((result?.messages ?? []).map(text).join(" "));
  return { id: result.id, warnings: result.warnings.map(text) };
}

async function importModel(project: Project, fileName: string, bytes: Uint8Array) {
  if (!canImportModel(project.store.getState().document)) {
    throw new ToolError(text(DRAWINGS_OR_MODEL));
  }
  const mesh: StlMesh = reading(() => parseStl(bytes, DEFAULT_STL_LIMITS));
  const sha256 = await sha256Hex(bytes);
  const { triangles, bounds } = mesh;
  let id: string | null = null;
  change(project, (store) => {
    id = addModel(store, { sha256, triangles, bounds, fileName, size: bytes.byteLength });
  });
  if (id === null) throw new ToolError(text(DRAWINGS_OR_MODEL));
  // The project file stores the mesh, as the desktop app's does (ADR-0029, ADR-0047).
  project.meshes.set(sha256, bytes);
  return { id, warnings: [] };
}

/** Throws a `ToolError` with `result`'s message if the action was refused. */
function check(result: ActionResult | undefined) {
  if (result && !result.ok) throw new ToolError(formatMessage(t, result.error));
}

/** Throws a `ToolError` if `project` has no drawing or model `id`. */
function find(project: Project, id: string) {
  const { drawings, models } = project.store.getState().document;
  const model = models.find((m) => m.id === id);
  if (model) return { model };
  if (drawings.some((d) => d.id === id)) return { model: null };
  throw new ToolError(`The project has no drawing or model ${JSON.stringify(id)}.`);
}

/** Scales drawing or model `id` to fit inside the stock less its border, as *Fit to stock* does. */
export function fitToStock(project: Project, id: string) {
  const { model } = find(project, id);
  let result: ActionResult | undefined;
  change(project, (store) => {
    if (model) fitModelToStock(store, id);
    else result = fitDrawingToStock(store, id);
  });
  check(result);
}

/**
 * Sets drawing or model `id`'s width, height or a model's depth, in
 * millimetres, keeping its proportions, as the properties' size fields do.
 */
export function resize(
  project: Project,
  id: string,
  side: "width" | "height" | "depth",
  mm: number,
) {
  const { model } = find(project, id);
  if (!model) {
    if (side === "depth") throw new ToolError("A drawing has no depth: give its width or height.");
    let result: ActionResult | undefined;
    change(project, (store) => (result = setDrawingSize(store, id, side, mm)));
    check(result);
    return;
  }
  const [width, height, depth] = rotatedSize(model.bounds, model.placement.rotation);
  const extent = { width, height, depth }[side];
  if (extent <= 0) throw new ToolError(`This model is flat: it has no ${side} to set.`);
  change(project, (store) =>
    side === "depth" ? setModelDepth(store, id, mm) : setModelScale(store, id, mm / extent),
  );
}
