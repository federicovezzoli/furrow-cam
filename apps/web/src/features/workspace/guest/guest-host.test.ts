import "fake-indexeddb/auto";
import { createProjectDocument } from "@furrow/document";
import { parseSettings } from "@furrow/workspace/lib/local-library";
import type { WorkspaceHost } from "@furrow/workspace/lib/workspace-host";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

let storage: typeof import("./storage");
let guestHost: typeof import("./guest-host").guestHost;
let GUEST_BITS: string;

const navigation: WorkspaceHost["navigation"] = { Link: () => null };

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  storage = await import("./storage");
  ({ guestHost, GUEST_BITS } = await import("./guest-host"));
});

async function openHost() {
  const project = await storage.createGuestProject("Coasters", createProjectDocument());
  const settings = { current: parseSettings(undefined) };
  return { project, settings, host: guestHost(project, settings, navigation, { prompt() {} }) };
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

  it("has no versions, machines or bits of its own, and can't save one", async () => {
    const { host } = await openHost();
    expect(host.versions).toBeNull();
    expect(host.library.tools).toEqual([]);
    expect(host.library.machines).toEqual([]);
    expect(await host.library.saveTool(null, new FormData())).toEqual({
      errors: { form: GUEST_BITS },
    });
  });

  it("asks for an account through the guest app's prompt", async () => {
    const project = await storage.createGuestProject("Coasters", createProjectDocument());
    const prompt = vi.fn();
    const host = guestHost(project, { current: parseSettings(undefined) }, navigation, { prompt });
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
