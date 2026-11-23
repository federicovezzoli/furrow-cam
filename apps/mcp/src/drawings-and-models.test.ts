import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binaryStlSize } from "@furrow/cam-core";
import { DRAWING_ID, endMill, fullDocument, model, OPERATION_ID } from "@furrow/document/fixtures";
import { formatMessage } from "@furrow/ui/lib/i18n";
import { readProjectFile } from "@furrow/workspace/lib/project-file";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  drawingsFromModel,
  duplicate,
  fitToStock,
  importFile,
  mirror,
  move,
  remove,
  resize,
  rotate,
  setTop,
  turn,
} from "./drawings-and-models";
import { addOperation } from "./operations";
import { addPattern } from "./patterns";
import { createProjects, KEPT_VERSION_LABEL, type Project, t } from "./projects";
import { projectSummary } from "./summary";

let dir: string;
let project: Project;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  project = await createProjects().create(join(dir, "Part.furrow"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes `contents` to `name` in the test's folder; returns its path. */
async function file(name: string, contents: string) {
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
}

/** A rectangle `width` × `height` units, in a drawing sized in `unit` (pixels without one). */
function svg(width: number, height: number, unit = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}${unit}" height="${height}${unit}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}"/></svg>`;
}

/** A DXF with one closed square `side` units wide, and no units. */
function dxf(side: number) {
  const corners = [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
  ];
  const vertices = corners.flatMap(([x, y]) => ["10", String(x), "20", String(y)]);
  return [
    ...["0", "SECTION", "2", "ENTITIES"],
    ...["0", "LWPOLYLINE", "8", "0", "90", "4", "70", "1", ...vertices],
    ...["0", "ENDSEC", "0", "EOF", ""],
  ].join("\n");
}

/** An ASCII STL tetrahedron 40 × 30 × 10 mm. */
const TETRAHEDRON = (() => {
  const [a, b, c, d] = ["0 0 0", "40 0 0", "0 30 0", "0 0 10"];
  const facets = [
    [a, c, b],
    [a, b, d],
    [a, d, c],
    [b, c, d],
  ];
  const body = facets
    .map(
      (vertices) =>
        `facet normal 0 0 0\nouter loop\n${vertices.map((v) => `vertex ${v}`).join("\n")}\nendloop\nendfacet`,
    )
    .join("\n");
  return `solid t\n${body}\nendsolid t\n`;
})();

const summary = () => projectSummary(project.store.getState().document);

/** The first drawing's width and height. */
function drawingSize(): [number, number] {
  const bounds = summary().drawings[0]?.bounds;
  if (!bounds) throw new Error("The project has no drawing");
  return [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]];
}

