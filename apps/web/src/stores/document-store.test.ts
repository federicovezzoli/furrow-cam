import { createProjectDocument } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createDocumentStore, MAX_HISTORY } from "./document-store";

function setup() {
  const store = createDocumentStore(createProjectDocument());
  const setWidth = (width: number) =>
    store.getState().change("setWidth", (doc) => {
      doc.stock.width = width;
    });
  const width = () => store.getState().document.stock.width;
  return { store, setWidth, width };
}

describe("undo/redo", () => {
  it("undoes and redoes changes in order", () => {
    const { store, setWidth, width } = setup();
    const initial = width();
    setWidth(100);
    setWidth(200);

    store.getState().undo();
    expect(width()).toBe(100);
    store.getState().undo();
    expect(width()).toBe(initial);
    store.getState().undo();
    expect(width()).toBe(initial);

    store.getState().redo();
    expect(width()).toBe(100);
    store.getState().redo();
    expect(width()).toBe(200);
    store.getState().redo();
    expect(width()).toBe(200);
  });

  it("clears redo on a new change", () => {
    const { store, setWidth, width } = setup();
    setWidth(100);
    setWidth(200);
    store.getState().undo();
    setWidth(300);

    expect(store.getState().future).toEqual([]);
    store.getState().redo();
    expect(width()).toBe(300);
    store.getState().undo();
    expect(width()).toBe(100);
  });

  it("records nothing for a change that changes nothing", () => {
    const { store, setWidth, width } = setup();
    const before = store.getState().document;
    setWidth(width());
    expect(store.getState().past).toEqual([]);
    expect(store.getState().document).toBe(before);
  });

  it("restores array changes", () => {
    const { store } = setup();
    const initial = store.getState().document;
    store.getState().change("addShape", (doc) => {
      doc.geometry.push({ id: "a", closed: true, points: [] } as never);
    });
    store.getState().change("removeShape", (doc) => {
      doc.geometry.splice(0, 1);
    });
    store.getState().undo();
    expect(store.getState().document.geometry.map((s) => s.id)).toEqual(["a"]);
    store.getState().undo();
    expect(store.getState().document).toEqual(initial);
  });

  it(`keeps the last ${MAX_HISTORY} steps`, () => {
    const { store, setWidth, width } = setup();
    for (let i = 1; i <= MAX_HISTORY + 5; i++) setWidth(i);
    expect(store.getState().past).toHaveLength(MAX_HISTORY);
    for (let i = 0; i < MAX_HISTORY + 5; i++) store.getState().undo();
    expect(width()).toBe(5);
  });
});

describe("transactions", () => {
  it("applies changes live and commits them as one undo step", () => {
    const { store, setWidth, width } = setup();
    const initial = width();
    store.getState().beginTransaction();
    setWidth(101);
    expect(width()).toBe(101);
    setWidth(102);
    setWidth(103);
    expect(store.getState().past).toEqual([]);
    store.getState().commitTransaction();

    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().inTransaction).toBe(false);
    store.getState().undo();
    expect(width()).toBe(initial);
    store.getState().redo();
    expect(width()).toBe(103);
  });

  it("undoes changes to different fields in the right order", () => {
    const { store, width } = setup();
    const initial = store.getState().document;
    store.getState().beginTransaction();
    store.getState().change("a", (doc) => {
      doc.stock.width = 1;
    });
    store.getState().change("b", (doc) => {
      doc.stock = { ...doc.stock, width: 2, height: 3 };
    });
    store.getState().commitTransaction();
    store.getState().undo();
    expect(store.getState().document).toEqual(initial);
    store.getState().redo();
    expect(width()).toBe(2);
    expect(store.getState().document.stock.height).toBe(3);
  });

  it("clears redo when committed", () => {
    const { store, setWidth } = setup();
    setWidth(100);
    store.getState().undo();
    store.getState().beginTransaction();
    setWidth(200);
    store.getState().commitTransaction();
    expect(store.getState().future).toEqual([]);
  });

  it("records nothing when empty", () => {
    const { store } = setup();
    store.getState().beginTransaction();
    store.getState().commitTransaction();
    expect(store.getState().past).toEqual([]);
  });

  it("reverts its changes when cancelled", () => {
    const { store, setWidth, width } = setup();
    setWidth(100);
    store.getState().beginTransaction();
    setWidth(101);
    setWidth(102);
    store.getState().cancelTransaction();

    expect(width()).toBe(100);
    expect(store.getState().inTransaction).toBe(false);
    expect(store.getState().past).toHaveLength(1);
  });

  it("ignores undo and redo while open", () => {
    const { store, setWidth, width } = setup();
    setWidth(100);
    store.getState().beginTransaction();
    setWidth(101);
    store.getState().undo();
    store.getState().redo();
    expect(width()).toBe(101);
    store.getState().commitTransaction();
    expect(store.getState().past).toHaveLength(2);
  });

  it("ignores a nested begin", () => {
    const { store, setWidth } = setup();
    store.getState().beginTransaction();
    setWidth(101);
    store.getState().beginTransaction();
    setWidth(102);
    store.getState().commitTransaction();
    expect(store.getState().past).toHaveLength(1);
  });
});
