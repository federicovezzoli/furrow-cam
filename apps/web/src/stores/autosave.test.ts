import { createProjectDocument } from "@furrow/document";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AutosaveStatus, createAutosave, OFFLINE, type SaveDocument } from "./autosave";
import { createDocumentStore } from "./document-store";

const DELAY = 1000;
const LOADED_AT = new Date("2026-10-01T00:00:00Z");

/** A save that resolves when the test says so. */
function deferredSave() {
  const calls: {
    width: number;
    savedAt: Date;
    resolve: (r: Awaited<ReturnType<SaveDocument>>) => void;
  }[] = [];
  const save = vi.fn<SaveDocument>(
    (document, savedAt) =>
      new Promise((resolve) => calls.push({ width: document.stock.width, savedAt, resolve })),
  );
  return { save, calls };
}

function setup(save: SaveDocument) {
  const store = createDocumentStore(createProjectDocument());
  const statuses: AutosaveStatus[] = [];
  const autosave = createAutosave(store, {
    savedAt: LOADED_AT,
    save,
    delay: DELAY,
    onStatus: (status) => statuses.push(status),
  });
  const setWidth = (width: number) =>
    store.getState().change("setWidth", (doc) => {
      doc.stock.width = width;
    });
  return { store, autosave, statuses, setWidth };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAutosave", () => {
  it("saves once after the last change settles", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: new Date("2026-10-02T00:00:00Z") }));
    const { autosave, setWidth } = setup(save);
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY / 2);
    setWidth(200);
    expect(autosave.status.state).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(DELAY / 2);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DELAY / 2);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].stock.width).toBe(200);
    expect(save.mock.calls[0]?.[1]).toEqual(LOADED_AT);
    expect(autosave.status).toEqual({ state: "saved", savedAt: new Date("2026-10-02T00:00:00Z") });
  });

  it("never saves mid-transaction", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: new Date() }));
    const { store, autosave, setWidth } = setup(save);
    store.getState().beginTransaction();
    setWidth(101);
    setWidth(102);
    await vi.advanceTimersByTimeAsync(DELAY * 10);
    autosave.flush();
    expect(save).not.toHaveBeenCalled();
    expect(autosave.status.state).toBe("unsaved");

    store.getState().commitTransaction();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].stock.width).toBe(102);
  });

  it("saves changes made during a save after it, with the new version", async () => {
    const { save, calls } = deferredSave();
    const { autosave, setWidth } = setup(save);
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status.state).toBe("saving");
    setWidth(200);
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(calls).toHaveLength(1);

    const first = new Date("2026-10-02T00:00:00Z");
    calls[0]?.resolve({ updatedAt: first });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.status.state).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ width: 200, savedAt: first });
  });

  it("reports a failed save and retries on the next change", async () => {
    const save = vi
      .fn<SaveDocument>()
      .mockResolvedValueOnce({ error: "Conflict" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ updatedAt: new Date("2026-10-02T00:00:00Z") });
    const { autosave, setWidth } = setup(save);

    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status).toEqual({ state: "error", savedAt: LOADED_AT, error: "Conflict" });
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(save).toHaveBeenCalledOnce();

    setWidth(200);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status).toEqual({ state: "error", savedAt: LOADED_AT, error: OFFLINE });

    setWidth(300);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status.state).toBe("saved");
  });

  it("saves a pending change on dispose and then stops watching", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: new Date() }));
    const { autosave, setWidth } = setup(save);
    setWidth(100);
    autosave.dispose();
    expect(save).toHaveBeenCalledOnce();
    setWidth(200);
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(save).toHaveBeenCalledOnce();
  });
});
