import type { Path } from "@furrow/document";
import { fullDocument, TEXT_ID, textItem, textShape } from "@furrow/document/fixtures";
import { describe, expect, it, vi } from "vitest";
import { createDocumentStore } from "../stores/document-store";
import { moveDrawing } from "../stores/geometry-actions";
import { convertText, editText } from "./text-items";
import type { TextLayoutRequest } from "./text-layout";

/** Every request the text worker got. */
const requests: TextLayoutRequest[] = [];

/** The text worker, answering a turn later: a 1 mm square at the text's origin. */
class TextWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  postMessage({ id, settings }: TextLayoutRequest) {
    requests.push({ id, settings });
    const [x, y] = settings.placement.position;
    const square: Path = {
      start: [x, y],
      segments: [
        { kind: "line", to: [x + 1, y] },
        { kind: "line", to: [x + 1, y + 1] },
      ],
      closed: true,
    };
    setTimeout(() => this.onmessage?.({ data: { id, paths: [square] } } as MessageEvent));
  }
  terminate() {}
}
vi.stubGlobal("Worker", TextWorker);

/** `fullDocument` with `textItem`. */
function textStore() {
  const doc = fullDocument();
  return createDocumentStore({
    ...doc,
    drawings: [...doc.drawings, textItem],
    geometry: [...doc.geometry, textShape],
  });
}

describe("editText", () => {
  it("merges edits made while one is laid out, the latest of each winning, in one more layout", async () => {
    const store = textStore();
    requests.length = 0;
    const edits = [
      editText(store, TEXT_ID, { font: "arvo" }),
      editText(store, TEXT_ID, { font: "pacifico" }),
      editText(store, TEXT_ID, { height: 12 }),
      editText(store, TEXT_ID, { font: "relief-singleline" }),
    ];
    for (const result of await Promise.all(edits))
      expect(result).toEqual({ ok: true, removedTabs: 0 });
    expect(store.getState().document.drawings.at(-1)?.text).toMatchObject({
      font: "relief-singleline",
      height: 12,
    });
    expect(requests.map(({ settings }) => settings.font)).toEqual(["arvo", "relief-singleline"]);
    expect(store.getState().past).toHaveLength(1);
  });

  it("lays the text out again where it is if it moved meanwhile", async () => {
    const store = textStore();
    const edited = editText(store, TEXT_ID, { text: "II" });
    moveDrawing(store, TEXT_ID, [5, 0]);
    expect(await edited).toEqual({ ok: true, removedTabs: 0 });
    const { drawings, geometry } = store.getState().document;
    expect(drawings.at(-1)?.text).toMatchObject({ text: "II", placement: { position: [15, 10] } });
    expect(geometry.at(-1)?.paths[0]?.start).toEqual([15, 10]);
  });
});

describe("convertText", () => {
  it("closes an undo step a scrub left open, so converting is one of its own", async () => {
    const store = textStore();
    store.getState().beginTransaction();
    expect(await editText(store, TEXT_ID, { height: 12 })).toEqual({ ok: true, removedTabs: 0 });
    expect(await convertText(store, TEXT_ID)).toEqual({ ok: true });
    expect(store.getState().inTransaction).toBe(false);
    expect(store.getState().document.drawings.at(-1)?.text).toBeUndefined();
    store.getState().undo();
    expect(store.getState().document.drawings.at(-1)?.text?.height).toBe(12);
  });
});
