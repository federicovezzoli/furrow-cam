// @vitest-environment jsdom
import { createProjectDocument, type ProjectDocument, stockPins } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
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
    expect(document().stock.twoSided).toEqual({
      flipAxis: "x",
      partingDepth: 9,
      tabs: null,
      lineUp: null,
    });
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

  it("sets locating pins: their positions on the flip axis and how deep their holes go", () => {
    const document = render(createProjectDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Two-sided" }));
    fireEvent.change(screen.getByLabelText("Lined up on"), { target: { value: "pins" } });
    expect(stockPins(document().stock)?.positions).toEqual([-240, 240]);
    fireEvent.click(screen.getByRole("button", { name: "Add pin" }));
    expect(stockPins(document().stock)?.positions).toEqual([-240, 240, 268.5]);
    expect(screen.getByLabelText(/^Pin 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove pin" }));
    expect(stockPins(document().stock)?.positions).toEqual([-240, 240]);
    expect(screen.getByRole("button", { name: "Remove pin" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Holes"), { target: { value: "blind" } });
    expect(stockPins(document().stock)?.holes).toEqual({ type: "blind", depth: 9 });
    expect(screen.getByLabelText(/Hole depth/)).toBeTruthy();
  });

  it("lines the stock up by a corner in a fence corner instead of pins", () => {
    const document = render(createProjectDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Two-sided" }));
    fireEvent.change(screen.getByLabelText("Lined up on"), { target: { value: "pins" } });
    fireEvent.change(screen.getByLabelText("Lined up on"), { target: { value: "edges" } });
    expect(document().stock.twoSided?.lineUp).toEqual({ type: "edges", corner: "bottom_left" });
    fireEvent.change(screen.getByLabelText("Corner"), { target: { value: "top_right" } });
    expect(document().stock.twoSided?.lineUp).toEqual({ type: "edges", corner: "top_right" });
    // 600 × 400 mm, turned over about X: the height is what the sides meet by.
    expect(screen.getByText(/exactly 400 mm along Y/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Lined up on"), { target: { value: "none" } });
    expect(document().stock.twoSided).toMatchObject({ lineUp: null });
  });

  it("turns holding tabs on, sizes them and spreads them round the models", () => {
    const document = render({ ...createProjectDocument(), models: [model] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Two-sided" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Holding tabs" }));
    expect(document().stock.twoSided?.tabs).toMatchObject({ width: 6, thickness: 2 });
    expect(screen.getByText("4 tabs")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Tabs per model/), { target: { value: "3" } });
    fireEvent.blur(screen.getByLabelText(/Tabs per model/));
    fireEvent.click(screen.getByRole("button", { name: "Place" }));
    expect(document().stock.twoSided?.tabs?.positions).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: "Holding tabs" }));
    expect(document().stock.twoSided?.tabs).toBeNull();
  });

  it("says a tab thickness is refused until the bottom side gets deeper", () => {
    render({ ...createProjectDocument(), models: [model] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Two-sided" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Holding tabs" }));
    const thickness = screen.getByLabelText(/Tab thickness/);
    fireEvent.change(thickness, { target: { value: "15" } });
    fireEvent.blur(thickness);
    expect(screen.getByText(/Must be thinner than the bottom side's depth/)).toBeTruthy();
    const parting = screen.getByLabelText(/Parting depth/);
    fireEvent.change(parting, { target: { value: "2" } });
    fireEvent.blur(parting);
    expect(screen.queryByText(/Must be thinner than the bottom side's depth/)).toBeNull();
  });

  it("says when drills of the pins cut nothing, once the stock isn't lined up on pins", () => {
    const full = fullDocument();
    const pinDrill = {
      ...(full.operations[0] as (typeof full.operations)[number]),
      type: "drill" as const,
      targets: [],
      params: { depth: 5, peck: false, stepOver: 40, pins: true },
    };
    render({ ...full, operations: [pinDrill] });
    expect(screen.queryByText(/drill of the pins cuts nothing/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Lined up on"), { target: { value: "edges" } });
    expect(screen.getByText("1 drill of the pins cuts nothing without pins.")).toBeTruthy();
  });
});
