import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, isAbsolute } from "node:path";
import {
  DEFAULT_STL_LIMITS,
  DEFAULT_SVG_DPI,
  drawingFit,
  modelFlatFaces,
  parseStl,
  rotatedSize,
  StlImportError,
  type StlMesh,
} from "@furrow/cam-core";
import { MessageError, type Model, sha256Hex, type Units } from "@furrow/document";
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
import { stepToStl } from "@furrow/workspace/lib/step";
import {
  addModelDrawing,
  drawingBounds,
  duplicateDrawing,
  fitDrawingToStock,
  mirrorDrawing,
  moveDrawing,
  removeDrawing,
  rotateDrawing,
  setDrawingSize,
} from "@furrow/workspace/stores/geometry-actions";
import {
  addModel,
  fitModelToStock,
  modelAnchor,
  moveModel,
  removeModel,
  setModelDepth,
  setModelScale,
  setModelTop,
  turnModelAbout,
} from "@furrow/workspace/stores/model-actions";
import type { ActionResult } from "@furrow/workspace/stores/operation-actions";
import { change, type Project, ToolError, t } from "./projects";

/** The app's message for the assistant. */
export const text = (message: Translatable) => formatMessage(t, message);

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

/** OpenCascade's WebAssembly, read from the package (kept out of the bundle) for a STEP file. */
const occtWasm = () =>
  readFile(createRequire(import.meta.url).resolve("occt-import-js/dist/occt-import-js.wasm"));

/** `run`'s result; throws a `ToolError` with the app's message if it throws one. */
export async function making<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MessageError) throw new ToolError(text(error.detail));
    throw error;
  }
}

/** A STEP file as the STL made from it (ADR-0072); throws a `ToolError` with the app's message. */
const stepMesh = (bytes: Uint8Array) =>
  making(() => stepToStl(bytes, DEFAULT_STL_LIMITS, occtWasm));

/**
 * Imports the SVG, DXF, STL or STEP file at `path` into `project` as the app does
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
  const kind = /\.(svg|dxf|stl|step|stp)$/i.exec(path)?.[1]?.toLowerCase().replace("stp", "step");
  if (!kind) throw new ToolError(`${JSON.stringify(path)} isn't an SVG, DXF, STL or STEP file.`);
  const name = basename(path);
  const model = kind === "stl" || kind === "step";
  const limit = model ? DEFAULT_STL_LIMITS.maxBytes : MAX_DRAWING_FILE_SIZE;
  let bytes: Uint8Array;
  try {
    // Checked before reading, so a huge file isn't read in.
    if ((await stat(path)).size > limit) {
      throw new ToolError(
        text(
          model
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
  if (kind === "step") {
    const { stl, faces } = await stepMesh(bytes);
    return importModel(project, name, stl, faces);
  }

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

async function importModel(
  project: Project,
  fileName: string,
  bytes: Uint8Array,
  faces?: number[],
) {
  // shortcut: parsed on the server's one thread, so other tool calls wait for a large STL; move it to a worker thread (as the app's mesh.worker.ts) if that bites.
  const { triangles, bounds }: StlMesh = reading(() => parseStl(bytes, DEFAULT_STL_LIMITS));
  const mesh = { triangles, bounds, fileName, ...(faces && { faces }) };
  return { id: await addMesh(project, mesh, bytes), warnings: [] };
}

/**
 * Adds the STL `bytes` as the project's model, fitted to the stock or, with
 * `fit: false`, at its size centred on it (a terrain, ADR-0077). Returns its id.
 */
