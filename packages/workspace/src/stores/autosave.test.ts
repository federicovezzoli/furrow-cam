import { createProjectDocument } from "@furrow/document";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mayLeave } from "../hooks/use-autosave";
import {
  type AutosaveStatus,
  createAutosave,
  OFFLINE,
  RETRY_INTERVAL,
  type SaveDocument,
} from "./autosave";
import { createDocumentStore } from "./document-store";

const DELAY = 1000;
const LOADED_AT = new Date("2026-10-01T00:00:00Z");
const SAVED_AT = new Date("2026-10-02T00:00:00Z");

type SaveResult = Awaited<ReturnType<SaveDocument>>;

/** A save that resolves when the test says so. */
function deferredSave() {
  const calls: { width: number; savedAt: Date; resolve: (result: SaveResult) => void }[] = [];
  const save = vi.fn<SaveDocument>(
    (document, savedAt) =>
      new Promise((resolve) => calls.push({ width: document.stock.width, savedAt, resolve })),
  );
  return { save, calls };
}

function setup(save: SaveDocument) {
  const store = createDocumentStore(createProjectDocument());
  const autosave = createAutosave(store, { savedAt: LOADED_AT, save, delay: DELAY });
  const stop = autosave.start();
  const setWidth = (width: number) =>
    store.getState().change("setWidth", (doc) => {
      doc.stock.width = width;
    });
  return { store, autosave, stop, setWidth };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAutosave", () => {
  it("saves once after the last change settles", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: SAVED_AT }));
    const { autosave, setWidth } = setup(save);
    const listener = vi.fn();
    autosave.subscribe(listener);
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
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });
    expect(listener).toHaveBeenCalled();
  });

  it("never saves mid-transaction", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: SAVED_AT }));
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

    calls[0]?.resolve({ updatedAt: SAVED_AT });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.status.state).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ width: 200, savedAt: SAVED_AT });
  });

  it("is saved again when changes are undone", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: SAVED_AT }));
    const { store, autosave, setWidth } = setup(save);
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    setWidth(200);
    expect(autosave.status.state).toBe("unsaved");

    store.getState().undo();
    expect(autosave.status.state).toBe("saved");
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(save).toHaveBeenCalledOnce();
  });

  it("retries after a network error on the next change", async () => {
    const save = vi
      .fn<SaveDocument>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ updatedAt: SAVED_AT });
    const { autosave, setWidth } = setup(save);

    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status).toEqual({ state: "error", savedAt: LOADED_AT, error: OFFLINE });

    setWidth(200);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });
  });

  it("tries again on the next change after a refusal the user can clear", async () => {
    const save = vi
      .fn<SaveDocument>()
      .mockResolvedValueOnce({ error: "You're signed out.", retryable: true })
      .mockResolvedValue({ updatedAt: SAVED_AT });
    const { autosave, setWidth } = setup(save);

    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status).toEqual({
      state: "error",
      savedAt: LOADED_AT,
      error: "You're signed out.",
    });

    setWidth(200);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });
  });

  it("tries again when flushed after a refusal the user can clear, e.g. signed in again", async () => {
    const save = vi
      .fn<SaveDocument>()
      .mockResolvedValueOnce({ error: "You're signed out.", retryable: true })
      .mockResolvedValue({ updatedAt: SAVED_AT });
    const { autosave, setWidth } = setup(save);

    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });
  });

  it("retries a refusal the user can clear, but not more than once per interval", async () => {
    const save = vi.fn<SaveDocument>(async () => ({
      error: "You're signed out.",
      retryable: true,
    }));
    const { autosave, setWidth } = setup(save);

    autosave.retry();
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledOnce();
    autosave.retry();
    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RETRY_INTERVAL);
    save.mockResolvedValue({ updatedAt: SAVED_AT });
    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(3);
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });
    autosave.retry();
    await vi.advanceTimersByTimeAsync(RETRY_INTERVAL);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("is saved again when an edit the server refused is undone", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ error: "Invalid", retryable: true }));
    const { store, autosave, setWidth } = setup(save);

    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status.state).toBe("error");
    store.getState().undo();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledOnce();
    expect(autosave.status).toEqual({ state: "saved", savedAt: LOADED_AT });
  });

  it("stops after the server refuses a save for good, as for a conflict", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ error: "Conflict" }));
    const { autosave, setWidth } = setup(save);

    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(autosave.status).toEqual({ state: "failed", savedAt: LOADED_AT, error: "Conflict" });

    setWidth(200);
    autosave.flush();
    autosave.retry();
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(save).toHaveBeenCalledOnce();
    expect(autosave.status.state).toBe("failed");
  });

  it("saves a pending change on stop and then stops watching", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: SAVED_AT }));
    const { stop, setWidth } = setup(save);
    setWidth(100);
    stop();
    expect(save).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    setWidth(200);
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(save).toHaveBeenCalledOnce();
  });

  it("saves changes made during a save that was running when stopped", async () => {
    const { save, calls } = deferredSave();
    const { autosave, stop, setWidth } = setup(save);
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    setWidth(200);
    stop();
    expect(calls).toHaveLength(1);

    calls[0]?.resolve({ updatedAt: SAVED_AT });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ width: 200, savedAt: SAVED_AT });
    calls[1]?.resolve({ updatedAt: new Date("2026-10-03T00:00:00Z") });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.status.state).toBe("saved");
  });

  it("continues from the last save when started again", async () => {
    const { save, calls } = deferredSave();
    const { autosave, stop, setWidth } = setup(save);
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    stop();
    autosave.start();
    calls[0]?.resolve({ updatedAt: SAVED_AT });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });

    setWidth(200);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.savedAt).toEqual(SAVED_AT);
  });

  it("settles a pending change: saves it now and resolves once it's stored", async () => {
    const { save, calls } = deferredSave();
    const { autosave, setWidth } = setup(save);
    setWidth(100);
    const settled = autosave.settle();
    expect(calls).toHaveLength(1);
    calls[0]?.resolve({ updatedAt: SAVED_AT });
    expect(await settled).toEqual({ state: "saved", savedAt: SAVED_AT });
  });

  it("settles after a running save and the changes made during it", async () => {
    const { save, calls } = deferredSave();
    const { autosave, setWidth } = setup(save);
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY);
    setWidth(200);
    const settled = autosave.settle();
    calls[0]?.resolve({ updatedAt: SAVED_AT });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[1]).toMatchObject({ width: 200, savedAt: SAVED_AT });
    const later = new Date("2026-10-03T00:00:00Z");
    calls[1]?.resolve({ updatedAt: later });
    expect(await settled).toEqual({ state: "saved", savedAt: later });
  });

  it("settles at once when nothing is pending", async () => {
    const save = vi.fn<SaveDocument>();
    const { autosave } = setup(save);
    expect(await autosave.settle()).toEqual({ state: "saved", savedAt: LOADED_AT });
    expect(save).not.toHaveBeenCalled();
  });

  it("settles with the error when the connection fails", async () => {
    const save = vi.fn<SaveDocument>().mockRejectedValue(new Error("offline"));
    const { autosave, setWidth } = setup(save);
    setWidth(100);
    expect(await autosave.settle()).toMatchObject({ state: "error", error: OFFLINE });
    expect(save).toHaveBeenCalledOnce();
  });

  it("starts no save while held, and saves what changed meanwhile on release", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: SAVED_AT }));
    const { autosave, setWidth } = setup(save);
    expect(await autosave.hold()).toEqual({ state: "saved", savedAt: LOADED_AT });
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    autosave.flush();
    expect(save).not.toHaveBeenCalled();

    autosave.release();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledOnce();
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });
  });

  it("starts over from a document restored while held, dropping changes made meanwhile", async () => {
    const save = vi.fn<SaveDocument>(async () => ({ updatedAt: LOADED_AT }));
    const { store, autosave, setWidth } = setup(save);
    await autosave.hold();
    // An edit while the restore is in flight: without the hold, its save would conflict.
    setWidth(100);
    await vi.advanceTimersByTimeAsync(DELAY * 5);

    const restored = createProjectDocument();
    restored.stock.width = 42;
    autosave.release({ document: restored, savedAt: SAVED_AT });
    store.getState().load(restored);
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.status).toEqual({ state: "saved", savedAt: SAVED_AT });

    setWidth(300);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[1]).toEqual(SAVED_AT);
  });
});

describe("mayLeave", () => {
  it("asks only while changes can't be saved, with why", async () => {
    const asked: AutosaveStatus["error"][] = [];
    const confirm = async (error: AutosaveStatus["error"]) => {
      asked.push(error);
      return false;
    };
    for (const state of ["saved", "unsaved", "saving"] as const) {
      expect(mayLeave({ state, savedAt: LOADED_AT }, confirm)).toBe(true);
    }
    expect(asked).toEqual([]);
    expect(
      await mayLeave({ state: "failed", savedAt: LOADED_AT, error: "Conflict." }, confirm),
    ).toBe(false);
    const agree = async () => true;
    expect(await mayLeave({ state: "error", savedAt: LOADED_AT, error: OFFLINE }, agree)).toBe(
      true,
    );
    expect(asked).toEqual(["Conflict."]);
  });
});
