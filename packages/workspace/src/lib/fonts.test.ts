import { type Font, parseFont, pathBounds, textPaths } from "@furrow/cam-core";
import type { TextSettings } from "@furrow/document";
import { afterEach, describe, expect, it, vi } from "vitest";
import archivoBlack from "../fonts/ArchivoBlack-Regular.ttf?inline";
import arvo from "../fonts/Arvo-Regular.ttf?inline";
import pacifico from "../fonts/Pacifico-Regular.ttf?inline";
import reliefSingleLine from "../fonts/ReliefSingleLineCAD-Regular.ttf?inline";
import { type BundledFont, DEFAULT_FONT, FONTS, loadFont } from "./fonts";

/** Each bundled font's bytes, by id. */
const files = new Map(
  await Promise.all(
    Object.entries({
      "archivo-black": archivoBlack,
      arvo,
      pacifico,
      "relief-singleline": reliefSingleLine,
    }).map(async ([id, dataUrl]) => [id, await (await fetch(dataUrl)).arrayBuffer()] as const),
  ),
);
const bytes = (id: string) => files.get(id) as ArrayBuffer;
const bundled = (id: string) => FONTS.find((font) => font.id === id) as BundledFont;
const parsed = (id: string) => parseFont(bytes(id), bundled(id).singleStroke);

function settings(text: string): TextSettings {
  return {
    text,
    font: "",
    height: 10,
    align: "left",
    placement: { position: [0, 0], rotation: 0, mirrored: false },
  };
}

const right = (font: Font, text: string) =>
  Math.max(...textPaths(font, settings(text)).map((path) => pathBounds(path).max[0]));

describe("FONTS", () => {
  it("ships a sans, a serif, a script and a single-stroke font, with unique ids", () => {
    expect(FONTS.map((font) => font.kind)).toEqual(["sans", "serif", "script", "singleStroke"]);
    expect(new Set(FONTS.map((font) => font.id)).size).toBe(FONTS.length);
    expect(FONTS.some((font) => font.id === DEFAULT_FONT)).toBe(true);
  });

  it.each(FONTS)("lays $name out at its cap height", (font) => {
    const paths = textPaths(parsed(font.id), settings("HELLO"));
    expect(paths.length).toBeGreaterThan(0);
    const top = Math.max(...paths.map((path) => pathBounds(path).max[1]));
    // Round letters overshoot the cap height a little.
    expect(top).toBeGreaterThan(9.9);
    expect(top).toBeLessThan(10.5);
  });

  // Arvo kerns with a `kern` table, Archivo Black with GPOS.
  it.each(["arvo", "archivo-black"])("kerns %s's TrueType outlines", (id) => {
    const font = parsed(id);
    const { font: source } = font;
    const [a, v] = [source.charToGlyph("A"), source.charToGlyph("V")];
    const kern = source.getKerningValue(a, v);
    expect(kern).toBeLessThan(0);
    const scale = 10 / (source.tables.os2?.sCapHeight as number);
    expect(right(font, "AV")).toBeCloseTo(
      ((a.advanceWidth ?? 0) + kern) * scale + right(font, "V"),
      2,
    );
  });

  it("merges the script font's joined letters into one outline", () => {
    const font = parsed("pacifico");
    const apart = [..."pacifico"].reduce((sum, c) => sum + textPaths(font, settings(c)).length, 0);
    expect(textPaths(font, settings("pacifico")).length).toBeLessThan(apart);
  });

  it("gives the single-stroke font's letters as open strokes, without closing lines", () => {
    const font = parsed("relief-singleline");
    const paths = textPaths(font, settings("Hello"));
    expect(paths.every((path) => !path.closed)).toBe(true);
    // The "l" is one stroke from its tail up to its top, with no line back down.
    const [l] = textPaths(font, settings("l"));
    expect(l?.start[1]).toBeLessThan(1);
    expect(l?.segments.at(-1)?.to[1]).toBeGreaterThan(9);
  });
});

describe("loadFont", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses a bundled font once, and knows no other", async () => {
    const fetch = vi.fn(async () => new Response(bytes("arvo")));
    vi.stubGlobal("fetch", fetch);
    const first = await loadFont("arvo");
    expect(await loadFont("arvo")).toBe(first);
    expect(fetch).toHaveBeenCalledOnce();
    expect(first?.singleStroke).toBe(false);
    expect(loadFont("uploaded")).toBeNull();
  });

  it("tries again after a failed load", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadFont("pacifico")).rejects.toThrow("500");
    await expect(loadFont("pacifico")).rejects.toThrow("500");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
