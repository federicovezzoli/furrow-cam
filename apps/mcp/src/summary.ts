import { formatQuantity, rotatedSize, shapesBounds } from "@furrow/cam-core";
import type { HoldingTabs, ProjectDocument, TwoSided } from "@furrow/document";

type Length = (mm: number) => string;

/**
 * What an assistant needs to know of `document` (PRD-0012 M2): lengths in
 * millimetres, as stored, with the stock and zero also written in the
 * project's units, which the app shows.
 */
export function projectSummary(document: ProjectDocument) {
  const { units, stock, machine } = document;
  const length: Length = (mm) => `${formatQuantity(mm, "length", units)} ${units}`;
  const { xyOrigin, twoSided, tabs } = stock;
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
        // Only 3D operations leave them, so a drawings-only project doesn't mention them.
        ...((tabs || document.models.length > 0) && {
          tabs: tabs ? tabsText(tabs, length) : "no holding tabs",
        }),
      },
    },
    machine,
    // Hidden objects aren't cut, locked ones aren't picked in the app (ADR-0080); flags only when set.
    drawings: document.drawings.map(
      ({ id, name, rotation, border, text, pattern, hidden, locked }) => {
        const shapes = document.geometry.filter((shape) => shape.drawingId === id);
        return {
          id,
          name,
          ...(text && { text }),
          // Its settings; its cells are its one shape, generated inside `boundary` (ADR-0087).
          ...(pattern && { pattern }),
          rotation,
          border,
          ...(hidden && { hidden }),
          ...(locked && { locked }),
          shapes: shapes.map(({ id, name, layer, paths, hidden, locked }) => ({
            id,
            name,
            layer,
            paths: paths.length,
            ...(hidden && { hidden }),
            ...(locked && { locked }),
          })),
          /** In stock coordinates: (0, 0) is the stock's bottom-left corner. */
          bounds: shapesBounds(shapes),
        };
      },
    ),
    models: document.models.map(
      ({ id, fileName, triangles, bounds, placement, border, hidden, locked }) => {
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
          ...(hidden && { hidden }),
          ...(locked && { locked }),
        };
      },
    ),
    operations: document.operations,
  };
}

/** A two-sided setup in words, its lengths written by `length`. */
function twoSidedText({ flipAxis, partingDepth, lineUp }: TwoSided, length: Length) {
  const lined =
    lineUp?.type === "pins"
      ? `${length(lineUp.diameter)} locating pins at ${lineUp.positions.map(length).join(", ")} along ${flipAxis} from the stock's centre`
      : lineUp
        ? `lined up by its ${lineUp.corner.replace("_", "-")} corner in a fence corner`
        : "turned over in place, by eye";
  return `Turned over about ${flipAxis}, the sides parting ${length(partingDepth)} below the stock top; ${lined}.`;
}

/** Holding tabs in words, their lengths written by `length`. */
function tabsText({ positions, width, thickness, fullHeight }: HoldingTabs, length: Length) {
  const count = positions.length === 1 ? "1 holding tab" : `${positions.length} holding tabs`;
  return `${count} ${length(width)} wide, ${fullHeight ? "the stock's whole thickness" : `${length(thickness)} thick`}.`;
}
