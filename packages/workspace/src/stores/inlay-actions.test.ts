import {
  anchorPoint,
  mapShapes,
  mirrorPoint,
  shapesBounds,
  translateShapes,
} from "@furrow/cam-core";
import { ProjectDocument, type VCarveOperation } from "@furrow/document";
import { endMill, fullDocument, SQUARE_ID, square, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { makeInlay, type NewInlay } from "./inlay-actions";

const inlay: NewInlay = {
  targets: [{ shapeId: SQUARE_ID, paths: null }],
  tool: vBit,
  flatTool: endMill,
  depth: 5,
  gap: 1,
  stockSide: "top",
  names: { pocket: "Inlay pocket", plug: "Inlay plug", drawing: "Plug" },
};

describe("makeInlay", () => {
  it("adds the pocket, and the plug on a mirrored copy inside a boundary, in one undo step", () => {
    const store = createDocumentStore(fullDocument());
    const before = store.getState().document;
    const result = makeInlay(store, inlay);
    expect(result).toMatchObject({ ok: true });
    const doc = store.getState().document;
    expect(ProjectDocument.safeParse(doc).success).toBe(true);

    const drawing = doc.drawings.at(-1);
    expect(drawing).toMatchObject({ name: "Plug", border: 10, rotation: 0 });
    const added = doc.geometry.slice(before.geometry.length);
    expect(added.every((shape) => shape.drawingId === drawing?.id)).toBe(true);
    const [copy, boundary] = added;
    if (!copy || !boundary) throw new Error("no plug geometry");

    // The copy is the square mirrored, to the right of the boundary's room round the original.
    const bounds = shapesBounds([square]);
    const copyBounds = shapesBounds([copy]);
    if (!bounds || !copyBounds) throw new Error("no bounds");
    const dx = copyBounds.min[0] - bounds.min[0];
    expect(dx).toBeGreaterThan(bounds.max[0] - bounds.min[0]);
    const centre = anchorPoint(bounds, "center");
    const mirrored = mapShapes([square], (p) => mirrorPoint(p, "x", centre), true);
    expect(copy.paths).toEqual(translateShapes(mirrored, [dx, 0])[0]?.paths);
    // The boundary is round it, clear of the original.
    const around = shapesBounds([boundary]);
    if (!around) throw new Error("no boundary");
    expect(around.min[0]).toBeGreaterThan(bounds.max[0]);
    expect(around.min[0]).toBeLessThan(copyBounds.min[0]);
    expect(around.max[1]).toBeGreaterThan(copyBounds.max[1]);

    const [pocket, plug] = doc.operations.slice(before.operations.length) as VCarveOperation[];
    expect(result).toEqual({ ok: true, id: pocket?.id });
    expect(pocket).toMatchObject({
      name: "Inlay pocket 1",
      targets: [{ shapeId: SQUARE_ID, paths: null }],
      params: { startDepth: 0, maxDepth: 5, flatBottom: { tool: endMill } },
    });
    expect(plug).toMatchObject({
      name: "Inlay plug 1",
      targets: [
        { shapeId: copy.id, paths: null },
        { shapeId: boundary.id, paths: null },
      ],
      params: { startDepth: 4, flatBottom: { tool: endMill } },
    });
    // Only down to the 60° bit's cone, 3.175 / tan 30° deep: no cone warning.
    const cone = 3.175 / Math.tan(Math.PI / 6);
    expect(plug?.params.maxDepth).toBeCloseTo(cone - 4, 9);

    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("refuses open paths only, a gap outside the depth, and a pocket or plug too deep", () => {
    const doc = fullDocument();
    const line = { ...square, paths: square.paths.map((path) => ({ ...path, closed: false })) };
    doc.geometry = doc.geometry.map((shape) => (shape.id === SQUARE_ID ? line : shape));
    const open = createDocumentStore(doc);
    for (const targets of [[], inlay.targets]) {
      expect(makeInlay(open, { ...inlay, targets })).toEqual({
        ok: false,
        error: { code: "workspace.inlayClosedPaths" },
      });
    }
    expect(open.getState().document).toBe(doc);

    const store = createDocumentStore(fullDocument());
    const before = store.getState().document;
    for (const gap of [-1, 5]) {
      expect(makeInlay(store, { ...inlay, gap })).toEqual({
        ok: false,
        error: { code: "workspace.inlayGap" },
      });
    }
    // Past the 5.5 mm cone; and in 5 mm stock, a plug whose floor is the cone, past it, unless 2 · depth - 1 ≤ 5.
    const tooDeep = { ok: false, error: { code: "workspace.inlayTooDeep" } };
    expect(makeInlay(store, { ...inlay, depth: 5.6 })).toEqual(tooDeep);
    const thin = createDocumentStore(fullDocument());
    thin.getState().change("thin", (draft) => {
      draft.stock.thickness = 5;
    });
    expect(makeInlay(thin, inlay)).toEqual(tooDeep);
    expect(makeInlay(thin, { ...inlay, depth: 3.1 })).toEqual(tooDeep);
    expect(makeInlay(thin, { ...inlay, depth: 3 })).toMatchObject({ ok: true });
    expect(store.getState().document).toBe(before);
  });
});
