import { z } from "zod";
import { MAX_PROJECT_FONTS, ProjectFont } from "./font";
import { Drawing, Shape } from "./geometry";
import { GcodeBlock, Machine } from "./machine";
import { Model, Sha256 } from "./model";
import { Operation, operationModelId } from "./operation";
import { PositiveLength, Units } from "./units";

export const CURRENT_SCHEMA_VERSION = 24;

/** The 9 stock points an XY zero can sit on: corners, edge midpoints and the centre. */
export const StockAnchor = z.enum([
  "bottom_left",
  "bottom_center",
  "bottom_right",
  "middle_left",
  "center",
  "middle_right",
  "top_left",
  "top_center",
  "top_right",
]);
export type StockAnchor = z.infer<typeof StockAnchor>;

/**
 * Where the machine's XY zero is (ADR-0016): a stock anchor, which follows the
 * stock when it is resized, or a custom point in millimetres from the stock's
 * bottom-left corner, which keeps its stock position and may lie outside the
 * stock (a fixture corner, a fence).
 *
 * Documents saved before custom zeros stored a bare anchor name
 * (`"bottom_left"` or `"center"`); parsing still accepts those and normalises
 * them to `{ anchor }`.
 */
export const XYOrigin = z.preprocess(
  // Normalised before the union, so invalid origins still report the exact field.
  (value) => (value === "bottom_left" || value === "center" ? { anchor: value } : value),
  z.discriminatedUnion("anchor", [
    z.strictObject({ anchor: StockAnchor }),
    z.strictObject({ anchor: z.literal("custom"), x: z.number(), y: z.number() }),
  ]),
);
export type XYOrigin = z.infer<typeof XYOrigin>;

export const ZOrigin = z.enum(["stock_top", "machine_bed"]);
export type ZOrigin = z.infer<typeof ZOrigin>;

/**
 * A spot of the stock top no operation cuts (#147, ADR-0041), for zeroing Z
 * on after a tool change: GRBL has no tool length offsets. A disc, its
 * centre in stock coordinates and its diameter in millimetres, no larger
 * than the stock's smaller side. Only used with `zOrigin: "stock_top"`.
 */
export const TouchOff = z.strictObject({
  x: z.number(),
  y: z.number(),
  diameter: PositiveLength,
  /**
   * This project's tool change on the pad (ADR-0043), in place of the
   * machine's `toolChange` block; `null` runs the block derived from the
   * machine's (`suggestTouchOffToolChange`, ADR-0056). `{padX}` and `{padY}` stand for the pad's centre in work
   * coordinates, `{safeZ}` for the machine's safe Z.
   */
  toolChange: GcodeBlock,
});
export type TouchOff = z.infer<typeof TouchOff>;
/** The pad as a disc of stock top, all operations need of it. */
export type TouchOffDisc = Pick<TouchOff, "x" | "y" | "diameter">;

/** The axis the stock is turned over about between a two-sided project's sides (ADR-0060). */
export const FlipAxis = z.enum(["x", "y"]);
export type FlipAxis = z.infer<typeof FlipAxis>;

/**
 * How deep locating pin holes go (PRD-0011 B4): through the stock and
 * `spoilboardDepth` into the spoilboard, for pins fixed in it, or `depth`
 * below the stock top only.
 */
export const PinHoles = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("through"), spoilboardDepth: PositiveLength }),
  z.strictObject({ type: z.literal("blind"), depth: PositiveLength }),
]);
export type PinHoles = z.infer<typeof PinHoles>;

/**
 * Locating pins (PRD-0011 B4, #356) on the flip axis, which line the
 * turned-over stock up with the top side: being on the line the stock turns
 * about, their holes land on themselves, so the bottom side keeps the top
 * side's zero (ADR-0060). A drill operation with `params.pins` cuts them.
 */
export const LocatingPins = z.strictObject({
  type: z.literal("pins"),
  diameter: PositiveLength,
  /**
   * Each pin's distance along the flip axis from the stock's centre, so a
   * symmetric pair stays symmetric when the stock is resized. Two at least,
   * to stop the stock turning.
   */
  positions: z.array(z.number()).min(2),
  holes: PinHoles,
});
export type LocatingPins = z.infer<typeof LocatingPins>;

/** A corner of the stock, in the stock coordinates of the side in view. */
export const StockCorner = z.enum(["bottom_left", "bottom_right", "top_left", "top_right"]);
export type StockCorner = z.infer<typeof StockCorner>;

