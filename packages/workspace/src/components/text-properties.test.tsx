// @vitest-environment jsdom
import { createProjectDocument, type Path, type ProjectDocument } from "@furrow/document";
import { fullDocument, TEXT_ID, textItem, textShape } from "@furrow/document/fixtures";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import arvo from "../fonts/Arvo-Regular.ttf?inline";
import { createMemoryHost } from "../lib/memory-host";
import type { TextLayoutRequest } from "../lib/text-layout";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import type { WorkspaceStore } from "../stores/workspace-store";
import { renderWorkspace } from "../test-render";
import { DrawingProperties } from "./drawing-properties";
import { GeometryImport } from "./geometry-import";

/**
 * The text worker: lays every text out as one box at its origin, as wide as
 * its characters times its height and its height tall. "∅" has no outlines.
 */
class TextWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  postMessage({ id, settings }: TextLayoutRequest) {
    const [x, y] = settings.placement.position;
    const width = settings.text.length * settings.height;
    const box: Path = {
      start: [x, y],
      segments: [
        { kind: "line", to: [x + width, y] },
        { kind: "line", to: [x + width, y + settings.height] },
        { kind: "line", to: [x, y + settings.height] },
      ],
      closed: true,
    };
    const paths = settings.text === "∅" ? [] : [box];
    queueMicrotask(() => this.onmessage?.({ data: { id, paths } } as MessageEvent));
  }
  terminate() {}
}
vi.stubGlobal("Worker", TextWorker);

let stores: { document: DocumentStore; workspace: WorkspaceStore };

function Stores() {
  stores = { document: useDocumentStoreApi(), workspace: useWorkspaceStoreApi() };
  return null;
}

function render(ui: React.ReactElement, document: ProjectDocument, fonts = false) {
  return renderWorkspace(
    <>
      <Stores />
      {ui}
    </>,
    createMemoryHost(
      { document },
      { limits: { meshes: null, fonts: fonts ? { maxBytes: 5_000_000 } : null } },
    ),
  );
}

const current = () => stores.document.getState().document;
const text = () => current().drawings.find(({ id }) => id === TEXT_ID)?.text;

/** `fullDocument` with `textItem`. */
function withText(): ProjectDocument {
  const doc = fullDocument();
  return { ...doc, drawings: [...doc.drawings, textItem], geometry: [...doc.geometry, textShape] };
}

describe("AddTextButton", () => {
  it("adds a text item to an empty project, placed like a drawing, and selects it", async () => {
    render(<GeometryImport />, createProjectDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() => expect(current().drawings).toHaveLength(1));
    const [drawing] = current().drawings;
    expect(drawing).toMatchObject({
      name: "Text",
      text: { text: "Text", font: "jetbrains-mono", height: 20 },
    });
    // At the bottom-left anchor, inside the 10 mm border.
    expect(drawing?.text?.placement.position).toEqual([10, 10]);
    const [shape] = current().geometry;
    expect(stores.workspace.getState().selectedPaths).toEqual([{ shapeId: shape?.id, path: 0 }]);
  });
});

