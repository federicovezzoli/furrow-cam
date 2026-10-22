import { createProjectDocument } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { createWorkspaceStores } from "./workspace-stores";

function setWidth(stores: ReturnType<typeof createWorkspaceStores>, width: number) {
  stores.document.getState().change("setWidth", (doc) => {
    doc.stock.width = width;
  });
}

describe("createWorkspaceStores", () => {
  it("opens the host's document and saves changes through it", async () => {
    const host = createMemoryHost({ id: "saves", document: createProjectDocument() });
    const stores = createWorkspaceStores(host);
    expect(stores.document.getState().document).toBe(host.project.document);

    setWidth(stores, 321);
    expect(await stores.autosave.settle()).toMatchObject({ state: "saved" });
    expect(host.stored.document().stock.width).toBe(321);

    // The next save passes the time of the last, so the host accepts it too.
    setWidth(stores, 123);
    expect(await stores.autosave.settle()).toMatchObject({ state: "saved" });
    expect(host.stored.document().stock.width).toBe(123);
  });

  it("keeps hosts with the same project id apart", async () => {
    const first = createMemoryHost({ document: createProjectDocument() });
    const firstStores = createWorkspaceStores(first);
    setWidth(firstStores, 321);
    await firstStores.autosave.settle();

    const second = createMemoryHost({ document: createProjectDocument() });
    const stores = createWorkspaceStores(second);
    expect(stores.document.getState().document).toBe(second.project.document);
    setWidth(stores, 123);
    expect(await stores.autosave.settle()).toMatchObject({ state: "saved" });
  });

  it("stops saving when the host refuses a save", async () => {
    const host = createMemoryHost({ id: "refuses", document: createProjectDocument() });
    const stores = createWorkspaceStores(host);
    await host.project.save(createProjectDocument(), host.project.savedAt);

    setWidth(stores, 321);
    expect(await stores.autosave.settle()).toMatchObject({ state: "failed" });
  });

  it("saves and restores versions in the host", async () => {
    const host = createMemoryHost({ id: "versions", document: createProjectDocument() });
    const stores = createWorkspaceStores(host);
    const versions = host.versions;
    if (!versions) throw new Error("expected versions");

    const first = await stores.autosave.settle();
    const created = await versions.create("first cut", first.savedAt);
    if (created.error !== undefined) throw new Error(JSON.stringify(created.error));
    expect(created.versions).toMatchObject([{ label: "first cut" }]);

    setWidth(stores, 321);
    const changed = await stores.autosave.settle();
    const id = created.versions[0]?.id ?? "";
    const restored = await versions.restore(id, changed.savedAt);
    if (restored.error !== undefined) throw new Error(JSON.stringify(restored.error));
    expect(restored.document.stock.width).toBe(host.project.document.stock.width);
    expect(restored.versions).toHaveLength(2);
  });
});
