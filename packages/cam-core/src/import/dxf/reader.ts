import type { ImportMessage } from "../messages";

/** One group of a DXF file: a group code and its value, as text. */
export type DxfPair = { code: number; value: string };

/** A record that starts with a code 0 pair, e.g. an entity or a table entry, without that pair. */
export type DxfRecord = { type: string; pairs: DxfPair[] };

/** The file isn't an ASCII DXF file at all; anything less is a warning instead. */
export class DxfImportError extends Error {
  /** Why, for the UI to translate (ADR-0054); the `message` is its code. */
  constructor(readonly detail: ImportMessage) {
    super(detail.code);
  }
}

const BINARY_SENTINEL = "AutoCAD Binary DXF";

/** `$DWGCODEPAGE` values with their WHATWG encoding labels. */
const CODEPAGES: Record<string, string> = {
  ansi_874: "windows-874",
  ansi_932: "shift_jis",
  ansi_936: "gbk",
  ansi_949: "euc-kr",
  ansi_950: "big5",
  ansi_1250: "windows-1250",
  ansi_1251: "windows-1251",
  ansi_1252: "windows-1252",
  ansi_1253: "windows-1253",
  ansi_1254: "windows-1254",
  ansi_1255: "windows-1255",
  ansi_1256: "windows-1256",
  ansi_1257: "windows-1257",
  ansi_1258: "windows-1258",
};

/** `$ACADVER` from which DXF files are UTF-8 (AutoCAD 2007). */
const UTF8_VERSION = "AC1021";

type TextDecoderLike = { decode(bytes: Uint8Array): string };
type TextDecoderConstructor = new (
  label?: string,
  options?: { fatal?: boolean },
) => TextDecoderLike;

/** Workers, browsers and Node all have `TextDecoder`; the package's lib types don't include it. */
const Decoder = (globalThis as unknown as { TextDecoder: TextDecoderConstructor }).TextDecoder;

/**
 * Decodes a DXF file's bytes. AutoCAD 2007 and later write UTF-8; earlier
 * versions use the code page in `$DWGCODEPAGE`. A file that states neither is
 * read as UTF-8 if it is valid UTF-8, else as Windows-1252, DXF's default.
 * Only names and text depend on it: coordinates are ASCII.
 */
export function decodeDxf(bytes: Uint8Array): { text: string; warnings: ImportMessage[] } {
  // Every DXF encoding is ASCII-compatible, so the header can be read as Latin-1 first.
  // Binary files decode to text that starts with their sentinel, which `readPairs` rejects.
  const latin1 = new Decoder("latin1").decode(bytes.subarray(0, 64 * 1024));
  const version = headerValue(latin1, "$ACADVER");
  const codepage = headerValue(latin1, "$DWGCODEPAGE");
  if (version !== null && version.toUpperCase() >= UTF8_VERSION) {
    return { text: new Decoder("utf-8").decode(bytes), warnings: [] };
  }
  if (codepage !== null) {
    const label = CODEPAGES[codepage.toLowerCase()];
    if (label) return { text: new Decoder(label).decode(bytes), warnings: [] };
    return {
      text: new Decoder("windows-1252").decode(bytes),
      warnings: [{ code: "dxf.codepage", values: { codepage } }],
    };
  }
  try {
    return { text: new Decoder("utf-8", { fatal: true }).decode(bytes), warnings: [] };
  } catch {
    return { text: new Decoder("windows-1252").decode(bytes), warnings: [] };
  }
}

/**
 * The value of a header variable with a single string value, read without
 * parsing the file, with any line endings and padding `readPairs` accepts.
 */
function headerValue(text: string, name: string): string | null {
  const escaped = name.replace("$", "\\$");
  const end = String.raw`[ \t]*(?:\r\n|\r|\n)[ \t]*`;
  // In multiline mode `^` also matches after a lone `\r`.
  const match = text.match(
    new RegExp(String.raw`^[ \t]*9${end}${escaped}${end}\d+${end}([^\r\n]*)`, "m"),
  );
  return match ? (match[1] as string).trim() : null;
}

