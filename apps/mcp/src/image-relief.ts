import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import {
  type Box3,
  DEFAULT_STL_LIMITS,
  type ImageReliefSettings,
  imageReliefMesh,
  type StlLimits,
} from "@furrow/cam-core";
import { fittingSide } from "@furrow/workspace/lib/model-size";
import { fileNameFor } from "@furrow/workspace/lib/place-search";
import { canImportModel, ONE_MODEL } from "@furrow/workspace/stores/geometry-actions";
import { imageDecoder, imageFormat } from "./decoders";
import { addMesh, making, text } from "./drawings-and-models";
import { type Project, ToolError } from "./projects";

export type ImageReliefRequest = Omit<ImageReliefSettings, "width"> & {
  /** Absolute path of the PNG, JPEG or WebP image. */
  image: string;
  width?: number;
  name?: string;
  /** The mesh's limits; the app's defaults unless a test needs a small mesh. */
  limits?: StlLimits;
};

/**
 * Makes the relief of `request.image` and adds it to `project` as its model,
 * at the chosen width and centred on the stock, as the app's *Relief from
 * image* does (PRD-0015). Returns the model's id, size and cells.
 */
export async function importImageRelief(project: Project, request: ImageReliefRequest) {
  if (!canImportModel(project.store.getState().document)) throw new ToolError(text(ONE_MODEL));
  const path = request.image;
  if (!isAbsolute(path)) throw new ToolError(`Give an absolute path, not ${JSON.stringify(path)}.`);
  const limits = request.limits ?? DEFAULT_STL_LIMITS;
  let bytes: Uint8Array;
  try {
    // An image as large as the largest STL is far more than the mesh can use.
    if ((await stat(path)).size > limits.maxBytes) {
      throw new ToolError(text({ code: "image.tooLarge", values: { mb: limits.maxBytes / 1e6 } }));
    }
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`Can't read ${path}: ${(error as Error).message}`);
  }
  const format = imageFormat(bytes);
  if (!format) throw new ToolError(`${JSON.stringify(path)} isn't a PNG, JPEG or WebP image.`);
  // shortcut: the decoders ignore EXIF orientation and colour profiles, which the app's browser applies, so a rotated phone photo comes out turned; read the orientation tag if users hit it.
  const decode = await imageDecoder(format);
  const pixels = await decode(bytes.slice().buffer).catch(() => {
    throw new ToolError(
      `Can't decode ${path}: the image is damaged or uses an unsupported variant.`,
    );
  });

  // By default, and at most, as wide as fits inside the stock less the model border.
  const span: [number, number] = [pixels.width, pixels.height];
  const fitting =
    (fittingSide(project.store.getState().document.stock, span) * pixels.width) / Math.max(...span);
  const width = request.width ?? fitting;
  if (width > fitting + 1e-9) {
    throw new ToolError(
      `The width can be at most ${Math.floor(fitting * 10) / 10} mm, to fit inside the stock less the model border: make the stock larger first, or leave width out.`,
    );
  }
  const { relief, base, invert, blur } = request;
  // shortcut: meshed on the server's one thread, as terrain is; move it to a worker thread if a large image makes other calls wait.
  const mesh = await making(() =>
    imageReliefMesh(pixels, { width, relief, base, invert, blur }, limits),
  );
  const name = fileNameFor(request.name ?? basename(path, extname(path))) || "Relief";
  const bounds = { min: [0, 0, 0], max: mesh.size } satisfies Box3;
  const id = await addMesh(
    project,
    { triangles: mesh.triangles, bounds, fileName: `${name}.stl` },
    mesh.stl,
    { fit: false },
  );
  return {
    id,
    size: mesh.size.map((value) => Math.round(value * 10) / 10),
    pixels: span,
    cells: mesh.cells,
    triangles: mesh.triangles,
  };
}
