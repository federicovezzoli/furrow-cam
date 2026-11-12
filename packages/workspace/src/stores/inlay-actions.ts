import {
  anchorPoint,
  mapShapes,
  mirrorPoint,
  shapesBounds,
  targetedShapes,
  translateShapes,
  vBitConeDepth,
  vBitLineWidth,
} from "@furrow/cam-core";
import {
  DRAWING_BORDER,
  issueMessage,
  normalizeTargets,
  type OperationTarget,
  type Path,
  type Point,
  type Shape,
  type StockSide,
  type Tool,
  VCarveOperation,
} from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { track } from "../lib/telemetry";
import type { DocumentStore } from "./document-store";
import { copyShapes, DUPLICATE_GAP } from "./geometry-actions";
import { DEFAULT_STEP_OVER, nextName } from "./operation-actions";

export type NewInlay = {
  /** The paths the pocket carves; the plug is carved from their mirror image. Open paths are left out. */
  targets: OperationTarget[];
  /** The V-bit carving both parts. */
  tool: Tool;
  /** The flat end mill clearing their floors: the plug's waste is wider than the V-bit reaches. */
  flatTool: Tool;
  /** How deep the pocket is, and how far the plug's floor goes under where it starts. */
  depth: number;
  /** The glue gap under the plug once it sits in the pocket. */
  gap: number;
  stockSide: StockSide;
  /** The operations' names, numbered, and the plug's drawing's. */
  names: { pocket: string; plug: string; drawing: string };
};

const NO_CLOSED_PATHS = { code: "workspace.inlayClosedPaths" } as const;
const GAP_RANGE = { code: "workspace.inlayGap" } as const;
const TOO_DEEP = { code: "workspace.inlayTooDeep" } as const;

/**
 * The deepest pocket an inlay with `gap` can have: no deeper than the V-bit's
 * cone, below which its shank cuts straight walls, and with the plug's floor,
 * at `2 · depth - gap` or the cone, inside the stock.
 */
export function inlayMaxDepth(tool: Tool, thickness: number, gap: number): number {
  const cone = vBitConeDepth(tool) ?? 0;
  return cone <= thickness ? cone : Math.min(cone, (thickness + gap) / 2);
}

/**
 * Makes a V-carve inlay (#553, ADR-0084) as one undo step: a V-carve pocket
 * of the closed paths of `targets`, `depth` deep with a flat bottom, and a
 * plug that fits it, upside down, with `gap` left under it. The plug is
 * carved from a mirrored copy of the paths, a new drawing to the right of
 * them with a rectangle round them: the V-carve of both, starting `depth -
 * gap` down, carves the area between them and leaves the plug standing.
 * Refuses a pocket deeper than `inlayMaxDepth`. Returns the pocket's id.
 */
export function makeInlay(
  store: DocumentStore,
  { targets, tool, flatTool, depth, gap, stockSide, names }: NewInlay,
): { ok: true; id: string } | { ok: false; error: Translatable } {
  if (!(gap >= 0 && gap < depth)) return { ok: false, error: GAP_RANGE };
  const { document } = store.getState();
  if (depth > inlayMaxDepth(tool, document.stock.thickness, gap) + 1e-9) {
    return { ok: false, error: TOO_DEEP };
  }
  const byId = new Map(document.geometry.map((shape) => [shape.id, shape]));
  const closed = targetedShapes(byId, normalizeTargets(document.geometry, targets)).flatMap(
    (shape) => {
      const paths = shape.paths.filter((path) => path.closed && path.segments.length > 0);
      return paths.length > 0 ? [{ ...shape, paths }] : [];
    },
  );
  const bounds = shapesBounds(closed);
  if (!bounds) return { ok: false, error: NO_CLOSED_PATHS };

  // The plug's floor between its walls and the boundary's is DRAWING_BORDER wider than the end mill.
  const reach = (vBitLineWidth(tool, depth) ?? 0) / 2;
  const margin = 2 * reach + flatTool.diameter + DRAWING_BORDER;
  const centre = anchorPoint(bounds, "center");
  const offset: Point = [bounds.max[0] - bounds.min[0] + 2 * margin + DUPLICATE_GAP, 0];
  const mirrored = mapShapes(closed, (point) => mirrorPoint(point, "x", centre), true);
  const drawingId = crypto.randomUUID();
  const layer = closed[0]?.layer ?? "0";
  const copies = copyShapes(translateShapes(mirrored, offset), drawingId);
  const [x0, y0] = [bounds.min[0] - margin + offset[0], bounds.min[1] - margin];
  const [x1, y1] = [bounds.max[0] + margin + offset[0], bounds.max[1] + margin];
  const boundary: Path = {
    start: [x0, y0],
    segments: [
      { kind: "line", to: [x1, y0] },
      { kind: "line", to: [x1, y1] },
      { kind: "line", to: [x0, y1] },
    ],
    closed: true,
  };
  const boundaryShape: Shape = {
    id: crypto.randomUUID(),
    name: "",
    layer,
    drawingId,
    paths: [boundary],
  };

  const flatBottom = { tool: flatTool, stepOver: DEFAULT_STEP_OVER };
  const vcarve = (
    name: string,
    operationTargets: OperationTarget[],
    startDepth: number,
    maxDepth: number,
  ): VCarveOperation => ({
    id: crypto.randomUUID(),
    type: "vcarve",
    name,
    enabled: true,
    stockSide,
    targets: operationTargets,
    tool,
    params: { startDepth, maxDepth, flatBottom },
  });
  const pocketName = nextName(document, names.pocket);
  const pocket = vcarve(
    pocketName,
    closed.map((shape) => ({
      shapeId: shape.id,
      paths:
        shape.paths.length === byId.get(shape.id)?.paths.length ? null : pathIndices(byId, shape),
    })),
    0,
    depth,
  );
  const plugName = nextName(
    { ...document, operations: [...document.operations, pocket] },
    names.plug,
  );
  const plug = vcarve(
    plugName,
    [...copies, boundaryShape].map((shape) => ({ shapeId: shape.id, paths: null })),
    depth - gap,
    // Down to the cone at most, as the toolpath would stop anyway, so the plug doesn't warn.
    Math.min(depth, (vBitConeDepth(tool) ?? depth) - (depth - gap)),
  );
  for (const operation of [pocket, plug]) {
    const parsed = VCarveOperation.safeParse(operation);
    const [issue] = parsed.error?.issues ?? [];
    if (issue) return { ok: false, error: issueMessage(issue) };
  }

  // One assignment, not a spread push, as on import.
  const geometry = document.geometry.concat(copies, [boundaryShape]);
  store.getState().change("makeInlay", (draft) => {
    draft.drawings.push({
      id: drawingId,
      name: names.drawing,
      border: DRAWING_BORDER,
      rotation: 0,
    });
    draft.geometry = geometry;
    draft.operations.push(pocket, plug);
  });
  for (const { type } of [pocket, plug]) track({ event: "operation_added", type });
  return { ok: true, id: pocket.id };
}

/** The indices in its shape in the document of the paths `shape` kept. */
function pathIndices(byId: ReadonlyMap<string, Shape>, shape: Shape): number[] {
  const all = byId.get(shape.id)?.paths ?? [];
  return shape.paths.map((path) => all.indexOf(path));
}