/**
 * Lining the turned-over stock up against its edges (PRD-0011 B9, #361),
 * for users without a spoilboard to drill into: `corner` goes into a fence
 * corner on both sides. Turned over, the stock fills the same footprint, so
 * the zero carries over as far as its size across the flip axis is right.
 */
export const FenceCorner = z.strictObject({ type: z.literal("edges"), corner: StockCorner });
export type FenceCorner = z.infer<typeof FenceCorner>;

/** How the turned-over stock is lined up with the top side: on pins or by a fence corner. */
export const LineUp = z.discriminatedUnion("type", [LocatingPins, FenceCorner]);
export type LineUp = z.infer<typeof LineUp>;

/**
 * A two-sided project's setup (PRD-0011, ADR-0060): the stock is cut from
 * the top, turned over by half a turn about a line through its centre
 * parallel to `flipAxis`, and cut from the other face. Each side cuts down
 * to the parting plane, `partingDepth` below the stock top, which is less
 * than the stock's thickness.
 */
export const TwoSided = z.strictObject({
  flipAxis: FlipAxis,
  partingDepth: PositiveLength,
  /** How the turned-over stock is lined up, or `null` for turning it over in place by eye. */
  lineUp: LineUp.nullable(),
});
export type TwoSided = z.infer<typeof TwoSided>;

/** The stock's locating pins (#356), or `null` unless it is lined up on them. */
export function stockPins({ twoSided }: { twoSided: TwoSided | null }): LocatingPins | null {
  return twoSided?.lineUp?.type === "pins" ? twoSided.lineUp : null;
}

export const Stock = z
  .strictObject({
    width: PositiveLength,
    height: PositiveLength,
    thickness: PositiveLength,
    xyOrigin: XYOrigin,
    zOrigin: ZOrigin,
    /** The touch-off pad, or `null` for none. */
    touchOff: TouchOff.nullable(),
    /** The two-sided setup, or `null` for a project cut from the top only. */
    twoSided: TwoSided.nullable(),
  })
  .superRefine((stock, ctx) => {
    if (stock.twoSided && stock.twoSided.partingDepth >= stock.thickness) {
      ctx.addIssue({
        code: "custom",
        path: ["twoSided", "partingDepth"],
        message: "document.partingBelowStock",
      });
    }
    const holes = stockPins(stock)?.holes;
    if (holes?.type === "blind" && holes.depth >= stock.thickness) {
      ctx.addIssue({
        code: "custom",
        path: ["twoSided", "lineUp", "holes", "depth"],
        message: "document.pinHolesThrough",
      });
    }
    if (stock.touchOff && stock.touchOff.diameter > Math.min(stock.width, stock.height)) {
      ctx.addIssue({
        code: "custom",
        path: ["touchOff", "diameter"],
        message: "document.padOffStock",
      });
    }
  });
export type Stock = z.infer<typeof Stock>;

/**
 * The contents of a project: stored in `Project.document` and used as the
 * export/import file format (ADR-0003). Read stored or imported documents
 * with `parseProjectDocument`, which upgrades older versions first.
 *
 * Objects owned by the document are strict: unknown keys are errors rather
 * than silently dropped, so a misspelt field or an unversioned change fails
 * loudly instead of losing data on the next save.
 */
