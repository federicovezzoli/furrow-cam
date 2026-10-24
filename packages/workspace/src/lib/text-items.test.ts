import type { Path } from "@furrow/document";
import { fullDocument, TEXT_ID, textItem, textShape } from "@furrow/document/fixtures";
import { describe, expect, it, vi } from "vitest";
import { createDocumentStore } from "../stores/document-store";
import { moveDrawing } from "../stores/geometry-actions";
import { editText } from "./text-items";
import type { TextLayoutRequest } from "./text-layout";

/** The text worker, answering a turn later: a 1 mm square at the text's origin. */
class TextWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  postMessage({ id, settings }: TextLayoutRequest) {
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

describe("editText", () => {
  it("lays the text out again where it is if it moved meanwhile", async () => {
    const doc = fullDocument();
    const store = createDocumentStore({
      ...doc,
      drawings: [...doc.drawings, textItem],
      geometry: [...doc.geometry, textShape],
    });
    const edited = editText(store, TEXT_ID, { text: "II" });
    moveDrawing(store, TEXT_ID, [5, 0]);
    expect(await edited).toEqual({ ok: true });
    const { drawings, geometry } = store.getState().document;
    expect(drawings.at(-1)?.text).toMatchObject({ text: "II", placement: { position: [15, 10] } });
    expect(geometry.at(-1)?.paths[0]?.start).toEqual([15, 10]);
  });
});