describe("TextProperties", () => {
  it("edits the text, font, letter height and alignment, each one undo step keeping its place", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    const field = screen.getByLabelText("Text", { selector: "textarea" });
    fireEvent.change(field, { target: { value: "Hello" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(text()?.text).toBe("Hello"));
    expect(current().drawings.at(-1)?.name).toBe("Hello");
    const shape = current().geometry.at(-1);
    expect(shape?.id).toBe(textShape.id);
    // The fake worker's box: 5 characters at 10 mm, from the item's origin.
    expect(shape?.paths[0]?.segments[0]?.to).toEqual([60, 10]);
    // Its new outlines are selected whole.
    expect(stores.workspace.getState().selectedPaths).toEqual([{ shapeId: textShape.id, path: 0 }]);

    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "arvo" } });
    await waitFor(() => expect(text()?.font).toBe("arvo"));
    const height = screen.getByLabelText(/^Letter height/);
    fireEvent.change(height, { target: { value: "12" } });
    fireEvent.keyDown(height, { key: "Enter" });
    // `fullDocument` shows inches.
    await waitFor(() => expect(text()?.height).toBeCloseTo(12 * 25.4, 9));
    fireEvent.change(screen.getByLabelText("Alignment"), { target: { value: "center" } });
    await waitFor(() => expect(text()?.align).toBe("center"));
    expect(text()?.placement).toEqual(textItem.text?.placement);

    act(() => stores.document.getState().undo());
    expect(text()?.align).toBe("left");
    act(() => stores.document.getState().undo());
    expect(text()?.height).toBe(10);
    act(() => stores.document.getState().undo());
    act(() => stores.document.getState().undo());
    expect(current()).toEqual(withText());
  });

  it("takes several lines, a line spacing and a letter spacing", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    const field = screen.getByLabelText("Text", { selector: "textarea" });
    fireEvent.change(field, { target: { value: "Hi\nthere" } });
    // Enter alone starts a new line; leaving the field changes the text.
    fireEvent.keyDown(field, { key: "Enter" });
    expect(text()?.text).toBe("I");
    fireEvent.blur(field);
    await waitFor(() => expect(text()?.text).toBe("Hi\nthere"));
    expect(current().drawings.at(-1)?.name).toBe("Hi there");
    const lineSpacing = screen.getByLabelText(/^Line spacing/);
    fireEvent.change(lineSpacing, { target: { value: "2" } });
    fireEvent.keyDown(lineSpacing, { key: "Enter" });
    await waitFor(() => expect(text()?.lineSpacing).toBe(2));
    const letterSpacing = screen.getByLabelText(/^Letter spacing/);
    // A share of the letter height, whatever the units.
    fireEvent.change(letterSpacing, { target: { value: "10" } });
    fireEvent.keyDown(letterSpacing, { key: "Enter" });
    await waitFor(() => expect(text()?.letterSpacing).toBeCloseTo(0.1, 9));
  });

  it("makes a held arrow on the letter height one undo step, once its layouts land", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    const height = screen.getByLabelText(/^Letter height/);
    // Each step is laid out before the next, as in a slow scrub.
    for (let i = 0; i < 3; i++) {
      const before = text()?.height;
      fireEvent.keyDown(height, { key: "ArrowUp", repeat: i > 0 });
      await waitFor(() => expect(text()?.height).not.toBe(before));
    }
    fireEvent.keyUp(height, { key: "ArrowUp" });
    await waitFor(() => expect(stores.document.getState().inTransaction).toBe(false));
    expect(text()?.height).toBeGreaterThan(10);
    expect(stores.document.getState().past).toHaveLength(1);
    act(() => stores.document.getState().undo());
    expect(current()).toEqual(withText());
  });

  it("converts the text into a drawing, which has no text settings", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    fireEvent.click(screen.getByRole("button", { name: "Convert to drawing" }));
    await waitFor(() => expect(text()).toBeUndefined());
    expect(current().geometry).toEqual(withText().geometry);
    expect(screen.queryByLabelText("Text", { selector: "textarea" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove drawing" })).toBeTruthy();
  });

  it("converts what was just typed, once its edit lands", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    const field = screen.getByLabelText("Text", { selector: "textarea" });
    fireEvent.change(field, { target: { value: "Hello" } });
    // Clicking the button leaves the field first.
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Convert to drawing" }));
    await waitFor(() => expect(text()).toBeUndefined());
    expect(current().drawings.at(-1)?.name).toBe("Hello");
    expect(current().geometry.at(-1)?.paths[0]?.segments[0]?.to).toEqual([60, 10]);
  });

  it("doesn't convert when the edit it waits for is refused, keeping what was typed", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    const field = screen.getByLabelText<HTMLTextAreaElement>("Text", { selector: "textarea" });
    fireEvent.change(field, { target: { value: "∅" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Convert to drawing" }));
    expect(await screen.findByText(/nothing to cut/)).toBeTruthy();
    expect(text()?.text).toBe("I");
    expect(field.value).toBe("∅");
  });

  it("uploads a font, single-stroke if ticked, and sets the text in it", async () => {
    const { container } = render(<DrawingProperties drawingId={TEXT_ID} />, withText(), true);
    fireEvent.click(screen.getByLabelText("Single-stroke (for engraving)"));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File([await (await fetch(arvo)).arrayBuffer()], "Arvo-Regular.ttf");
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(text()?.font).toBe(current().fonts[0]?.sha256));
    expect(current().fonts[0]).toMatchObject({ name: "Arvo", singleStroke: true });
    const uploaded = screen.getByRole("group", { name: "Uploaded" });
    expect(uploaded.textContent).toBe("Arvo");
  });

  it("offers no upload where the host can't store fonts", () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    expect(screen.queryByRole("button", { name: "Upload font…" })).toBeNull();
  });

  it("puts blank text back, and refuses text the font has nothing for", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    const field = screen.getByLabelText<HTMLTextAreaElement>("Text", { selector: "textarea" });
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    await waitFor(() => expect(field.value).toBe("I"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(field, { target: { value: "∅" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(await screen.findByText(/nothing to cut/)).toBeTruthy();
    // What was typed stays, to be fixed.
    expect(field.value).toBe("∅");
    expect(current()).toEqual(withText());
  });
});
