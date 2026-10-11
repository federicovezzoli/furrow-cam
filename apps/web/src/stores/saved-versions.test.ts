import { createProjectDocument } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { latestVersion, rememberSavedVersion } from "./saved-versions";

describe("latestVersion", () => {
  it("prefers a newer version saved from this tab", () => {
    const rendered = { document: createProjectDocument(), updatedAt: new Date(1000) };
    expect(latestVersion("a", rendered)).toBe(rendered);

    const saved = { document: createProjectDocument(), updatedAt: new Date(2000) };
    rememberSavedVersion("a", saved);
    expect(latestVersion("a", rendered)).toBe(saved);
    expect(latestVersion("b", rendered)).toBe(rendered);

    const newer = { ...rendered, updatedAt: new Date(3000) };
    expect(latestVersion("a", newer)).toBe(newer);
  });
});
