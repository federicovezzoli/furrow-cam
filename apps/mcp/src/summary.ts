import { formatQuantity, shapesBounds } from "@furrow/cam-core";
import type { ProjectDocument } from "@furrow/document";

/**
 * What an assistant needs to know of `document` (PRD-0012 M2): lengths in
 * millimetres, as stored, with the stock and zero also written in the
 * project's units, which the app shows.
 */
export function projectSummary(document: ProjectDocument) {
  const { units, stock, machine } = document;
  const length = (mm: number) => `${formatQuantity(mm, "length", units)} ${units}`;
  const { xyOrigin } = stock;
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
      },
    },
    machine,
    drawings: document.drawings.map(({ id, name, rotation, text }) => {
      const shapes = document.geometry.filter((shape) => shape.drawingId === id);
      return {
        id,
        name,
        ...(text && { text }),
        rotation,
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
    models: document.models.map(({ id, fileName, triangles, placement }) => ({
      id,
      fileName,
      triangles,
      placement,
    })),
    operations: document.operations,
  };
}
