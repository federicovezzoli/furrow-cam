import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, ProjectDocument } from "./index";

describe("ProjectDocument", () => {
  it("accepts a minimal valid document", () => {
    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      units: "mm",
      stock: { width: 300, height: 200, thickness: 18 },
    };
    expect(ProjectDocument.parse(doc)).toEqual(doc);
  });

  it("rejects non-positive stock dimensions", () => {
    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      units: "mm",
      stock: { width: 0, height: 200, thickness: 18 },
    };
    expect(ProjectDocument.safeParse(doc).success).toBe(false);
  });
});
