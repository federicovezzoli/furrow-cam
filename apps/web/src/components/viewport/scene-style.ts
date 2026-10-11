/** Colours of the viewport's scene, per theme. */
export type Palette = {
  shape: string;
  hovered: string;
  selected: string;
  tab: string;
  /** Rapid moves; cutting moves take their tool's colour. */
  rapid: string;
  stock: string;
  stockEdges: string;
  gridMinor: string;
  gridMajor: string;
};

export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    shape: "#27272a",
    hovered: "#60a5fa",
    selected: "#ea580c",
    tab: "#16a34a",
    rapid: "#71717a",
    stock: "#d4a373",
    stockEdges: "#a16207",
    gridMinor: "#e4e4e7",
    gridMajor: "#c4c4c8",
  },
  dark: {
    shape: "#e4e4e7",
    hovered: "#93c5fd",
    selected: "#fb923c",
    tab: "#4ade80",
    rapid: "#a1a1aa",
    stock: "#a47148",
    stockEdges: "#d4a373",
    gridMinor: "#2a2a2d",
    gridMajor: "#45454a",
  },
};

/**
 * Draw order of the transparent pass. Lines join it (as `transparent`
 * materials) so they draw after the translucent stock instead of being tinted
 * by it; three.js always draws opaque objects first.
 */
export const RENDER_ORDER = {
  stock: 0,
  shapes: 1,
  selected: 2,
  hovered: 3,
  rapids: 4,
  feeds: 5,
  plunges: 6,
  origin: 7,
  tabs: 8,
} as const;
