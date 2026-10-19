import { NEW_MACHINE_DEFAULTS } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL } from "../tools/lib/tool-form-data";
import {
  deleteMachine,
  deleteTool,
  parseMachines,
  parseSettings,
  parseTools,
  saveMachine,
  saveTool,
  setDefaultTool,
} from "./local-library";

/** The tool form's fields for `tool`, as the browser submits them. */
function toolForm(tool: Record<string, unknown>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(tool)) {
    if (value !== null && value !== undefined) form.set(key, String(value));
  }
  return form;
}

describe("tools", () => {
  it("seeds the default bit on the first start, and nothing once the library exists", () => {
    expect(parseTools(null)).toMatchObject([{ isDefault: true, tool: DEFAULT_TOOL }]);
    expect(parseTools([])).toEqual([]);
  });

  it("leaves out stored tools that fail today's rules", () => {
    const tools = parseTools([
      { id: "a", isDefault: true, tool: DEFAULT_TOOL },
      { id: "b", tool: { ...DEFAULT_TOOL, diameter: -1 } },
      "junk",
    ]);
    expect(tools.map((t) => t.id)).toEqual(["a"]);
  });

  it("adds, edits, defaults and deletes bits, by name", () => {
    let tools = parseTools([]);
    const first = saveTool(tools, null, toolForm({ ...DEFAULT_TOOL, name: "Zeta" }));
    if ("errors" in first) throw new Error("expected a tool");
    expect(first.tools[0]?.isDefault).toBe(true);
    const second = saveTool(first.tools, null, toolForm({ ...DEFAULT_TOOL, name: "Alpha" }));
    if ("errors" in second) throw new Error("expected a tool");
    tools = second.tools;
    expect(tools.map((t) => [t.tool.name, t.isDefault])).toEqual([
      ["Alpha", false],
      ["Zeta", true],
    ]);

    const edited = saveTool(tools, second.saved.id, toolForm({ ...DEFAULT_TOOL, name: "Beta" }));
    if ("errors" in edited) throw new Error("expected a tool");
    expect(edited.saved.tool.name).toBe("Beta");

    tools = setDefaultTool(edited.tools, second.saved.id);
    expect(tools.find((t) => t.isDefault)?.id).toBe(second.saved.id);
    tools = deleteTool(tools, second.saved.id);
    expect(tools).toMatchObject([{ tool: { name: "Zeta" }, isDefault: true }]);
  });

  it("returns the form's errors", () => {
    const result = saveTool([], null, toolForm({ ...DEFAULT_TOOL, diameter: "" }));
    expect(result).toEqual({ errors: expect.objectContaining({ diameter: "Required" }) });
  });
});

describe("machines", () => {
  const machine = {
    ...NEW_MACHINE_DEFAULTS,
    name: "Shapeoko",
    workAreaX: 400,
    workAreaY: 400,
    workAreaZ: 75,
    maxFeedXY: 5000,
    maxFeedZ: 1000,
    spindleRpmMin: 10000,
    spindleRpmMax: 30000,
  };

  it("saves, lists by name and deletes machines", () => {
    const saved = saveMachine([], null, toolForm(machine));
    if ("errors" in saved) throw new Error(JSON.stringify(saved.errors));
    expect(parseMachines(JSON.parse(JSON.stringify(saved.machines)))).toEqual(saved.machines);
    const [{ id } = { id: "" }] = saved.machines;
    expect(deleteMachine(saved.machines, id)).toEqual([]);
    expect(parseMachines([{ id: "x", machine: { name: "" } }])).toEqual([]);
  });
});

describe("parseSettings", () => {
  it("reads whether the tour was seen", () => {
    expect(parseSettings(null)).toEqual({ workspaceTourDone: false, workspaceLayout: {} });
    expect(parseSettings({ workspaceTourDone: true })).toEqual({
      workspaceTourDone: true,
      workspaceLayout: {},
    });
  });

  it("reads the workspace layout, dropping one it can't use", () => {
    const workspaceLayout = { columns: { sidebar: 30, viewport: 70 } };
    expect(parseSettings({ workspaceLayout }).workspaceLayout).toEqual(workspaceLayout);
    expect(parseSettings({ workspaceLayout: "wide" }).workspaceLayout).toEqual({});
  });
});
