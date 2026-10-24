// @vitest-environment jsdom
import { createProjectDocument, type Path, type ProjectDocument } from "@furrow/document";
import { fullDocument, TEXT_ID, textItem, textShape } from "@furrow/document/fixtures";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function render(ui: React.ReactElement, document: ProjectDocument) {
  return renderWorkspace(
    <>
      <Stores />
      {ui}
    </>,
    createMemoryHost({ document }),
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
    const field = screen.getByLabelText("Text", { selector: "input" });
    fireEvent.change(field, { target: { value: "Hello" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(text()?.text).toBe("Hello"));
    expect(current().drawings.at(-1)?.name).toBe("Hello");
    const shape = current().geometry.at(-1);
    expect(shape?.id).toBe(textShape.id);
    // The fake worker's box: 5 characters at 10 mm, from the item's origin.
    expect(shape?.paths[0]?.segments[0]?.to).toEqual([60, 10]);

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

  it("refuses blank text and text the font has nothing for", async () => {
    render(<DrawingProperties drawingId={TEXT_ID} />, withText());
    const field = screen.getByLabelText("Text", { selector: "input" });
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    expect((await screen.findByRole("alert")).textContent).toMatch(/blank/i);
    fireEvent.change(field, { target: { value: "∅" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByText(/nothing to cut/)).toBeTruthy();
    expect(current()).toEqual(withText());
  });
});
