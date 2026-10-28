import { fontName, parseFont } from "@furrow/cam-core";
import { createProjectDocument, type Path, type ProjectFont } from "@furrow/document";
import { fullDocument, TEXT_ID, textItem, textShape } from "@furrow/document/fixtures";
import { describe, expect, it, vi } from "vitest";
import arvo from "../fonts/Arvo-Regular.ttf?inline";
import { createDocumentStore } from "../stores/document-store";
import { moveDrawing } from "../stores/geometry-actions";
import { createMemoryHost } from "./memory-host";
import { convertText, editText, uploadedFonts, uploadFont } from "./text-items";
import type { TextWorkerRequest } from "./text-layout";

/** Every layout the text worker was asked for. */
const requests: Extract<TextWorkerRequest, { kind: "layout" }>[] = [];

/** The uploaded fonts the text worker holds, by hash; tests clear it as if it dropped them. */
const held = new Set<string>();

/** The text worker, answering a turn later: a 1 mm square at the text's origin. */
class TextWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  postMessage(request: TextWorkerRequest) {
    const { id } = request;
    if (request.kind === "inspect") {
      let data: object;
      try {
        data = { id, name: fontName(parseFont(request.font.bytes)) };
        held.add(request.sha256);
      } catch {
        data = { id, error: { code: "workspace.fontUnreadable" } };
      }
      setTimeout(() => this.onmessage?.({ data } as MessageEvent));
      return;
    }
    requests.push(request);
    const { settings } = request;
    if (request.font) held.add(settings.font);
    if (/^[0-9a-f]{64}$/.test(settings.font) && !held.has(settings.font)) {
      setTimeout(() => this.onmessage?.({ data: { id, missing: true } } as MessageEvent));
      return;
    }
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

describe("uploadFont", () => {
  /** A host that stores fonts of up to `maxBytes`, and a store with an empty project. */
  function setup(maxBytes = 5_000_000) {
    const host = createMemoryHost(
      { document: createProjectDocument() },
      { limits: { meshes: null, fonts: { maxBytes } } },
    );
    return { host, store: createDocumentStore(createProjectDocument()) };
  }

  const fontFile = async (name = "Arvo-Regular.ttf") =>
    new File([await (await fetch(arvo)).arrayBuffer()], name);

  it("stores a font and lists it in the project, named after its family, as one undo step", async () => {
    const { host, store } = setup();
    const file = await fontFile();
    const result = await uploadFont(store, host, file, true);
    if (!result.ok) throw new Error("not uploaded");
    expect(store.getState().document.fonts).toEqual([
      {
        sha256: result.sha256,
        fileName: "Arvo-Regular.ttf",
        name: "Arvo",
        size: file.size,
        singleStroke: true,
      },
    ]);
    expect(host.stored.fonts.has(result.sha256)).toBe(true);
    // Again: the project already holds it, and takes the new single-stroke choice as one undo step.
    expect(await uploadFont(store, host, file, false)).toEqual(result);
    expect(store.getState().document.fonts).toMatchObject([{ singleStroke: false }]);
    store.getState().undo();
    expect(store.getState().document.fonts).toMatchObject([{ singleStroke: true }]);
    store.getState().undo();
    expect(store.getState().document.fonts).toEqual([]);
  });

  it("refuses files that aren't fonts, are too large, or don't fit, and hosts that can't store them", async () => {
    const { host, store } = setup();
    expect(await uploadFont(store, host, new File(["text"], "a.ttf"), false)).toEqual({
      ok: false,
      error: { code: "workspace.fontUnreadable" },
    });
    expect(host.stored.fonts.size).toBe(0);
    const small = setup(1000);
    expect(await uploadFont(small.store, small.host, await fontFile(), false)).toEqual({
      ok: false,
      error: { code: "workspace.fontTooLarge", values: { mb: 0.001 } },
    });
    const full = Array.from({ length: 4 }, (_, i) => ({
      sha256: i.toString(16).padStart(64, "0"),
      fileName: "f.ttf",
      name: "F",
      size: 1,
      singleStroke: false,
    }));
    store.setState({ document: { ...createProjectDocument(), fonts: full } });
    expect(await uploadFont(store, host, await fontFile(), false)).toEqual({
      ok: false,
      error: { code: "workspace.tooManyFonts", values: { max: 4 } },
    });
    const off = createMemoryHost({ document: createProjectDocument() });
    expect(await uploadFont(store, off, await fontFile(), false)).toEqual({
      ok: false,
      error: { code: "workspace.fontUploadOff" },
    });
  });

  it("reports a file that can't be read, rather than leaving the upload hanging", async () => {
    const { host, store } = setup();
    const gone = new File(["x"], "gone.ttf");
    gone.arrayBuffer = () => Promise.reject(new DOMException("Moved", "NotReadableError"));
    expect(await uploadFont(store, host, gone, false)).toEqual({
      ok: false,
      error: { code: "workspace.fontUploadFailed" },
    });
  });

  it("sends the worker an uploaded font only when it lacks it as the project has it", async () => {
    const { host, store } = setup();
    const result = await uploadFont(store, host, await fontFile(), true);
    if (!result.ok) throw new Error("not uploaded");
    store.setState({
      document: { ...store.getState().document, drawings: [textItem], geometry: [textShape] },
    });
    requests.length = 0;
    const fonts = uploadedFonts(store, host.fonts);
    // Checking it on upload left it in the worker: nothing to send.
    await editText(store, TEXT_ID, { font: result.sha256 }, fonts);
    // The project now says otherwise of its stroke: sent again with the new flag.
    const { document } = store.getState();
    store.setState({
      document: {
        ...document,
        fonts: [{ ...(document.fonts[0] as ProjectFont), singleStroke: false }],
      },
    });
    await editText(store, TEXT_ID, { height: 12 }, fonts);
    // Dropped by the worker: it says it's missing, and gets it again.
    held.clear();
    await editText(store, TEXT_ID, { height: 14 }, fonts);
    expect(requests.map(({ font }) => font?.singleStroke)).toEqual([
      undefined,
      false,
      undefined,
      false,
    ]);
    expect(store.getState().document.drawings.at(-1)?.text?.height).toBe(14);
  });
});
