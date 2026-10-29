import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  DEFAULT_STL_LIMITS,
  DEFAULT_SVG_DPI,
  drawingFit,
  parseStl,
  rotatedSize,
  StlImportError,
  type StlMesh,
} from "@furrow/cam-core";
import { sha256Hex, type Units } from "@furrow/document";
import { formatMessage, type Translatable } from "@furrow/ui/lib/i18n";
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
  drawingBounds,
  fitDrawingToStock,
  setDrawingSize,
} from "@furrow/workspace/stores/geometry-actions";
import {
  addModel,
  fitModelToStock,
  modelAnchor,
  setModelDepth,
  setModelScale,
} from "@furrow/workspace/stores/model-actions";
import type { ActionResult } from "@furrow/workspace/stores/operation-actions";
import { change, type Project, ToolError, t } from "./projects";

/** The app's message for the assistant. */
const text = (message: Translatable) => formatMessage(t, message);

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
  const limit = kind === "stl" ? DEFAULT_STL_LIMITS.maxBytes : MAX_DRAWING_FILE_SIZE;
  let bytes: Uint8Array;
  try {
    // Checked before reading, so a huge file isn't read in.
    if ((await stat(path)).size > limit) {
      throw new ToolError(
        text(
          kind === "stl"
            ? { code: "stl.tooLarge", values: { mb: limit / 1_000_000 } }
            : DRAWING_FILE_TOO_LARGE,
        ),
      );
    }
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`Can't read ${path}: ${(error as Error).message}`);
  }
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
  // shortcut: parsed on the server's one thread, so other tool calls wait for a large STL; move it to a worker thread (as the app's mesh.worker.ts) if that bites.
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
  if (result && !result.ok) throw new ToolError(text(result.error));
}

/** Model or drawing `id`, the drawing by its bounds; throws a `ToolError` if `project` has neither. */
function find(project: Project, id: string) {
  const { drawings, geometry, models } = project.store.getState().document;
  const model = models.find((m) => m.id === id);
  if (model) return { model, bounds: null };
  const bounds = drawingBounds(geometry, id);
  if (drawings.some((d) => d.id === id) && bounds) return { model: null, bounds };
  throw new ToolError(`The project has no drawing or model ${JSON.stringify(id)}.`);
}

/** Scales drawing or model `id` to fit inside the stock less its border, as *Fit to stock* does. */
export function fitToStock(project: Project, id: string) {
  const { model, bounds } = find(project, id);
  const { stock, drawings } = project.store.getState().document;
  const border = drawings.find((d) => d.id === id)?.border ?? 0;
  // `fitDrawingToStock` does nothing, and says nothing, to a drawing that is one point.
  if (bounds && !drawingFit(bounds, stock, modelAnchor(stock), border)) {
    throw new ToolError("This drawing is a single point: it has no size to fit.");
  }
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
  const { model, bounds } = find(project, id);
  if (!model) {
    if (side === "depth") throw new ToolError("A drawing has no depth: give its width or height.");
    const i = side === "width" ? 0 : 1;
    // `setDrawingSize` does nothing, and says nothing, to a drawing with no extent that way.
    if ((bounds.max[i] as number) - (bounds.min[i] as number) <= 0) {
      throw new ToolError(`This drawing is a line: it has no ${side} to set.`);
    }
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