describe("importFile", () => {
  it("imports an SVG sized in millimetres at its size, keeping a version first", async () => {
    project.kept = false;
    const { id, warnings } = await importFile(
      project,
      await file("sign.svg", svg(100, 50, "mm")),
      {},
    );
    expect(warnings).toEqual([]);
    const [drawing] = summary().drawings;
    expect(drawing).toMatchObject({ id, name: "sign.svg" });
    expect(drawingSize()[0]).toBeCloseTo(100);
    expect(project.versions).toEqual([expect.objectContaining({ label: KEPT_VERSION_LABEL })]);
  });

  it("asks for the DPI of an SVG in pixels, and imports it at that DPI", async () => {
    const path = await file("logo.svg", svg(96, 48));
    await expect(importFile(project, path, {})).rejects.toThrow("give its dpi");
    expect(summary().drawings).toEqual([]);
    await importFile(project, path, { dpi: 96 });
    expect(drawingSize()[0]).toBeCloseTo(25.4);
  });

  it("asks for the units of a DXF that doesn't give them", async () => {
    const path = await file("part.dxf", dxf(2));
    await expect(importFile(project, path, {})).rejects.toThrow("give its units");
    await importFile(project, path, { units: "in" });
    expect(drawingSize()[0]).toBeCloseTo(50.8);
  });

  it("imports an STL model, stored with the project", async () => {
    const path = await file("emblem.stl", TETRAHEDRON);
    const { id } = await importFile(project, path, {});
    const [model] = summary().models;
    expect(model).toMatchObject({ id, fileName: "emblem.stl", triangles: 4 });
    await createProjects().save(project);
    const saved = await readProjectFile(new Uint8Array(await readFile(project.path)), t);
    const [stored] = saved.document.models;
    expect(saved.meshes.get(stored?.sha256 ?? "")).toEqual(new TextEncoder().encode(TETRAHEDRON));
  });

  it("imports a STEP model, stored as the STL made from it", async () => {
    const step = await readFile(
      new URL("../../../packages/workspace/src/lib/fixtures/box-with-hole.step", import.meta.url),
      "utf8",
    );
    const { id } = await importFile(project, await file("bracket.stp", step), {});
    const [model] = summary().models;
    expect(model).toMatchObject({ id, fileName: "bracket.stp" });
    const stored = project.store.getState().document.models[0];
    expect(stored?.bounds).toEqual({ min: [0, 0, 0], max: [40, 20, 10] });
    const stl = project.meshes.get(stored?.sha256 ?? "");
    expect(stl?.byteLength).toBe(stored?.size);
    expect(stl?.byteLength).toBe(binaryStlSize(stored?.triangles ?? 0));
  }, 30_000);

  it("keeps a STEP model's faces and makes drawings of its flat levels (#665)", async () => {
    const step = await readFile(
      new URL("../../../packages/workspace/src/lib/fixtures/plate-2.5d.step", import.meta.url),
      "utf8",
    );
    const { id } = await importFile(project, await file("plate.step", step), {});
    const [stored] = project.store.getState().document.models;
    expect(stored?.faces?.reduce((sum, count) => sum + count, 0)).toBe(stored?.triangles);

    const steps = project.store.getState().past.length;
    const drawing = drawingsFromModel(project, id);
    // The pocket is twice as deep as the step, wherever the model was fitted.
    const [top, stepDepth, pocket] = drawing.levels;
    expect(drawing.levels).toHaveLength(3);
    expect(top).toBe(0);
    expect(pocket).toBeCloseTo(2 * (stepDepth ?? 0), 6);
    expect(project.store.getState().past).toHaveLength(steps + 1);

    const { drawings, geometry } = project.store.getState().document;
    expect(drawings.find((d) => d.id === drawing.id)?.name).toBe("plate.step");
    const layers = geometry.filter((s) => s.drawingId === drawing.id).map(({ layer }) => layer);
    expect(layers).toEqual([
      "Z 0 mm",
      expect.stringMatching(/^Z -/),
      expect.any(String),
      "Outline",
    ]);

    expect(() => drawingsFromModel(project, drawing.id)).toThrow("Only a model");
  }, 30_000);

  it("refuses a STEP file it can't read with the app's message", async () => {
    await expect(
      importFile(project, await file("broken.step", "ISO-10303-21;\nnonsense"), {}),
    ).rejects.toThrow(formatMessage(t, { code: "workspace.stepUnreadable" }));
  }, 30_000);

  it("takes several models beside drawings (#596)", async () => {
    await importFile(project, await file("sign.svg", svg(100, 50, "mm")), {});
    await importFile(project, await file("emblem.stl", TETRAHEDRON), {});
    await importFile(project, await file("relief.stl", TETRAHEDRON), {});
    expect(summary().models.map(({ fileName }) => fileName)).toEqual(["emblem.stl", "relief.stl"]);
  });

  it("refuses other files with a message", async () => {
    await expect(importFile(project, "sign.svg", {})).rejects.toThrow("absolute path");
    await expect(importFile(project, await file("a.png", ""), {})).rejects.toThrow(
      "isn't an SVG, DXF, STL or STEP file",
    );
    await expect(importFile(project, join(dir, "missing.svg"), {})).rejects.toThrow("Can't read");
    await mkdir(join(dir, "folder.svg"));
    await expect(importFile(project, join(dir, "folder.svg"), {})).rejects.toThrow("Can't read");
    await expect(importFile(project, await file("empty.svg", "<svg"), {})).rejects.toThrow();
  });
});

