import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  drill,
  endMill,
  fullDocument,
  machine,
  OPERATION_ID,
  vBit,
} from "@furrow/document/fixtures";
import { formatMessage } from "@furrow/ui/lib/i18n";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Library } from "./library";
import { createProjects, KEPT_VERSION_LABEL, type Project, t } from "./projects";
import { chooseMachine, setStock, setToolOf, setTouchOff, setZero } from "./setup";

let dir: string;
let project: Project;

const library: Library = {
  tools: [{ id: "t1", isDefault: true, tool: vBit }],
  machines: [{ id: "m1", machine }],
  problems: [],
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  const path = join(dir, "Part.furrow.json");
  // One-sided, with no pad, so each setting starts from the app's defaults.
  const document = fullDocument();
  document.stock = { ...document.stock, touchOff: null, twoSided: null };
  await writeFile(path, JSON.stringify(document));
  project = await createProjects().get(path);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const document = () => project.store.getState().document;

describe("setStock", () => {
  it("sets the units and the stock's size, keeping a version first", () => {
    setStock(project, { units: "mm", width: 500, thickness: 12 });
    expect(document().units).toBe("mm");
    expect(document().stock).toMatchObject({ width: 500, height: 200, thickness: 12 });
    expect(project.versions).toEqual([expect.objectContaining({ label: KEPT_VERSION_LABEL })]);
  });
});

describe("setZero", () => {
  it("puts the XY zero on an anchor or a custom point, and sets the Z zero", () => {
    setZero(project, { xy: "bottom_left", z: "stock_top" });
    expect(document().stock).toMatchObject({
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
    });
    setZero(project, { xy: [-10, 5] });
    expect(document().stock.xyOrigin).toEqual({ anchor: "custom", x: -10, y: 5 });
  });
});

describe("setTouchOff", () => {
  it("adds, moves and removes the pad", () => {
    setTouchOff(project, { pad: true, x: 20, y: 30, diameter: 12 });
    expect(document().stock.touchOff).toMatchObject({ x: 20, y: 30, diameter: 12 });
    setTouchOff(project, { pad: false });
    expect(document().stock.touchOff).toBeNull();
  });

  it("refuses a pad wider than the stock with the app's message, changing nothing", () => {
    expect(() => setTouchOff(project, { pad: true, diameter: 250 })).toThrow(
      formatMessage(t, { code: "document.padOffStock" }),
    );
    expect(document().stock.touchOff).toBeNull();
  });
});

describe("chooseMachine", () => {
  it("snapshots a library machine, and refuses an unknown one", () => {
    const edited = { ...library, machines: [{ id: "m1", machine: { ...machine, name: "Mine" } }] };
    chooseMachine(project, edited, "m1");
    expect(document().machine?.name).toBe("Mine");
    expect(() => chooseMachine(project, library, "nope")).toThrow("no machine");
  });
});

describe("setToolOf", () => {
  it("snapshots a library tool or given settings into an operation", () => {
    setToolOf(project, library, OPERATION_ID, { toolId: "t1" });
    expect(document().operations[0]?.tool).toEqual(vBit);
    setToolOf(project, library, OPERATION_ID, { settings: { ...endMill, name: "Given" } });
    expect(document().operations[0]?.tool.name).toBe("Given");
  });

  it("refuses settings the tool schema refuses, with the field and the app's message", () => {
    expect(() =>
      setToolOf(project, library, OPERATION_ID, {
        settings: { ...endMill, cutDirection: null },
      }),
    ).toThrow(`cutDirection: ${formatMessage(t, { code: "tool.cutDirectionRequired" })}`);
  });

  it("refuses a tool the operation can't cut with, and unknown ids", () => {
    expect(() => setToolOf(project, library, OPERATION_ID, { settings: drill })).toThrow();
    expect(document().operations[0]?.tool).toEqual(fullDocument().operations[0]?.tool);
    expect(() => setToolOf(project, library, OPERATION_ID, { toolId: "nope" })).toThrow("no tool");
    expect(() => setToolOf(project, library, "nope", { toolId: "t1" })).toThrow("no operation");
    expect(() => setToolOf(project, library, OPERATION_ID, {})).toThrow("Give");
  });
});
