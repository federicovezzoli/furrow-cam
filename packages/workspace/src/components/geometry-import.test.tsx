// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { renderWorkspace } from "../test-render";
import { GeometryImport, ImportDrawingButton } from "./geometry-import";

const DRAWING_ID = "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

describe("ImportDrawingButton", () => {
  it("opens the drawing file input once the project holds drawings", () => {
    const host = createMemoryHost({
      document: {
        ...createProjectDocument(),
        drawings: [{ id: DRAWING_ID, name: "", border: 10 }],
        geometry: [
          {
            id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
            name: "Square",
            layer: "0",
            drawingId: DRAWING_ID,
            paths: [{ start: [0, 0], segments: [{ kind: "line", to: [10, 0] }], closed: false }],
          },
        ],
      },
    });
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(
      <>
        <ImportDrawingButton />
        <GeometryImport />
      </>,
      host,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import SVG/DXF…" }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("isn't shown while the project is empty", () => {
    renderWorkspace(<ImportDrawingButton />);
    expect(screen.queryByRole("button", { name: "Import SVG/DXF…" })).toBeNull();
  });
});
