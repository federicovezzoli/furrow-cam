import type { Vec3 } from "./stock";

/**
 * One straight move of the tool, in stock coordinates (ADR-0014). Feed rates
 * are in mm/min: the tool's plunge rate for moves that go down, its feed rate
 * otherwise.
 */
export type ToolpathMove =
  | { kind: "rapid"; to: Vec3 }
  | { kind: "feed"; to: Vec3; feedRate: number };

/**
 * The moves of one operation (ADR-0004: derived, never stored). The first move
 * is a rapid to the first entry point at the retract height and the last a
 * rapid up to it; getting there safely from wherever the tool is stays with
 * the post-processor.
 */
export type Toolpath = {
  moves: ToolpathMove[];
  /** Problems that didn't stop the toolpath, e.g. paths it had to skip. */
  warnings: string[];
};

/** Accumulates moves, dropping ones that go nowhere. */
export class ToolpathBuilder {
  readonly moves: ToolpathMove[] = [];
  private position: Vec3 | null = null;

  constructor(readonly safeZ: number) {}

  /** Retracts if needed, then rapids above `[x, y]` at the retract height. */
  travel(x: number, y: number) {
    const at = this.position;
    if (at && at[2] < this.safeZ) this.rapid([at[0], at[1], this.safeZ]);
    this.rapid([x, y, this.safeZ]);
  }

  retract() {
    const at = this.position;
    if (at && at[2] < this.safeZ) this.rapid([at[0], at[1], this.safeZ]);
  }

  rapid(to: Vec3) {
    if (this.isAt(to)) return;
    this.moves.push({ kind: "rapid", to });
    this.position = to;
  }

  feed(to: Vec3, feedRate: number) {
    if (this.isAt(to)) return;
    this.moves.push({ kind: "feed", to, feedRate });
    this.position = to;
  }

  private isAt(to: Vec3): boolean {
    const at = this.position;
    return at !== null && Math.hypot(at[0] - to[0], at[1] - to[1], at[2] - to[2]) < 1e-9;
  }
}