/** Splits a DXF file into pairs. Throws `DxfImportError` if it isn't one. */
export function readPairs(text: string): DxfPair[] {
  if (text.startsWith(BINARY_SENTINEL)) {
    throw new DxfImportError({ code: "dxf.binary" });
  }
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  // A trailing newline leaves an empty last line.
  if (lines.at(-1) === "") lines.pop();
  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeText = (lines[i] as string).trim();
    if (!/^-?\d+$/.test(codeText)) {
      throw new DxfImportError({ code: "dxf.invalid", values: { line: i + 1 } });
    }
    pairs.push({ code: Number(codeText), value: lines[i + 1] as string });
  }
  const first = pairs.find((pair) => pair.code !== 999);
  if (first?.code !== 0 || first.value.trim() !== "SECTION") {
    throw new DxfImportError({ code: "dxf.notDxf" });
  }
  return pairs;
}

/** The records of each section by name (`HEADER`, `TABLES`, `BLOCKS`, `ENTITIES`, …). */
export function readSections(pairs: DxfPair[]): Map<string, DxfRecord[]> {
  const sections = new Map<string, DxfRecord[]>();
  let records: DxfRecord[] | null = null;
  let current: DxfRecord | null = null;
  let expectName = false;
  for (const pair of pairs) {
    if (pair.code === 999) continue;
    const value = pair.value.trim();
    if (expectName) {
      expectName = false;
      if (pair.code === 2) {
        records = [];
        // A repeated section adds to the first, which is what readers do in practice.
        const existing = sections.get(value.toUpperCase());
        if (existing) records = existing;
        else sections.set(value.toUpperCase(), records);
        continue;
      }
    }
    if (pair.code === 0) {
      if (value === "SECTION") {
        expectName = true;
        records = null;
        current = null;
        continue;
      }
      if (value === "ENDSEC" || value === "EOF") {
        records = null;
        current = null;
        continue;
      }
      if (records) {
        current = { type: value, pairs: [] };
        records.push(current);
      }
      continue;
    }
    if (!current && records) {
      // Pairs before the section's first code 0, which is all of HEADER, form an untyped record.
      current = { type: "", pairs: [] };
      records.push(current);
    }
    current?.pairs.push(pair);
  }
  return sections;
}

/** The header variables, each with the pairs that follow its code 9 name. */
export function readHeader(records: DxfRecord[] | undefined): Map<string, DxfPair[]> {
  const header = new Map<string, DxfPair[]>();
  let current: DxfPair[] | null = null;
  // The whole HEADER section is a single untyped record: it has no code 0 pairs.
  for (const record of records ?? []) {
    if (record.type !== "") continue;
    for (const pair of record.pairs) {
      if (pair.code === 9) {
        current = [];
        header.set(pair.value.trim(), current);
      } else {
        current?.push(pair);
      }
    }
  }
  return header;
}

/** Reads values off a record's pairs. */
export class Fields {
  constructor(readonly pairs: DxfPair[]) {}

  /** The first value with `code`, as text, untrimmed except for line endings. */
  text(code: number): string | undefined {
    return this.pairs.find((pair) => pair.code === code)?.value;
  }

  /** The first value with `code` as a number, or `fallback` if missing; `NaN` if invalid. */
  number(code: number, fallback: number): number {
    const text = this.text(code);
    return text === undefined ? fallback : parseNumber(text);
  }

  /** Every value with `code` as a number, in order. */
  numbers(code: number): number[] {
    return this.pairs.filter((pair) => pair.code === code).map((pair) => parseNumber(pair.value));
  }
}

/** Parses a number written in a DXF value, which may be padded with spaces. */
export function parseNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** Decodes `\U+XXXX` escapes, which files before AutoCAD 2007 use for characters outside their code page. */
export function decodeName(text: string): string {
  return text
    .trim()
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}