describe("fitToStock and resize", () => {
  it("resizes a drawing, keeping its proportions, and fits it to the stock", async () => {
    const { id } = await importFile(project, await file("sign.svg", svg(100, 50, "mm")), {});
    resize(project, id, "width", 200);
    expect(drawingSize()[1]).toBeCloseTo(100);
    expect(() => resize(project, id, "depth", 5)).toThrow("no depth");
    fitToStock(project, id);
    // 600 × 400 mm stock less a 10 mm border: the width is the limit.
    expect(drawingSize()[0]).toBeCloseTo(580);
  });

  it("resizes a model's outline and depth, and fits it to the stock", async () => {
    const { id } = await importFile(project, await file("emblem.stl", TETRAHEDRON), {});
    resize(project, id, "width", 80);
    expect(summary().models[0]?.size).toMatchObject({ width: 80, height: 60 });
    resize(project, id, "depth", 5);
    expect(summary().models[0]?.size.depth).toBeCloseTo(5);
    fitToStock(project, id);
    expect(summary().models[0]?.size.height).toBeCloseTo(380);
  });

  it("sinks a model below the stock top, keeping its size", async () => {
    const { id } = await importFile(project, await file("emblem.stl", TETRAHEDRON), {});
    const before = summary().models[0]?.size;
    setTop(project, id, 2.5);
    expect(summary().models[0]?.size).toEqual({ ...before, top: 2.5 });
  });

  it("turns a model in quarter turns as one change", async () => {
    const { id } = await importFile(project, await file("emblem.stl", TETRAHEDRON), {});
    const model = () => summary().models[0];
    const { width, height, depth } = model()?.size ?? {};
    turn(project, id, "x", 1);
    // About X, the height and depth swap.
    expect(model()?.size).toMatchObject({ width, height: depth, depth: height });
    expect(model()?.placement.rotation).toEqual([90, 0, 0]);
    const steps = project.store.getState().past.length;
    turn(project, id, "z", 3);
    expect(project.store.getState().past).toHaveLength(steps + 1);
    expect(model()?.placement.rotation).toEqual([90, 0, 270]);
    // A half turn about Z leaves the size as it was.
    const before = model()?.size;
    turn(project, id, "z", 2);
    expect(model()?.placement.rotation).toEqual([90, 0, 90]);
    expect(model()?.size).toEqual(before);
  });

  it("refuses to turn a drawing or an unknown id", async () => {
    const drawing = await importFile(project, await file("square.svg", svg(10, 10, "mm")), {});
    expect(() => turn(project, drawing.id, "z", 1)).toThrow("only a model");
    expect(() => turn(project, "nope", "z", 1)).toThrow("no drawing or model");
  });

  it("refuses to sink a drawing", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
    const drawing = await importFile(project, await file("square.svg", svg), {});
    expect(() => setTop(project, drawing.id, 1)).toThrow("no top");
  });

  it("refuses sizes a drawing or model doesn't have", async () => {
    const line = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="10mm" viewBox="0 0 100 10"><path d="M0 5H100" stroke="black"/></svg>`;
    const { id } = await importFile(project, await file("line.svg", line), {});
    expect(() => resize(project, id, "height", 50)).toThrow("no height");
    resize(project, id, "width", 50);
    expect(drawingSize()[0]).toBeCloseTo(50);
  });

  it("gives a flat model no depth, and refuses to set one", async () => {
    const flat = `solid f\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 40 0 0\nvertex 0 30 0\nendloop\nendfacet\nendsolid f\n`;
    const { id } = await importFile(project, await file("flat.stl", flat), {});
    expect(summary().models[0]?.size.depth).toBe(0);
    expect(() => resize(project, id, "depth", 5)).toThrow("flat");
  });

  it("refuses an id the project doesn't have", () => {
    expect(() => fitToStock(project, "nope")).toThrow("no drawing or model");
  });
});

describe("move, rotate, mirror, duplicate and remove", () => {
  const bounds = (id: string) => summary().drawings.find((d) => d.id === id)?.bounds;

  it("moves a drawing and a model by an offset", async () => {
    const drawing = await importFile(project, await file("sign.svg", svg(100, 50, "mm")), {});
    const before = bounds(drawing.id);
    move(project, drawing.id, [15, -5]);
    expect(bounds(drawing.id)?.min).toEqual([
      (before?.min[0] as number) + 15,
      (before?.min[1] as number) - 5,
    ]);

    const model = await importFile(project, await file("emblem.stl", TETRAHEDRON), {});
    const position = () => project.store.getState().document.models[0]?.placement.position;
    const [x, y] = position() ?? [0, 0];
    const steps = project.store.getState().past.length;
    move(project, model.id, [20, 30]);
    expect(position()?.[0]).toBeCloseTo(x + 20);
    expect(position()?.[1]).toBeCloseTo(y + 30);
    expect(project.store.getState().past).toHaveLength(steps + 1);
  });

  it("rotates and mirrors a drawing", async () => {
    const { id } = await importFile(project, await file("sign.svg", svg(100, 50, "mm")), {});
    rotate(project, id, 90);
    expect(drawingSize()[0]).toBeCloseTo(50);
    expect(drawingSize()[1]).toBeCloseTo(100);
    expect(summary().drawings[0]?.rotation).toBe(90);
    mirror(project, id, "x");
    expect(summary().drawings[0]?.rotation).toBe(-90);
  });

  it("refuses to rotate, mirror or duplicate a model, or to move a pattern", async () => {
    const model = await importFile(project, await file("emblem.stl", TETRAHEDRON), {});
    expect(() => rotate(project, model.id, 90)).toThrow("only a drawing");
    expect(() => mirror(project, model.id, "x")).toThrow("only a drawing");
    expect(() => duplicate(project, model.id)).toThrow("only a drawing");
    const drawing = await importFile(project, await file("panel.svg", svg(100, 100, "mm")), {});
    const pattern = addPattern(project, { targets: [{ drawingId: drawing.id }] });
    expect(() => move(project, pattern.drawingId, [1, 1])).toThrow("follows the drawing it fills");
    expect(() => remove(project, "nope")).toThrow("no drawing or model");
  });

  it("duplicates a drawing with the operations that machine it, and removes it as the app does", async () => {
    const path = join(dir, "Full.furrow.json");
    await writeFile(path, JSON.stringify(fullDocument()));
    project = await createProjects().get(path);
    const copy = duplicate(project, DRAWING_ID);
    expect(project.versions).toEqual([expect.objectContaining({ label: KEPT_VERSION_LABEL })]);
    const { operations } = project.store.getState().document;
    expect(summary().drawings.map((d) => d.id)).toEqual([DRAWING_ID, copy]);
    expect(operations.find((o) => o.id === OPERATION_ID)?.targets).toHaveLength(4);
    remove(project, copy);
    expect(project.store.getState().document.operations[0]?.targets).toHaveLength(2);
    // The operation's last targets go, and the operation with them.
    remove(project, DRAWING_ID);
    expect(project.store.getState().document).toMatchObject({ drawings: [], operations: [] });
  });

  it("removes a model with its operations, keeping another model's", () => {
    const other = { ...model, id: "a7b6c5d4-e3f2-4a1b-9c8d-7e6f5a4b3c2d" };
    // A .furrow.json can't hold a model's mesh, which these don't need.
    project.store.getState().load({ ...fullDocument(), operations: [], models: [model, other] });
    const library = {
      tools: [{ id: "mill", isDefault: true, tool: endMill }],
      machines: [],
      problems: [],
    };
    for (const { id } of [model, other]) {
      addOperation(project, library, "relief_rough", { modelId: id, tool: { toolId: "mill" } });
    }
    remove(project, model.id);
    const { models, operations } = project.store.getState().document;
    expect(models.map((m) => m.id)).toEqual([other.id]);
    expect(operations).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ modelId: other.id }) }),
    ]);
  });

  it("moves a model's holding tabs with it, even past another model", () => {
    // B's left edge is where A's right edge lands after the X part of the move alone.
    const b = { ...model, id: "a7b6c5d4-e3f2-4a1b-9c8d-7e6f5a4b3c2d" };
    b.placement = { ...model.placement, position: [130, 0] };
    const document = fullDocument();
    if (document.stock.tabs) document.stock.tabs.positions = [[100, 40]];
    project.store.getState().load({ ...document, operations: [], models: [b, model] });
    move(project, model.id, [30, 100]);
    const [tab] = project.store.getState().document.stock.tabs?.positions ?? [];
    expect(tab?.[0]).toBeCloseTo(130);
    expect(tab?.[1]).toBeCloseTo(140);
  });
});
