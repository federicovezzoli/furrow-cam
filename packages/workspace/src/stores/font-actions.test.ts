import { createProjectDocument } from "@furrow/document";
import { uploadedFont } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { addFont } from "./font-actions";

describe("addFont", () => {
  it("lists a font once, and no more than a project holds", () => {
    const store = createDocumentStore(createProjectDocument());
    expect(addFont(store, uploadedFont)).toBe(true);
    expect(addFont(store, uploadedFont)).toBe(true);
    expect(store.getState().document.fonts).toEqual([uploadedFont]);
    for (const c of ["a", "b", "c"]) addFont(store, { ...uploadedFont, sha256: c.repeat(64) });
    expect(addFont(store, { ...uploadedFont, sha256: "d".repeat(64) })).toBe(false);
    expect(store.getState().document.fonts).toHaveLength(4);
  });
});
