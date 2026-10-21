import { describe, expect, it } from "vitest";
import { createProjectDocument } from "./document";
import { CIRCLE_ID, fullDocument, model, reliefFinish, reliefRough, SQUARE_ID } from "./fixtures";
import {
  type Migration,
  migrateProjectDocument,
  ProjectDocumentVersionError,
  parseProjectDocument,
  readProjectJson,
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

  it("lets migrations edit nested objects without touching the input", () => {
    const v2 = { schemaVersion: 2, stock: { width: 10 } };
    const inPlace: Record<number, Migration> = {
      2: (doc) => {
        (doc.stock as { width: number }).width = 20;
        return doc;
      },
    };
    expect(migrateProjectDocument(v2, inPlace, 3)).toEqual({
      schemaVersion: 3,
      stock: { width: 20 },
    });
    expect(v2.stock.width).toBe(10);
  });

  it("fails when a migration does not return an object", () => {
    const broken = { 1: () => undefined } as unknown as Record<number, Migration>;
    expect(() => migrateProjectDocument({ schemaVersion: 1 }, broken, 2)).toThrow(
      ProjectDocumentVersionError,
    );
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

describe("migrations", () => {
  it("turns v1 shape ids into whole-shape targets", () => {
    const { schemaVersion: _, operations, ...rest } = fullDocument();
    const [operation] = operations;
    if (!operation) throw new Error("fixture");
    const { targets: _targets, ...fields } = operation;
    const { entryClearance: _clearance, ...machine } = rest.machine ?? {};
    const v1 = {
      ...rest,
      schemaVersion: 1,
      machine,
      operations: [{ ...fields, shapeIds: [SQUARE_ID, CIRCLE_ID] }],
    };
    expect(parseProjectDocument(v1).operations).toEqual([
      {
        ...fields,
        targets: [
          { shapeId: SQUARE_ID, paths: null },
          { shapeId: CIRCLE_ID, paths: null },
        ],
      },
    ]);
  });

  it("gives v2 machine snapshots the old 1 mm entry clearance", () => {
    const doc = fullDocument();
    const { entryClearance: _, ...machine } = doc.machine ?? {};
    const v2 = { ...doc, schemaVersion: 2, machine };
    expect(parseProjectDocument(v2).machine).toEqual({ ...machine, entryClearance: 1 });
    expect(parseProjectDocument({ ...v2, machine: null }).machine).toBeNull();
  });

  it("caps the migrated entry clearance at a safe Z below 1 mm", () => {
    const doc = fullDocument();
    const { entryClearance: _, ...machine } = doc.machine ?? {};
    const v2 = { ...doc, schemaVersion: 2, machine: { ...machine, safeZ: 0.5 } };
    expect(parseProjectDocument(v2).machine).toMatchObject({ safeZ: 0.5, entryClearance: 0.5 });
  });

  it("gives v3 pockets offset clearing and leaves other operations alone", () => {
    const doc = fullDocument();
    const [profile] = doc.operations;
    if (profile?.type !== "profile") throw new Error("fixture");
    const pocket = {
      ...profile,
      id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
      type: "pocket",
      name: "Pocket",
      params: { direction: "climb", depth: 6, allowance: 0, finishPass: false, ramp: true },
    };
    const v3 = { ...doc, schemaVersion: 3, operations: [profile, pocket] };
    expect(parseProjectDocument(v3).operations).toEqual([
      profile,
      { ...pocket, params: { ...pocket.params, strategy: { type: "offset" } } },
    ]);
  });

  it("leaves v4 and v5 documents as they are", () => {
    const doc = fullDocument();
    expect(parseProjectDocument({ ...doc, schemaVersion: 4 })).toEqual(doc);
    expect(parseProjectDocument({ ...doc, schemaVersion: 5 })).toEqual(doc);
  });

  it("gives v6 documents no models", () => {
    const { models: _, ...v6 } = { ...fullDocument(), schemaVersion: 6 };
    expect(parseProjectDocument(v6)).toEqual(fullDocument());
  });

  it("keeps v7 and v8 documents as they are", () => {
    const doc = fullDocument();
    expect(parseProjectDocument({ ...doc, schemaVersion: 7 })).toEqual(doc);
    expect(parseProjectDocument({ ...doc, schemaVersion: 8 })).toEqual(doc);
  });

  it("gives v9 3D operations no rest machining and leaves the others alone", () => {
    const doc = fullDocument();
    doc.models = [model];
    doc.operations.push(reliefFinish, reliefRough);
    const v9 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      operations: { params: Record<string, unknown> }[];
    };
    v9.schemaVersion = 9;
    for (const operation of v9.operations.slice(-2)) delete operation.params.rest;
    expect(parseProjectDocument(v9)).toEqual(doc);
  });

  it("turns v10 roughing boundaries into objects", () => {
    const doc = fullDocument();
    doc.models = [model];
    const stock: typeof reliefRough = {
      ...reliefRough,
      id: "5b1e2c4d-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      params: { ...reliefRough.params, boundary: { type: "stock" } },
    };
    doc.operations.push(reliefFinish, reliefRough, stock);
    const v10 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      operations: { params: Record<string, unknown> }[];
    };
    v10.schemaVersion = 10;
    const [, model10, stock10] = v10.operations.slice(-3);
    if (model10) model10.params.boundary = "model";
    if (stock10) stock10.params.boundary = "stock";
    expect(parseProjectDocument(v10)).toEqual(doc);
  });

  it("gives v11 finishing operations parallel passes", () => {
    const doc = fullDocument();
    doc.models = [model];
    doc.operations.push(reliefFinish, reliefRough);
    const v11 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      operations: { params: Record<string, unknown> }[];
    };
    v11.schemaVersion = 11;
    const finish = v11.operations.at(-2) as { params: Record<string, unknown> };
    const { strategy: _, ...params } = finish.params;
    finish.params = { ...params, angle: 0, direction: "zigzag" };
    expect(parseProjectDocument(v11)).toEqual(doc);
  });

  it("gives v12 stocks no touch-off pad", () => {
    const doc = fullDocument();
    const v12 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      stock: Record<string, unknown>;
    };
    v12.schemaVersion = 12;
    delete v12.stock.touchOff;
    expect(parseProjectDocument(v12)).toEqual({ ...doc, stock: { ...doc.stock, touchOff: null } });
  });

  it("gives v13 touch-off pads the machine's tool change", () => {
    const doc = fullDocument();
    const v13 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      stock: { touchOff: Record<string, unknown> };
    };
    v13.schemaVersion = 13;
    delete v13.stock.touchOff.toolChange;
    expect(parseProjectDocument(v13)).toEqual(doc);
  });

  it("gives v14 machine snapshots the default spin-up delay", () => {
    const doc = fullDocument();
    const v14 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      machine: Record<string, unknown>;
    };
    v14.schemaVersion = 14;
    delete v14.machine.spinUpDelay;
    const machine = doc.machine && { ...doc.machine, spinUpDelay: 5 };
    expect(parseProjectDocument(v14)).toEqual({ ...doc, machine });
    expect(parseProjectDocument({ ...v14, machine: null }).machine).toBeNull();
  });

  it("gives v15 models the 10 mm border they were fitted with", () => {
    const doc = { ...fullDocument(), models: [model] };
    const v15 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      models: Record<string, unknown>[];
    };
    v15.schemaVersion = 15;
    for (const stored of v15.models) delete stored.border;
    expect(parseProjectDocument(v15)).toEqual(doc);
  });

  it("puts v16 shapes into one drawing named after their file", () => {
    const doc = fullDocument();
    const v16 = JSON.parse(JSON.stringify(doc)) as {
      schemaVersion: number;
      drawings?: unknown;
      geometry: Record<string, unknown>[];
    };
    v16.schemaVersion = 16;
    delete v16.drawings;
    for (const shape of v16.geometry) delete shape.drawingId;
    const migrated = parseProjectDocument(v16);
    const [drawing] = migrated.drawings;
    expect(migrated.drawings).toEqual([{ id: expect.any(String), name: "part.dxf", border: 10 }]);
    expect(migrated.geometry.map((shape) => shape.drawingId)).toEqual([drawing?.id, drawing?.id]);
    expect({ ...migrated, drawings: doc.drawings, geometry: doc.geometry }).toEqual(doc);
  });

  it("names a v16 drawing whose file isn't known, and gives empty projects none", () => {
    const v16 = JSON.parse(JSON.stringify(fullDocument())) as {
      schemaVersion: number;
      drawings?: unknown;
      geometry: Record<string, unknown>[];
    };
    v16.schemaVersion = 16;
    delete v16.drawings;
    for (const shape of v16.geometry) {
      delete shape.drawingId;
      delete shape.source;
    }
    expect(parseProjectDocument(v16).drawings).toMatchObject([{ name: "Drawing" }]);
    const { drawings: _, ...empty } = { ...createProjectDocument(), schemaVersion: 16 };
    expect(parseProjectDocument(empty)).toEqual(createProjectDocument());
  });

  it("leaves v1 documents without operations alone", () => {
    const { schemaVersion: _, ...rest } = createProjectDocument();
    expect(parseProjectDocument({ ...rest, schemaVersion: 1 })).toEqual(createProjectDocument());
  });
});

