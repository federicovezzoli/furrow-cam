// @vitest-environment jsdom
import { createProjectDocument, type ProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStore } from "../providers/workspace-stores";
import { renderWorkspace } from "../test-render";
import { StockProperties } from "./stock-properties";

/** Renders the stock properties of `document`, and returns the document as edited. */
function render(document: ProjectDocument) {
  const seen: { document: ProjectDocument | null } = { document: null };
  function Probe() {
    seen.document = useDocumentStore((s) => s.document);
    return null;
  }
  renderWorkspace(
    <>
      <StockProperties machines={[]} />
      <Probe />
    </>,
    createMemoryHost({ document }),
  );
  return () => seen.document as ProjectDocument;
}

describe("StockProperties: two-sided (ADR-0060)", () => {
  it("turns two-sided on, showing the flip axis and the parting depth", () => {
    const document = render(createProjectDocument());
    expect(screen.queryByLabelText("Turned over about")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Two-sided" }));
    expect(document().stock.twoSided).toEqual({ flipAxis: "x", partingDepth: 9 });
    fireEvent.change(screen.getByLabelText("Turned over about"), { target: { value: "y" } });
    expect(document().stock.twoSided?.flipAxis).toBe("y");
    expect(screen.getByLabelText(/Parting depth/)).toBeTruthy();
  });

  it("asks before turning it off, then moves the bottom side's operations to the top", async () => {
    const full = fullDocument();
    const operations = full.operations.map((op) => ({ ...op, stockSide: "bottom" as const }));
    const document = render({ ...full, operations });
    fireEvent.click(screen.getByRole("checkbox", { name: "Two-sided" }));
    expect(
      await screen.findByText(/1 operation is on the bottom side\. Turning two-sided off moves it/),
    ).toBeTruthy();
    expect(document().stock.twoSided).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(document().stock.twoSided).toBeNull());
    expect(document().operations.map((op) => op.stockSide)).toEqual(["top"]);
  });
});
