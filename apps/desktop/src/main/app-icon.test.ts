import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The macOS Icon Composer icon copies the web app's icon.svg by hand (build/README.md).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../../../web/src/app/icon.svg");
const iconDir = "../../build/icon.icon/";

describe("macOS app icon", () => {
  it("has the glyph of icon.svg", () => {
    const glyph = source.match(/<g[\s\S]*<\/g>/)?.[0];
    expect(glyph).toBeDefined();
    expect(read(`${iconDir}Assets/glyph.svg`)).toContain(glyph);
  });

  it("has the background of icon.svg", () => {
    const hex = source.match(/<rect[^>]*fill="#([0-9a-f]{6})"/i)?.[1] ?? "";
    const channels = (hex.match(/../g) ?? []).map((c) => (Number.parseInt(c, 16) / 255).toFixed(5));
    const icon = JSON.parse(read(`${iconDir}icon.json`));
    expect(icon.fill.solid).toBe(`srgb:${[...channels, "1.00000"].join(",")}`);
  });
});
