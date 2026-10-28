import type { Vec3 } from "@furrow/cam-core";
import { formatNumber } from "./format";
import type { BlockLabel, CustomBlock } from "./read-back";

type Axes = { x?: number; y?: number; z?: number };
const AXES = ["x", "y", "z"] as const;

/** A G-code comment, which can't nest or span lines. */
export function comment(text: string): string {
  const safe = text
    .replace(/\(/g, "[")
    .replace(/\)/g, "]")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it matches
    .replace(/[\u0000-\u001f\u007f]+/g, " ");
  return `(${safe})`;
}

/**
 * Collects G-code lines, writing only the coordinates and feed that change.
 * Coordinates go in in stock coordinates and come out in work coordinates.
 */
export class GcodeWriter {
  private readonly lines: string[] = [];
  /** Where each custom block went, for reading it back. */
  readonly customBlocks: CustomBlock[] = [];
  /** Last written value of each word, as formatted, or absent when unknown. */
  private written: Partial<Record<"x" | "y" | "z" | "f", string>> = {};

  constructor(private readonly offset: Vec3) {}

  line(text: string) {
    this.lines.push(text);
  }

  comment(text: string) {
    this.lines.push(comment(text));
  }

  /** A custom block, verbatim; it may have moved the tool or changed modes. */
  custom(label: BlockLabel, block: string) {
    const first = this.lines.length + 1;
    this.lines.push(...block.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"));
    this.customBlocks.push({ label, first, last: this.lines.length });
    this.forget();
  }

  /** Writes every word again from now on, as if the tool's position were unknown. */
  forget() {
    this.written = {};
  }

  rapid(to: Axes) {
    this.rapidWork(this.toWork(to));
  }

  rapidWork(to: Axes) {
    this.move("G0", to);
  }

  feed(to: Axes, feedRate: number) {
    this.move("G1", this.toWork(to), feedRate);
  }

  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }

  private toWork(to: Axes): Axes {
    const [x, y, z] = this.offset;
    return {
      ...(to.x !== undefined && { x: to.x + x }),
      ...(to.y !== undefined && { y: to.y + y }),
      ...(to.z !== undefined && { z: to.z + z }),
    };
  }

  private move(code: "G0" | "G1", to: Axes, feedRate?: number) {
    const words: string[] = [];
    for (const axis of AXES) {
      const value = to[axis];
      if (value === undefined) continue;
      const text = formatNumber(value);
      if (this.written[axis] === text) continue;
      this.written[axis] = text;
      words.push(`${axis.toUpperCase()}${text}`);
    }
    // Rounding can make a short move go nowhere.
    if (words.length === 0) return;
    if (feedRate !== undefined) {
      const text = formatNumber(feedRate);
      if (this.written.f !== text) {
        this.written.f = text;
        words.push(`F${text}`);
      }
    }
    this.lines.push([code, ...words].join(" "));
  }
}