describe("parseProjectDocument", () => {
  it("parses current documents", () => {
    const doc = fullDocument();
    expect(parseProjectDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(parseProjectDocument(createProjectDocument())).toEqual(createProjectDocument());
  });

  it("throws a too-new error for documents from a newer release", () => {
    expect(() => parseProjectDocument({ ...fullDocument(), schemaVersion: 99 })).toThrow(
      expect.objectContaining({ name: "ProjectDocumentTooNewError", version: 99 }),
    );
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

describe("readProjectJson", () => {
  const reason = (input: unknown) => readProjectJson(input).reason;

  it("reads documents and their JSON text", () => {
    const doc = fullDocument();
    expect(readProjectJson(doc)).toEqual({ document: doc });
    expect(readProjectJson(JSON.stringify(doc))).toEqual({ document: doc });
  });

  it("classifies why a project can't be read", () => {
    for (const input of ["{", "[]", "null", '{"name":"x"}', [], 3]) {
      expect(reason(input)).toBe("not_a_project");
    }
    expect(reason({ ...fullDocument(), schemaVersion: 99 })).toBe("too_new");
    expect(reason({ ...fullDocument(), schemaVersion: 0 })).toBe("version");
    expect(reason({ ...fullDocument(), units: "cm" })).toBe("invalid");
  });
});
