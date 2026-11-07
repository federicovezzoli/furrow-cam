// @vitest-environment jsdom
import type { Rect } from "@furrow/cam-core";
import type { ProjectDocument } from "@furrow/document";
import { DRAWING_ID, fullDocument } from "@furrow/document/fixtures";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { drawingBounds } from "../stores/geometry-actions";
import { renderWorkspace } from "../test-render";
import { DrawingProperties } from "./drawing-properties";

type Seen = { store: DocumentStore | null };

function Probe({ seen }: { seen: Seen }) {
  seen.store = useDocumentStoreApi();
  return null;
}

/** Renders the fixture drawing's properties, and returns its document store. */
function render(document: ProjectDocument = fullDocument()) {
  const seen: Seen = { store: null };
  renderWorkspace(
    <>
      <DrawingProperties drawingId={DRAWING_ID} />
      <Probe seen={seen} />
    </>,
    createMemoryHost({ document }),
  );
  return seen.store as DocumentStore;
}

const angle = () => screen.getByLabelText(/Angle/) as HTMLInputElement;

describe("DrawingProperties: angle (ADR-0066)", () => {
  it("shows the drawing's rotation, following the 90° buttons, typed angles and undo", () => {
    const store = render();
    const rotation = () => store.getState().document.drawings[0]?.rotation;
    expect(angle().value).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Turn 90° clockwise" }));
    expect(rotation()).toBe(-90);
    expect(angle().value).toBe("-90");
    fireEvent.click(screen.getByRole("button", { name: "Mirror left to right" }));
    expect(angle().value).toBe("90");
    fireEvent.change(angle(), { target: { value: "30" } });
    fireEvent.keyDown(angle(), { key: "Enter" });
    expect(rotation()).toBe(30);
    fireEvent.change(angle(), { target: { value: "0" } });
    fireEvent.blur(angle());
    expect(rotation()).toBe(0);
    act(() => store.getState().undo());
    expect(angle().value).toBe("30");
  });
});

describe("DrawingProperties: center on stock", () => {
  it("moves the drawing's box to the middle of the stock", () => {
    const store = render();
    fireEvent.click(screen.getByRole("button", { name: "Center on stock" }));
    const { document } = store.getState();
    const bounds = drawingBounds(document.geometry, DRAWING_ID) as Rect;
    expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(document.stock.width / 2, 9);
    expect((bounds.min[1] + bounds.max[1]) / 2).toBeCloseTo(document.stock.height / 2, 9);
  });
});
