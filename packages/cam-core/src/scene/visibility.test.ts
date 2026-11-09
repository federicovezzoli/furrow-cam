import type { ProjectDocument } from "@furrow/document";
import {
  CIRCLE_ID,
  DRAWING_ID,
  fullDocument,
  model,
  reliefFinish,
  SQUARE_ID,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { flaggedIds, machinedDocument } from "./visibility";

/** The fixture's profile cuts the square and the circle; with a relief on the model. */
function document(): ProjectDocument {
  const doc = fullDocument();
  return { ...doc, models: [model], operations: [...doc.operations, reliefFinish] };
}

function hide(doc: ProjectDocument, ids: string[]): ProjectDocument {
  const flag = <T extends { id: string }>(item: T) =>
    ids.includes(item.id) ? { ...item, hidden: true as const } : item;
  return {
    ...doc,
    drawings: doc.drawings.map(flag),
    geometry: doc.geometry.map(flag),
    models: doc.models.map(flag),
  };
}

describe("flaggedIds (ADR-0080)", () => {
  it("flags a drawing's shapes with it, and models on their own", () => {
    expect(flaggedIds(document(), "hidden")).toEqual(new Set());
    expect(flaggedIds(hide(document(), [DRAWING_ID]), "hidden")).toEqual(
      new Set([SQUARE_ID, CIRCLE_ID]),
    );
    expect(flaggedIds(hide(document(), [CIRCLE_ID, model.id]), "hidden")).toEqual(
      new Set([CIRCLE_ID, model.id]),
    );
  });
});

describe("machinedDocument (ADR-0080)", () => {
  it("is the document itself when nothing is hidden, and the same result for the same document", () => {
    const doc = document();
    expect(machinedDocument(doc)).toBe(doc);
    const hidden = hide(doc, [CIRCLE_ID]);
    expect(machinedDocument(hidden)).toBe(machinedDocument(hidden));
    expect(machinedDocument(machinedDocument(hidden))).toBe(machinedDocument(hidden));
  });

  it("cuts only the visible targets, and turns off what has none left or a hidden model", () => {
    const partly = machinedDocument(hide(document(), [CIRCLE_ID]));
    expect(partly.operations[0]).toMatchObject({
      enabled: true,
      targets: [{ shapeId: SQUARE_ID }],
    });
    expect(partly.operations[1]).toBe(reliefFinish);

    const all = machinedDocument(hide(document(), [DRAWING_ID, model.id]));
    expect(all.operations.map(({ enabled }) => enabled)).toEqual([false, false]);
  });

  it("never writes to the document", () => {
    const doc = hide(document(), [DRAWING_ID]);
    machinedDocument(doc);
    expect(doc.operations[0]?.enabled).toBe(true);
  });
});
