import { createProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { projectSummary } from "./summary";

describe("projectSummary", () => {
  it("gives lengths in millimetres, and the stock and zero in the project's units", () => {
    const summary = projectSummary(fullDocument());
    expect(summary.units).toBe("in");
    expect(summary.stock).toMatchObject({
      width: 300,
      xyOrigin: { anchor: "center" },
      inProjectUnits: { size: "11.811 in × 7.874 in × 0.7087 in", xyOrigin: "center" },
    });
    expect(summary.operations).toEqual(fullDocument().operations);
  });

  it("writes out a custom zero", () => {
    const document = createProjectDocument();
    document.stock.xyOrigin = { anchor: "custom", x: 10, y: -5 };
    expect(projectSummary(document).stock.inProjectUnits.xyOrigin).toBe(
      "10 mm, -5 mm from the stock's bottom-left corner",
    );
  });

  it("lists each drawing's shapes and bounds in stock coordinates", () => {
    const [drawing] = projectSummary(fullDocument()).drawings;
    expect(drawing).toMatchObject({ name: "part.dxf", rotation: 0, shapes: [{}, {}] });
    expect(drawing?.shapes[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      layer: expect.any(String),
      paths: expect.any(Number),
    });
    expect(drawing?.bounds).toEqual({ min: expect.any(Array), max: expect.any(Array) });
  });
});
