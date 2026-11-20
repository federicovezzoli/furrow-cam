import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectDocument } from "@furrow/document";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importFile } from "./drawings-and-models";
import { addPattern } from "./patterns";
import { createProjects, KEPT_VERSION_LABEL, type Project, ToolError } from "./projects";
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

/** Imports an SVG in millimetres holding `body`; returns its drawing's id. */
async function drawing(body: string): Promise<string> {
  const path = join(dir, "frame.svg");
  await writeFile(
    path,
    `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">${body}</svg>`,
  );
  return (await importFile(project, path, {})).id;
}

/** A 100 × 80 mm frame with a 40 × 30 mm hole. */
const FRAME = '<path d="M0 0H100V80H0Z M30 25H70V55H30Z"/>';

const document = () => project.store.getState().document;

describe("addPattern", () => {
  it("fills a drawing with the app's default pattern, keeping a version first", async () => {
    const drawingId = await drawing(FRAME);
    project.kept = false;
    const { drawingId: id, cells } = addPattern(project, { targets: [{ drawingId }] });
    expect(cells).toBeGreaterThan(20);
    const summary = projectSummary(document()).drawings.find((d) => d.id === id);
    expect(summary).toMatchObject({
      name: "Pattern",
      pattern: { cell: "hexagon", size: 10, gap: 1, inset: 0, placement: { rotation: 0 } },
      shapes: [{ paths: cells }],
    });
    expect(ProjectDocument.parse(document())).toEqual(document());
    expect(project.versions).toEqual([expect.objectContaining({ label: KEPT_VERSION_LABEL })]);
  });

  it("takes the settings given, the origin offset from the boundary's corner", async () => {
    const drawingId = await drawing(FRAME);
    const corner = projectSummary(document()).drawings[0]?.bounds?.min ?? [0, 0];
    const { drawingId: id, cells } = addPattern(project, {
      targets: [{ drawingId }],
      name: "Grid",
      cell: "square",
      size: 10,
      gap: 0,
      rotation: -90,
      offset: [5, 0],
    });
    // 10 mm squares over 100 × 80 less 40 × 30, some cut in half by the 5 mm offset.
    expect(cells).toBeGreaterThan(80 - 12);
    const pattern = document().drawings.find((d) => d.id === id)?.pattern;
    expect(pattern?.placement).toEqual({
      position: [corner[0] + 5, corner[1]],
      rotation: 270,
      mirrored: false,
    });
  });

  it("refuses what the app refuses, with its message, changing nothing", async () => {
    const drawingId = await drawing('<path d="M0 0L100 80" stroke="black" fill="none"/>');
    const before = document();
    expect(() => addPattern(project, { targets: [{ drawingId }] })).toThrow(
      new ToolError("The selection has no closed path to fill."),
    );
    const frame = await drawing(FRAME);
    expect(() => addPattern(project, { targets: [{ drawingId: frame }], size: 0 })).toThrow(
      ToolError,
    );
    expect(() => addPattern(project, { targets: [{ drawingId: frame }], inset: 50 })).toThrow(
      new ToolError("No cell fits inside the boundary: make the cells or the inset smaller."),
    );
    expect(document().drawings.some((d) => d.pattern)).toBe(false);
    expect(before.drawings).toHaveLength(1);
  });
});
