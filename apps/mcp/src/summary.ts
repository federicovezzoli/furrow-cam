import { formatQuantity, rotatedSize, shapesBounds } from "@furrow/cam-core";
import type { ProjectDocument, TwoSided } from "@furrow/document";

type Length = (mm: number) => string;

/**
 * What an assistant needs to know of `document` (PRD-0012 M2): lengths in
 * millimetres, as stored, with the stock and zero also written in the
 * project's units, which the app shows.
 */
export function projectSummary(document: ProjectDocument) {
  const { units, stock, machine } = document;
  const length: Length = (mm) => `${formatQuantity(mm, "length", units)} ${units}`;
  const { xyOrigin, twoSided } = stock;
  return {
    units,
    lengths: "Every length is in millimetres and every feed rate in mm/min, whatever the units.",
    stock: {
      ...stock,
      inProjectUnits: {
        size: `${length(stock.width)} × ${length(stock.height)} × ${length(stock.thickness)}`,
        xyOrigin:
          xyOrigin.anchor === "custom"
            ? `${length(xyOrigin.x)}, ${length(xyOrigin.y)} from the stock's bottom-left corner`
            : xyOrigin.anchor,
        ...(twoSided && { twoSided: twoSidedText(twoSided, length) }),
      },
    },
    machine,
    drawings: document.drawings.map(({ id, name, rotation, border, text }) => {
      const shapes = document.geometry.filter((shape) => shape.drawingId === id);
      return {
        id,
        name,
        ...(text && { text }),
        rotation,
        border,
        shapes: shapes.map(({ id, name, layer, paths }) => ({
          id,
          name,
          layer,
          paths: paths.length,
        })),
        /** In stock coordinates: (0, 0) is the stock's bottom-left corner. */
        bounds: shapesBounds(shapes),
      };
    }),
    models: document.models.map(({ id, fileName, triangles, bounds, placement, border }) => {
      const [width, height, depth] = rotatedSize(bounds, placement.rotation);
      return {
        id,
        fileName,
        triangles,
        /**
         * As placed: its outline on the stock, how far its top sits below the
         * stock top, and how far it reaches into the stock from its top.
         */
        size: {
          width: width * placement.scale,
          height: height * placement.scale,
          top: placement.top,
          // A flat mesh keeps a depth it doesn't have.
          depth: depth > 0 ? placement.depth : 0,
        },
        placement,
        border,
      };
    }),
    operations: document.operations,
  };
}

/** A two-sided setup in words, its lengths written by `length`. */
function twoSidedText({ flipAxis, partingDepth, lineUp, tabs }: TwoSided, length: Length) {
  const lined =
    lineUp?.type === "pins"
      ? `${length(lineUp.diameter)} locating pins at ${lineUp.positions.map(length).join(", ")} along ${flipAxis} from the stock's centre`
      : lineUp
        ? `lined up by its ${lineUp.corner.replace("_", "-")} corner in a fence corner`
        : "turned over in place, by eye";
  const held = tabs
    ? `${tabs.positions.length === 1 ? "1 holding tab" : `${tabs.positions.length || "no"} holding tabs`} ${length(tabs.width)} wide, ${length(tabs.thickness)} thick`
    : "no holding tabs";
  return `Turned over about ${flipAxis}, the sides parting ${length(partingDepth)} below the stock top; ${lined}; ${held}.`;
}
