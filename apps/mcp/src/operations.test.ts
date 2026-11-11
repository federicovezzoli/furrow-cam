import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDocument } from "@furrow/document";
import {
  ballEndMill,
  CIRCLE_ID,
  DRAWING_ID,
  drill,
  endMill,
  fullDocument,
  model,
  OPERATION_ID,
  SQUARE_ID,
  vBit,
} from "@furrow/document/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Library } from "./library";
import { addOperation, editOperation, moveTo, removeOperation } from "./operations";
import { createProjects, KEPT_VERSION_LABEL, type Project } from "./projects";

let dir: string;
let project: Project;

const library: Library = {
  tools: [
    { id: "mill", isDefault: true, tool: endMill },
    { id: "v", isDefault: false, tool: vBit },
  ],
  machines: [],
  problems: [],
};

/** Opens `document` as a project file in the test's folder. */
async function open(document: ProjectDocument) {
  const path = join(dir, "Part.furrow.json");
  await writeFile(path, JSON.stringify(document));
  project = await createProjects().get(path);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  await open(fullDocument());
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const document = () => project.store.getState().document;
const operation = (id: string) => document().operations.find((o) => o.id === id);

/** Expects `run` to be refused with a message matching `message`, changing nothing. */
function expectRefused(run: () => unknown, message: RegExp) {
  const before = document();
  expect(run).toThrow(message);
  expect(document()).toBe(before);
  expect(project.versions).toEqual([]);
}

describe("addOperation", () => {
  it("adds a profile of a drawing with the app's defaults and the given settings", () => {
    const id = addOperation(project, library, "profile", {
      targets: [{ drawingId: DRAWING_ID }],
      tool: { toolId: "mill" },
      settings: { side: "inside", tabs: { count: 2, width: 8 } },
    });
    expect(document().operations.at(-1)).toMatchObject({
      id,
      name: "Profile 1",
      enabled: true,
      stockSide: "top",
      targets: [
        { shapeId: SQUARE_ID, paths: null },
        { shapeId: CIRCLE_ID, paths: null },
      ],
      tool: endMill,
      params: {
        side: "inside",
        direction: "climb",
        depth: 18,
        allowance: 0,
        tabs: { width: 8, height: 3 },
      },
    });
    const profile = operation(id);
    const tabs = profile?.type === "profile" ? profile.params.tabs : null;
    expect(tabs?.positions.length).toBeGreaterThanOrEqual(2);
    expect(project.versions).toEqual([expect.objectContaining({ label: KEPT_VERSION_LABEL })]);
  });

  it("adds a pocket of some of a shape's paths, named as asked, with a tool from its settings", () => {
    const id = addOperation(project, library, "pocket", {
      targets: [{ shapeId: SQUARE_ID, paths: [0] }],
      tool: { settings: { ...endMill } },
      name: "Recess",
      settings: { strategy: { type: "linear", angle: 45 }, depth: 5 },
    });
    expect(operation(id)).toMatchObject({
      name: "Recess",
      targets: [{ shapeId: SQUARE_ID, paths: null }],
      params: { strategy: { type: "linear", angle: 45 }, depth: 5, ramp: true, stepOver: 40 },
    });
  });

  it("adds drill operations on placed holes or the locating pins, without shapes", () => {
    const holes = addOperation(project, library, "drill", {
      tool: { settings: { ...drill } },
      settings: { points: [[20, 30]], peck: false },
    });
    expect(operation(holes)).toMatchObject({
      targets: [],
      params: { points: [[20, 30]], peck: false, pins: false, depth: 18 },
    });
    const pins = addOperation(project, library, "drill", {
      tool: { settings: { ...drill } },
      settings: { pins: true },
    });
    expect(operation(pins)).toMatchObject({ targets: [], params: { pins: true } });
  });

  it("adds an engraving at the app's depth", () => {
    const id = addOperation(project, library, "engrave", {
      targets: [{ shapeId: CIRCLE_ID }],
      tool: { toolId: "v" },
    });
    expect(operation(id)).toMatchObject({ type: "engrave", params: { side: "on", depth: 1 } });
  });

  it("adds a V-carve with a flat bottom cleared by a library end mill", () => {
    const id = addOperation(project, library, "vcarve", {
      targets: [{ shapeId: SQUARE_ID }],
      tool: { toolId: "v" },
      settings: { flatBottom: { toolId: "mill" } },
    });
    expect(operation(id)).toMatchObject({
      params: { flatBottom: { tool: endMill, stepOver: 40 } },
    });
  });

  it("adds 3D roughing and finishing on a model", () => {
    // A .furrow.json can't hold a model's mesh, which these don't need.
    project.store
      .getState()
      .load({ ...fullDocument(), drawings: [], geometry: [], operations: [], models: [model] });
    const rough = addOperation(project, library, "relief_rough", {
      modelId: model.id,
      tool: { toolId: "mill" },
    });
    const finish = addOperation(project, library, "relief_finish", {
      modelId: model.id,
      tool: { settings: { ...ballEndMill } },
      settings: { strategy: { type: "waterline", stepDown: 0.5 }, stockToLeave: 0.1 },
    });
    expect(operation(rough)).toMatchObject({
      name: "3D rough 1",
      params: { modelId: model.id, stockToLeave: 0.5 },
    });
    expect(operation(finish)).toMatchObject({
      params: { strategy: { type: "waterline", stepDown: 0.5 }, stockToLeave: 0.1 },
    });
  });

  it("refuses a tool that can't cut the operation, with the app's message", () => {
    const pocket = { targets: [{ shapeId: SQUARE_ID }], tool: { settings: { ...drill } } };
    expectRefused(() => addOperation(project, library, "pocket", pocket), /drill bit/i);
    const vcarve = { targets: [{ shapeId: SQUARE_ID }], tool: { toolId: "mill" } };
    expectRefused(() => addOperation(project, library, "vcarve", vcarve), /V-bit/i);
    const holes = { targets: [{ shapeId: CIRCLE_ID }], tool: { toolId: "v" } };
    expectRefused(() => addOperation(project, library, "drill", holes), /V-bit/i);
  });

  it("refuses settings the app refuses, adding nothing", () => {
    const pocket = {
      targets: [{ shapeId: SQUARE_ID }],
      tool: { toolId: "mill" },
      settings: { finishPass: true },
    };
    expectRefused(() => addOperation(project, library, "pocket", pocket), /allowance/i);
    const unknown = { ...pocket, settings: { speed: 3 } };
    expectRefused(() => addOperation(project, library, "pocket", unknown), /no setting "speed"/);
  });

  it("refuses what it can't target", async () => {
    const tool = { toolId: "mill" };
    expectRefused(
      () => addOperation(project, library, "profile", { targets: [], tool }),
      /at least one shape/,
    );
    expectRefused(
      () => addOperation(project, library, "profile", { targets: [{ shapeId: "nope" }], tool }),
      /no shape "nope"/,
    );
    expectRefused(
      () =>
        addOperation(project, library, "profile", {
          targets: [{ shapeId: SQUARE_ID, paths: [3] }],
          tool,
        }),
      /no path 3/,
    );
    expectRefused(
      () => addOperation(project, library, "drill", { tool: { settings: { ...drill } } }),
      /pins: true/,
    );
    expectRefused(
      () =>
        addOperation(project, library, "drill", {
          tool: { settings: { ...drill } },
          settings: { points: [] },
        }),
      /pins: true/,
    );
    expectRefused(
      () =>
        addOperation(project, library, "drill", {
          tool: { settings: { ...drill } },
          stockSide: "bottom",
          settings: { pins: true },
        }),
      /top-side drill/,
    );
    // Pins would drop shapes or holes asked for in the same call.
    expectRefused(
      () =>
        addOperation(project, library, "drill", {
          targets: [{ shapeId: CIRCLE_ID }],
          tool: { settings: { ...drill } },
          settings: { pins: true },
        }),
      /top-side drill/,
    );
    expectRefused(
      () =>
        addOperation(project, library, "drill", {
          tool: { settings: { ...drill } },
          settings: { pins: true, points: [[10, 10]] },
        }),
      /top-side drill/,
    );
    expectRefused(
      () => addOperation(project, library, "relief_rough", { modelId: "nope", tool }),
      /no model "nope"/,
    );
    await open({ ...fullDocument(), stock: { ...fullDocument().stock, twoSided: null } });
    expectRefused(
      () =>
        addOperation(project, library, "profile", {
          targets: [{ shapeId: SQUARE_ID }],
          tool,
          stockSide: "bottom",
        }),
      /isn't two-sided/,
    );
    expectRefused(
      () =>
        addOperation(project, library, "drill", {
          tool: { settings: { ...drill } },
          settings: { pins: true },
        }),
      /no locating pins/,
    );
  });
});

describe("editOperation", () => {
  it("renames, disables, retargets and changes settings as the properties panel does", () => {
    editOperation(project, library, OPERATION_ID, {
      name: "Cut out",
      enabled: false,
      targets: [{ shapeId: SQUARE_ID }],
      settings: { side: "on", depth: 10, tabs: null },
    });
    expect(operation(OPERATION_ID)).toMatchObject({
      name: "Cut out",
      enabled: false,
      targets: [{ shapeId: SQUARE_ID, paths: null }],
      // On the line clears the allowance, the finishing pass and the overcuts, as the app does.
      params: {
        side: "on",
        depth: 10,
        allowance: 0,
        finishPass: false,
        cornerOvercuts: null,
        tabs: null,
      },
    });
  });

  it("swaps a profile's tabs for plunge points in one call (#427)", () => {
    const startPoints = [{ start: [0, 50], plunge: [-10, 50] }];
    editOperation(project, library, OPERATION_ID, { settings: { tabs: null, startPoints } });
    expect(operation(OPERATION_ID)).toMatchObject({ params: { tabs: null, startPoints } });
  });

  it("keeps tabs: null when the same call cuts on the line", () => {
    const startPoints = [{ start: [0, 50], plunge: [-10, 50] }];
    editOperation(project, library, OPERATION_ID, {
      settings: { side: "on", tabs: null, startPoints },
    });
    expect(operation(OPERATION_ID)).toMatchObject({
      params: { side: "on", tabs: null, startPoints },
    });
  });

  it("changes nothing if the app refuses any of it", () => {
    expectRefused(
      () =>
        editOperation(project, library, OPERATION_ID, {
          name: "Cut out",
          settings: { allowance: 0 },
        }),
      /allowance/i,
    );
    expectRefused(
      () =>
        editOperation(project, library, OPERATION_ID, {
          settings: { tabs: { count: 2, spacing: 5 } },
        }),
      /only one/,
    );
    // The app's message, not Zod's.
    expectRefused(
      () => editOperation(project, library, OPERATION_ID, { settings: { tabs: { count: 0 } } }),
      /^tabs\.count: (?!Too small)/,
    );
    expectRefused(
      () => editOperation(project, library, "nope", { enabled: false }),
      /no operation "nope"/,
    );
  });
});

describe("editOperation on drills", () => {
  it("turns a drill into a pin drill, as the app does, but not into one that drills nothing", () => {
    const id = addOperation(project, library, "drill", {
      targets: [{ shapeId: CIRCLE_ID }],
      tool: { settings: { ...drill } },
    });
    editOperation(project, library, id, { settings: { pins: true } });
    expect(operation(id)).toMatchObject({ targets: [], params: { pins: true, points: [] } });
    const before = document();
    expect(() => editOperation(project, library, id, { settings: { pins: false } })).toThrow(
      /placed holes \(points\) or pins: true/,
    );
    expect(document()).toBe(before);
  });
});

describe("moveTo and removeOperation", () => {
  it("reorders and removes operations", () => {
    const pocket = addOperation(project, library, "pocket", {
      targets: [{ shapeId: SQUARE_ID }],
      tool: { toolId: "mill" },
    });
    moveTo(project, pocket, 0);
    expect(document().operations.map((o) => o.id)).toEqual([pocket, OPERATION_ID]);
    moveTo(project, pocket, 99);
    expect(document().operations.map((o) => o.id)).toEqual([OPERATION_ID, pocket]);
    removeOperation(project, OPERATION_ID);
    expect(document().operations.map((o) => o.id)).toEqual([pocket]);
    expect(() => removeOperation(project, OPERATION_ID)).toThrow(/no operation/);
  });
});
