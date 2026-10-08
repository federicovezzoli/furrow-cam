import { describe, expect, it } from "vitest";
import { createProjectDocument } from "./document";
import { fullDocument } from "./fixtures";
import {
  type Migration,
  migrateProjectDocument,
  ProjectDocumentVersionError,
  parseProjectDocument,
} from "./migrations";

describe("migrateProjectDocument", () => {
  // A made-up history: v1 had `size`, v2 renamed it to `stock`, v3 added `units`.
  const chain: Record<number, Migration> = {
    1: ({ size, ...doc }) => ({ ...doc, stock: size }),
    2: (doc) => ({ ...doc, units: "mm" }),
  };

  it("applies each migration in order and bumps the version", () => {
    const v1 = { schemaVersion: 1, size: { width: 10 } };
    expect(migrateProjectDocument(v1, chain, 3)).toEqual({
      schemaVersion: 3,
      stock: { width: 10 },
      units: "mm",
    });
  });

  it("starts from the document's own version", () => {
    const v2 = { schemaVersion: 2, stock: { width: 10 } };
    expect(migrateProjectDocument(v2, chain, 3)).toEqual({
      schemaVersion: 3,
      stock: { width: 10 },
      units: "mm",
    });
  });

  it("leaves current documents untouched", () => {
    const v3 = { schemaVersion: 3, stock: {}, units: "in" };
    expect(migrateProjectDocument(v3, chain, 3)).toBe(v3);
  });

  it("does not mutate the input", () => {
    const v1 = { schemaVersion: 1, size: { width: 10 } };
    migrateProjectDocument(v1, chain, 3);
    expect(v1).toEqual({ schemaVersion: 1, size: { width: 10 } });
  });

  it("fails on gaps in the chain", () => {
    expect(() =>
      migrateProjectDocument({ schemaVersion: 1 }, { 2: chain[2] as Migration }, 3),
    ).toThrow(ProjectDocumentVersionError);
  });

  it("rejects newer, missing or malformed versions", () => {
    for (const json of [
      { schemaVersion: 4 },
      {},
      { schemaVersion: "1" },
      { schemaVersion: 0 },
      { schemaVersion: 1.5 },
      [],
      null,
      "{}",
    ]) {
      expect(() => migrateProjectDocument(json, chain, 3)).toThrow(ProjectDocumentVersionError);
    }
  });
});

describe("parseProjectDocument", () => {
  it("parses current documents", () => {
    const doc = fullDocument();
    expect(parseProjectDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(parseProjectDocument(createProjectDocument())).toEqual(createProjectDocument());
  });

  it("throws a version error for documents from a newer release", () => {
    expect(() => parseProjectDocument({ ...fullDocument(), schemaVersion: 99 })).toThrow(
      ProjectDocumentVersionError,
    );
  });

  it("throws a validation error for invalid documents", () => {
    expect(() => parseProjectDocument({ ...fullDocument(), units: "cm" })).toThrow(
      expect.objectContaining({ name: "ZodError" }),
    );
  });
});