export const ProjectDocument = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    units: Units,
    stock: Stock,
    /** Snapshot of the machine profile, or `null` if none is picked. */
    machine: Machine.nullable(),
    /** Imported SVG and DXF files and text items, each grouping its shapes in `geometry` (ADR-0055, ADR-0059). */
    drawings: z.array(Drawing),
    geometry: z.array(Shape),
    /** Imported 3D models, whose meshes are project assets (ADR-0029). */
    models: z.array(Model),
    /** Uploaded fonts, project assets as meshes are, for text items to use (ADR-0062). */
    fonts: z.array(ProjectFont).max(MAX_PROJECT_FONTS, "document.tooManyFonts"),
    /** In cutting order. */
    operations: z.array(Operation),
  })
  .superRefine((doc, ctx) => {
    /** Each drawing's number of shapes, by id. */
    const shapeCounts = new Map<string, number>();
    doc.drawings.forEach((drawing, i) => {
      if (shapeCounts.has(drawing.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["drawings", i, "id"],
          message: "document.duplicateDrawing",
        });
      }
      shapeCounts.set(drawing.id, 0);
    });

    /** Each shape's number of paths, by id. */
    const pathCounts = new Map<string, number>();
    doc.geometry.forEach((shape, i) => {
      if (pathCounts.has(shape.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["geometry", i, "id"],
          message: "document.duplicateShape",
        });
      }
      pathCounts.set(shape.id, shape.paths.length);
      const count = shapeCounts.get(shape.drawingId);
      if (count === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["geometry", i, "drawingId"],
          message: "document.unknownDrawing",
        });
      } else {
        shapeCounts.set(shape.drawingId, count + 1);
      }
    });
    doc.drawings.forEach((drawing, i) => {
      const count = shapeCounts.get(drawing.id);
      if (count === 0) {
        ctx.addIssue({ code: "custom", path: ["drawings", i], message: "document.emptyDrawing" });
      } else if (drawing.text && count !== 1) {
        // Its outlines are one shape, which operations target across edits (ADR-0059).
        ctx.addIssue({ code: "custom", path: ["drawings", i], message: "document.textShapes" });
      }
    });

    const fonts = new Set<string>();
    doc.fonts.forEach((font, i) => {
      if (fonts.has(font.sha256)) {
        ctx.addIssue({
          code: "custom",
          path: ["fonts", i, "sha256"],
          message: "document.duplicateFont",
        });
      }
      fonts.add(font.sha256);
    });
    doc.drawings.forEach(({ text }, i) => {
      // A hash names an uploaded font, which the project must hold; anything else a bundled one.
      if (text && Sha256.safeParse(text.font).success && !fonts.has(text.font)) {
        ctx.addIssue({
          code: "custom",
          path: ["drawings", i, "text", "font"],
          message: "document.unknownFont",
        });
      }
    });

    const modelIds = new Set<string>();
    doc.models.forEach((model, i) => {
      if (modelIds.has(model.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["models", i, "id"],
          message: "document.duplicateModel",
        });
      }
      modelIds.add(model.id);
    });

    const operationIds = new Set<string>();
    doc.operations.forEach((operation, i) => {
      if (operationIds.has(operation.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["operations", i, "id"],
          message: "document.duplicateOperation",
        });
      }
      operationIds.add(operation.id);
      if (operation.stockSide === "bottom" && !doc.stock.twoSided) {
        ctx.addIssue({
          code: "custom",
          path: ["operations", i, "stockSide"],
          message: "document.bottomSideOneSided",
        });
      }
      const modelId = operationModelId(operation);
      if (modelId !== null && !modelIds.has(modelId)) {
        ctx.addIssue({
          code: "custom",
          path: ["operations", i, "params", "modelId"],
          message: "document.unknownModel",
        });
      }
      const seen = new Set<string>();
      operation.targets.forEach(({ shapeId, paths }, j) => {
        if (seen.has(shapeId)) {
          ctx.addIssue({
            code: "custom",
            path: ["operations", i, "targets", j, "shapeId"],
            message: "document.duplicateShape",
          });
        }
        seen.add(shapeId);
        const count = pathCounts.get(shapeId);
        if (count === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["operations", i, "targets", j, "shapeId"],
            message: "document.unknownShape",
          });
          return;
        }
        paths?.forEach((path, k) => {
          if (path >= count) {
            ctx.addIssue({
              code: "custom",
              path: ["operations", i, "targets", j, "paths", k],
              message: "document.unknownPath",
            });
          }
        });
      });
    });
  });
export type ProjectDocument = z.infer<typeof ProjectDocument>;

/**
 * The hashes of the project assets `document` references, each once: its
 * models' meshes and its uploaded fonts (ADR-0029, ADR-0062).
 */
export function documentAssetHashes(document: ProjectDocument): string[] {
  const hashes = [...document.models, ...document.fonts].map(({ sha256 }) => sha256);
  return [...new Set(hashes)];
}

/** A new, empty project: 600 × 400 × 18 mm stock, origin at the bottom-left corner of the stock top. */
export function createProjectDocument(): ProjectDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    units: "mm",
    stock: {
      width: 600,
      height: 400,
      thickness: 18,
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
      touchOff: null,
      twoSided: null,
    },
    machine: null,
    drawings: [],
    geometry: [],
    models: [],
    fonts: [],
    operations: [],
  };
}
