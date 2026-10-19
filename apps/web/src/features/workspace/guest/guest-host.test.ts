import "fake-indexeddb/auto";
import { createProjectDocument } from "@furrow/document";
import { parseSettings } from "@furrow/workspace/lib/local-library";
import type { WorkspaceHost } from "@furrow/workspace/lib/workspace-host";
import { DEFAULT_TOOL } from "@furrow/workspace/tools/lib/tool-form-data";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

let storage: typeof import("./storage");
let guestHost: typeof import("./guest-host").guestHost;

const navigation: WorkspaceHost["navigation"] = { Link: () => null };

/** The tool form's fields for `tool`, as the browser submits them. */
function toolForm(tool: Record<string, unknown>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(tool)) {
    if (value !== null && value !== undefined) form.set(key, String(value));
  }
  return form;
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  storage = await import("./storage");
  ({ guestHost } = await import("./guest-host"));
});

async function openHost() {
  const project = await storage.createGuestProject("Coasters", createProjectDocument());
  const settings = { current: parseSettings(undefined) };
  const tools = { current: await storage.readGuestTools() };
  return {
    project,
    settings,
    tools,
    host: guestHost(project, settings, tools, navigation, { prompt() {} }),
  };
}

describe("guestHost", () => {
  it("opens the stored project, which saves to the browser", async () => {
    const { project, host } = await openHost();
    expect(host.project).toMatchObject({
      id: project.id,
      name: "Coasters",
      document: project.document,
      savedAt: project.savedAt,
      autosaves: true,
    });
    const changed = { ...project.document, units: "in" as const };
    const saved = await host.project.save(changed, project.savedAt);
    expect(saved).toHaveProperty("updatedAt");
    expect((await storage.getGuestProject(project.id))?.document).toEqual(changed);
  });

  it("passes a stale save's refusal on", async () => {
    const { project, host } = await openHost();
    await host.project.save(project.document, project.savedAt);
    expect(await host.project.save(project.document, project.savedAt)).toHaveProperty("error");
  });

  it("keeps the project's STL files in the browser", async () => {
    const { host } = await openHost();
    const file = new Blob([new Uint8Array([7, 8])]);
    expect(await host.meshes.put("abc", file)).toEqual({ uploaded: true });
    expect(new Uint8Array(await host.meshes.get("abc"))).toEqual(new Uint8Array([7, 8]));
    await host.meshes.discard("abc");
    await expect(host.meshes.get("abc")).rejects.toThrow();
  });

  it("reports a file it can't store as an error", async () => {
    const { project, host } = await openHost();
    await storage.deleteGuestProject(project.id);
    expect(await host.meshes.put("abc", new Blob([]))).toEqual({
      error: expect.stringContaining("no longer exists"),
    });
  });

  it("has no versions or machines, and no bits of its own at first", async () => {
    const { host } = await openHost();
    expect(host.versions).toBeNull();
    expect(host.library.tools).toEqual([]);
    expect(host.library.machines).toEqual([]);
  });

  it("saves the guest's own bits in the browser, and edits them", async () => {
    const { tools, host } = await openHost();
    const saved = await host.library.saveTool(null, toolForm({ ...DEFAULT_TOOL, name: "My bit" }));
    if ("errors" in saved) throw new Error(JSON.stringify(saved.errors));
    expect(saved.tool.name).toBe("My bit");
    expect(tools.current.map((choice) => choice.tool.name)).toEqual(["My bit"]);
    expect((await storage.readGuestTools()).map((choice) => choice.id)).toEqual([saved.id]);

    const edited = await host.library.saveTool(
      saved.id,
      toolForm({ ...DEFAULT_TOOL, name: "Mine" }),
    );
    expect(edited).toMatchObject({ id: saved.id, tool: { name: "Mine" } });
    expect((await storage.readGuestTools()).map((choice) => choice.tool.name)).toEqual(["Mine"]);
  });

  it("keeps a bit another tab saved meanwhile", async () => {
    const first = await openHost();
    // A second tab, opened before either saved a bit.
    const second = await openHost();
    await first.host.library.saveTool(null, toolForm({ ...DEFAULT_TOOL, name: "First" }));
    await second.host.library.saveTool(null, toolForm({ ...DEFAULT_TOOL, name: "Second" }));
    expect((await storage.readGuestTools()).map((choice) => choice.tool.name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("reports a bit the form can't save", async () => {
    const { host } = await openHost();
    expect(await host.library.saveTool(null, new FormData())).toHaveProperty("errors");
    expect(await storage.readGuestTools()).toEqual([]);
  });

  it("asks for an account through the guest app's prompt", async () => {
    const project = await storage.createGuestProject("Coasters", createProjectDocument());
    const prompt = vi.fn();
    const host = guestHost(
      project,
      { current: parseSettings(undefined) },
      { current: [] },
      navigation,
      { prompt },
    );
    host.account?.prompt("export-gcode");
    expect(prompt).toHaveBeenCalledWith("export-gcode");
  });

  it("remembers the finished tour and panel sizes in the browser", async () => {
    const { settings, host } = await openHost();
    expect(host.settings.tourDone).toBe(false);
    await host.settings.finishTour("workspace");
    expect((await storage.readGuestSettings()).workspaceTourDone).toBe(true);
    expect(settings.current.workspaceTourDone).toBe(true);
    const layout = host.settings.layout;
    host.settings.saveLayout(layout);
    expect(host.settings.layout).toEqual(layout);
  });
});
