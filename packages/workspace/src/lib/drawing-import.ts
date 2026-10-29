import {
  type DxfDocument,
  DxfImportError,
  dxfNeedsUnits,
  type ImportMessage,
  importDxf,
  importSvg,
  parseDxf,
  parseSvg,
  type SvgDocument,
  SvgImportError,
  svgNeedsDpi,
} from "@furrow/cam-core";
import type { Message, Units } from "@furrow/document";
import type { DocumentStore } from "../stores/document-store";
import { addImportedShapes, DRAWINGS_OR_MODEL } from "../stores/geometry-actions";

/** The largest SVG or DXF file any import takes: anything larger is unlikely to be a drawing worth cutting. */
export const MAX_DRAWING_FILE_SIZE = 20_000_000;

/** Why a drawing file can't be imported, for the user (ADR-0054). */
export const DRAWING_FILE_TOO_LARGE: Message = {
  code: "workspace.fileTooLarge",
  values: { mb: MAX_DRAWING_FILE_SIZE / 1_000_000 },
};

/** A parsed SVG or DXF file, by its file name, still to be imported. */
export type DrawingFile =
  | { kind: "svg"; svg: SvgDocument; name: string }
  | { kind: "dxf"; dxf: DxfDocument; name: string };

/** Whether `error` says why a drawing file can't be imported. */
export function isDrawingImportError(error: unknown): error is SvgImportError | DxfImportError {
  return error instanceof SvgImportError || error instanceof DxfImportError;
}

/**
 * Parses the drawing file `name` (`.dxf`, otherwise SVG) from `bytes`.
 * Throws an `SvgImportError` or `DxfImportError` if it can't be read.
 */
export function parseDrawingFile(name: string, bytes: Uint8Array): DrawingFile {
  // DXF files name their encoding inside, so they are decoded from bytes.
  if (/\.dxf$/i.test(name)) return { kind: "dxf", dxf: parseDxf(bytes), name };
  return { kind: "svg", svg: parseSvg(new TextDecoder().decode(bytes)), name };
}

/**
 * What the user must say before `file` is imported: the DPI of an SVG sized
 * in pixels or not at all, or the units of a DXF that doesn't give them.
 */
export function drawingFileNeeds(file: DrawingFile): "dpi" | "units" | null {
  if (file.kind === "svg") return svgNeedsDpi(file.svg) ? "dpi" : null;
  return dxfNeedsUnits(file.dxf) ? "units" : null;
}

/**
 * Imports `file` as a new drawing, as one undo step (`addImportedShapes`):
 * an SVG at `dpi`, a DXF taking `units` for a drawing unit if it doesn't say.
 * Returns the warnings, or why nothing was added. Throws an `SvgImportError`
 * or `DxfImportError` if the file can't be imported.
 */
export function importDrawingFile(
  store: DocumentStore,
  file: DrawingFile,
  { dpi, units }: { dpi: number; units: Units },
):
  | { ok: true; id: string; warnings: ImportMessage[] }
  | { ok: false; messages: (Message | ImportMessage)[] } {
  const { shapes, warnings } =
    file.kind === "svg"
      ? importSvg(file.svg, { dpi, fileName: file.name })
      : importDxf(file.dxf, { units, fileName: file.name });
  const [first] = shapes;
  if (!first) return { ok: false, messages: [{ code: "workspace.noShapes" }, ...warnings] };
  if (!addImportedShapes(store, file.kind === "svg" ? "importSvg" : "importDxf", shapes)) {
    return { ok: false, messages: [DRAWINGS_OR_MODEL] };
  }
  return { ok: true, id: first.drawingId, warnings };
}
