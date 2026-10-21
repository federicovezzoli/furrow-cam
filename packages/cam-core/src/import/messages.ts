import type { Message } from "@furrow/document";

/**
 * What the importers say (ADR-0054): why a file can't be imported, and what
 * was skipped or assumed. Skip messages carry the number of items skipped.
 */
export const IMPORT_MESSAGES = [
  "svg.invalidXml",
  "svg.notSvg",
  "svg.stylesheetHides",
  "svg.tooManyElements",
  "svg.skip.circular",
  "svg.skip.invalidTransform",
  "svg.skip.invalidPosition",
  "svg.skip.nestedViewports",
  "svg.skip.missingReferences",
  "svg.skip.invalidSizes",
  "svg.skip.tooLarge",
  "svg.skip.text",
  "svg.skip.images",
  "svg.skip.foreignObject",
  "dxf.binary",
  "dxf.invalid",
  "dxf.notDxf",
  "dxf.codepage",
  "dxf.tooManyEntities",
  "dxf.skip.paperSpace",
  "dxf.skip.layersOff",
  "dxf.skip.entityType",
  "dxf.skip.tilted",
  "dxf.skip.invalidCoordinates",
  "dxf.skip.missingBlocks",
  "dxf.skip.xrefs",
  "dxf.skip.recursiveBlocks",
  "dxf.skip.invalidBlockRefs",
  "dxf.skip.fitSplines",
  "dxf.skip.invalidSplines",
  "dxf.skip.text",
  "dxf.skip.dimensions",
  "dxf.skip.leaders",
  "dxf.skip.hatches",
  "dxf.skip.images",
  "dxf.skip.solids",
  "dxf.skip.faces",
  "stl.tooLarge",
  "stl.empty",
  "stl.sizeMismatch",
  "stl.tooManyTriangles",
  "stl.noTriangles",
  "stl.vertexNaN",
  "stl.facetInFacet",
  "stl.vertexOutside",
  "stl.tooManyVertices",
  "stl.vertexCoordinates",
  "stl.facetVertices",
  "stl.notStl",
  "stl.unfinished",
] as const;

export type ImportMessageCode = (typeof IMPORT_MESSAGES)[number];
export type ImportMessage = Message<ImportMessageCode>;

/** Counts what an import skips, by message: `type` tells entity types apart. */
export class SkipCounter<Code extends ImportMessageCode> {
  private readonly counts = new Map<string, { code: Code; type?: string; count: number }>();

  add(code: Code, type?: string) {
    const key = type === undefined ? code : `${code}:${type}`;
    const entry = this.counts.get(key) ?? { code, ...(type !== undefined && { type }), count: 0 };
    entry.count++;
    this.counts.set(key, entry);
  }

  /** One message per kind of thing skipped, in the order first met. */
  messages(): ImportMessage[] {
    return Array.from(this.counts.values(), ({ code, type, count }) => {
      const values: Record<string, string | number> = { count };
      if (type !== undefined) values.type = type;
      return { code, values };
    });
  }
}
