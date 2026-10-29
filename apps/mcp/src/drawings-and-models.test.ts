import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMessage } from "@furrow/ui/lib/i18n";
import { readProjectFile } from "@furrow/workspace/lib/project-file";
import { DRAWINGS_OR_MODEL } from "@furrow/workspace/stores/geometry-actions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fitToStock, importFile, resize } from "./drawings-and-models";
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

  it("refuses drawings and a model in one project with the app's message", async () => {
    await importFile(project, await file("sign.svg", svg(100, 50, "mm")), {});
    await expect(importFile(project, await file("emblem.stl", TETRAHEDRON), {})).rejects.toThrow(
      formatMessage(t, DRAWINGS_OR_MODEL),
    );
  });

  it("refuses other files with a message", async () => {
    await expect(importFile(project, "sign.svg", {})).rejects.toThrow("absolute path");
    await expect(importFile(project, await file("a.png", ""), {})).rejects.toThrow(
      "isn't an SVG, DXF or STL file",
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