export async function addMesh(
  project: Project,
  mesh: Pick<Model, "triangles" | "bounds" | "fileName" | "faces">,
  bytes: Uint8Array,
  { fit = true }: { fit?: boolean } = {},
): Promise<string> {
  const sha256 = await sha256Hex(bytes);
  let id = "";
  change(project, (store) => {
    id = addModel(store, { ...mesh, sha256, size: bytes.byteLength }, { fit });
  });
  // The project file stores the mesh, as the desktop app's does (ADR-0029, ADR-0047).
  project.meshes.set(sha256, bytes);
  return id;
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

/** Sinks model `id`'s top `mm` millimetres below the stock top (ADR-0069), keeping its size. */
export function setTop(project: Project, id: string, mm: number) {
  if (!find(project, id).model)
    throw new ToolError("A drawing has no top: only a model sits below the stock top.");
  change(project, (store) => setModelTop(store, id, mm));
}

/**
 * Turns model `id` `turns` quarter turns about the stock's `axis`, as the
 * properties' turn buttons do, keeping its anchor point in place.
 */
export function turn(project: Project, id: string, axis: "x" | "y" | "z", turns: number) {
  if (!find(project, id).model) {
    throw new ToolError("A drawing can't be turned in quarter turns: only a model can.");
  }
  const index = ({ x: 0, y: 1, z: 2 } as const)[axis];
  change(project, (store) => turnModelAbout(store, id, index, turns));
}

/** Throws a `ToolError` unless `id` is a drawing that isn't a pattern (a pattern follows its boundary, ADR-0088). */
function refuseUnlessDrawing(project: Project, id: string, what: string, hint = "") {
  if (find(project, id).model) {
    throw new ToolError(`A model can't be ${what}: only a drawing can.${hint}`);
  }
  if (project.store.getState().document.drawings.find((d) => d.id === id)?.pattern) {
    throw new ToolError(
      `A pattern can't be ${what}: it follows the drawing it fills, so change that one.`,
    );
  }
}

/**
 * Adds a drawing of model `id`'s flat levels and outline where the model
 * lies, as the app's *Drawings from model* does (ADR-0093). Returns the
 * drawing's id and its levels' heights below the stock top, from the top down.
 */
export function drawingsFromModel(project: Project, id: string): { id: string; levels: number[] } {
  const { model } = find(project, id);
  if (!model) throw new ToolError("Only a model has faces to draw: this is a drawing.");
  const bytes = project.meshes.get(model.sha256);
  if (!bytes) throw new ToolError(text({ code: "workspace.modelDrawingsFailed" }));
  // The archive checked the mesh when the project was opened.
  const found = modelFlatFaces(parseStl(bytes, DEFAULT_STL_LIMITS).positions, model);
  let drawingId: string | null = null;
  change(project, (store) => {
    drawingId = addModelDrawing(store, model.fileName, found, t("Model.outlineLayer"));
  });
  if (!drawingId) throw new ToolError(text({ code: "workspace.noModelFaces" }));
  return { id: drawingId, levels: found.levels.map(({ z }) => 0 - z) };
}

/** Moves drawing or model `id` by `[dx, dy]` millimetres, with its tabs and holes. */
export function move(project: Project, id: string, [dx, dy]: [number, number]) {
  if (find(project, id).model) {
    change(project, (store) => moveModel(store, id, [dx, dy]));
    return;
  }
  refuseUnlessDrawing(project, id, "moved");
  change(project, (store) => moveDrawing(store, id, [dx, dy]));
}

/** Turns drawing `id` by `degrees`, counter-clockwise for positive ones, as the properties' rotation does. */
export function rotate(project: Project, id: string, degrees: number) {
  refuseUnlessDrawing(project, id, "rotated", " Turn it in quarter turns with turn_model.");
  let result: ActionResult | undefined;
  change(project, (store) => (result = rotateDrawing(store, id, degrees)));
  check(result);
}

/** Mirrors drawing `id` left to right (`"x"`) or top to bottom (`"y"`), in place. */
export function mirror(project: Project, id: string, axis: "x" | "y") {
  refuseUnlessDrawing(project, id, "mirrored");
  let result: ActionResult | undefined;
  change(project, (store) => (result = mirrorDrawing(store, id, axis)));
  check(result);
}

/** Copies drawing `id` beside it, with the operations, tabs and holes on it; returns the copy's id. */
export function duplicate(project: Project, id: string): string {
  if (find(project, id).model)
    throw new ToolError("A model can't be duplicated: only a drawing can.");
  let copy: string | null = null;
  change(project, (store) => (copy = duplicateDrawing(store, id)));
  if (!copy) throw new ToolError("This drawing has no shapes to copy.");
  return copy;
}

/** Removes drawing or model `id` and what goes with it in the app (its operations, targets and tabs). */
export function remove(project: Project, id: string) {
  const { model } = find(project, id);
  change(project, (store) => (model ? removeModel(store, id) : removeDrawing(store, id)));
}
