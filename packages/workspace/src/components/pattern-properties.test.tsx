// @vitest-environment jsdom
import { type ProjectDocument, ProjectDocument as ProjectDocumentSchema } from "@furrow/document";
import { CIRCLE_ID, DRAWING_ID, fullDocument, SQUARE_ID } from "@furrow/document/fixtures";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { generateInside, type PatternWorkerRequest } from "../lib/patterns";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { drawingShapes, setDrawingSize, setObjectFlag } from "../stores/geometry-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import { renderWorkspace } from "../test-render";
import { DrawingProperties } from "./drawing-properties";
import { FillPatternButton } from "./pattern-properties";

/** The pattern worker, generating on the next microtask as the real one would. */
class PatternWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  postMessage({ id, boundary, settings }: PatternWorkerRequest) {
    const data = { id, ...generateInside(boundary, settings) };
    queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
  }
  terminate() {}
}
vi.stubGlobal("Worker", PatternWorker);

let stores: { document: DocumentStore; workspace: WorkspaceStore };

function Stores() {
  stores = { document: useDocumentStoreApi(), workspace: useWorkspaceStoreApi() };
  return null;
}

function render(ui: React.ReactElement, document: ProjectDocument = fullDocument()) {
  return renderWorkspace(
    <>
      <Stores />
      {ui}
    </>,
    createMemoryHost({ document }),
  );
}

const current = () => stores.document.getState().document;
const patternDrawing = () => current().drawings.find(({ pattern }) => pattern);
const select = (shapeId: string, mode: "replace" | "toggle" = "replace") =>
  act(() => stores.workspace.getState().selectPaths([{ shapeId, path: 0 }], mode));
const fillButton = () => screen.getByRole("button", { name: "Pattern" });

/** Fills the square and its hole with the default pattern; its id. */
async function fill(): Promise<string> {
  select(SQUARE_ID);
  select(CIRCLE_ID, "toggle");
  await waitFor(() => expect(fillButton().getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(fillButton());
  await waitFor(() => expect(patternDrawing()).toBeDefined());
  return patternDrawing()?.id as string;
}

describe("FillPatternButton", () => {
  it("is off, saying why, until closed paths of one drawing are selected", async () => {
    render(<FillPatternButton />);
    expect(fillButton().getAttribute("aria-disabled")).toBe("true");
    select(SQUARE_ID);
    await waitFor(() => expect(fillButton().getAttribute("aria-disabled")).toBeNull());
  });

  it("fills the selection in one undo step and selects the pattern", async () => {
    render(<FillPatternButton />);
    const before = current();
    const id = await fill();
    const drawing = patternDrawing();
    expect(drawing?.pattern).toMatchObject({
      cell: "hexagon",
      boundary: [
        { shapeId: SQUARE_ID, paths: null },
        { shapeId: CIRCLE_ID, paths: null },
      ],
      // The square's bottom-left corner.
      placement: { position: [0, 0], rotation: 0, mirrored: false },
    });
    const [shape] = drawingShapes(current().geometry, id);
    expect(shape?.paths.length).toBeGreaterThan(10);
    expect(stores.workspace.getState().selectedPaths[0]?.shapeId).toBe(shape?.id);
    expect(ProjectDocumentSchema.parse(current())).toEqual(current());
    act(() => stores.document.getState().undo());
    expect(current()).toEqual(before);
  });
});

describe("PatternProperties", () => {
  it("edits the cell and its size, each regenerated as one undo step, and converts", async () => {
    render(
      <>
        <FillPatternButton />
        <PatternPanel />
      </>,
    );
    const id = await fill();
    const cells = () => drawingShapes(current().geometry, id)[0]?.paths.length ?? 0;
    const hexagons = cells();

    fireEvent.click(await screen.findByRole("radio", { name: "Squares" }));
    await waitFor(() => expect(patternDrawing()?.pattern?.cell).toBe("square"));
    expect((screen.getByRole("radio", { name: "Squares" }) as HTMLInputElement).checked).toBe(true);
    // Its boundary places it: the drawing's own size and position aren't offered.
    expect(screen.queryByRole("button", { name: "Center on stock" })).toBeNull();
    expect(screen.queryByLabelText(/^Width/)).toBeNull();
    const gap = () => screen.getByLabelText(/^Gap/) as HTMLInputElement;
    expect(gap().disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Lines" }));
    await waitFor(() => expect(gap().disabled).toBe(true));
    fireEvent.click(screen.getByRole("radio", { name: "Squares" }));
    await waitFor(() => expect(gap().disabled).toBe(false));
    fireEvent.click(screen.getByLabelText("Mirrored"));
    await waitFor(() => expect(patternDrawing()?.pattern?.placement.mirrored).toBe(true));

    // `fullDocument` shows inches: 1 in cells, larger than the 10 mm default.
    const size = screen.getByLabelText(/^Cell size/);
    fireEvent.change(size, { target: { value: "1" } });
    fireEvent.keyDown(size, { key: "Enter" });
    await waitFor(() => expect(patternDrawing()?.pattern?.size).toBeCloseTo(25.4, 6));
    expect(cells()).toBeLessThan(hexagons);
    act(() => stores.document.getState().undo());
    expect(patternDrawing()?.pattern?.size).toBe(10);

    fireEvent.click(screen.getByRole("button", { name: "Convert to drawing" }));
    await waitFor(() =>
      expect(current().drawings.find((d) => d.id === id)?.pattern).toBeUndefined(),
    );
  });

  it("follows its boundary when resized, and stays when the boundary is hidden", async () => {
    render(<FillPatternButton />);
    const id = await fill();
    const count = drawingShapes(current().geometry, id)[0]?.paths.length ?? 0;
    act(() => {
      expect(setDrawingSize(stores.document, DRAWING_ID, "width", 200)).toEqual({ ok: true });
    });
    expect(drawingShapes(current().geometry, id)[0]?.paths.length).toBeGreaterThan(count * 2);
    act(() => setObjectFlag(stores.document, DRAWING_ID, "hidden", true));
    expect(patternDrawing()?.pattern).toBeDefined();
    expect(patternDrawing()?.hidden).toBeUndefined();
  });
});

/** The selected pattern's properties, as the viewport shows them. */
function PatternPanel() {
  const id = useDocumentStore((s) => s.document.drawings.find(({ pattern }) => pattern)?.id);
  return id ? <DrawingProperties drawingId={id} /> : null;
}
