/** Colours of the viewport's scene, per theme. */
export type Palette = {
  shape: string;
  /** Imported 3D models, shaded like the simulated stock. */
  model: string;
  hovered: string;
  selected: string;
  /** Drawn wide under the selected paths, so they stand out on the stock. */
  selectedHalo: string;
  /** Fills the selected drawing's box, faintly: unlike the stock, so the box shows on it. */
  selectedDrawing: string;
  tab: string;
  /** The touch-off pad (ADR-0043), unlike anything cut or left uncut. */
  touchOff: string;
  /** The locating pins (#356). */
  pin: string;
  /** The snap target while picking the zero. */
  snap: string;
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
    model: "#94a3b8",
    hovered: "#60a5fa",
    selected: "#ea580c",
    selectedHalo: "#ffffff",
    selectedDrawing: "#27272a",
    tab: "#16a34a",
    touchOff: "#0891b2",
    pin: "#4f46e5",
    snap: "#c026d3",
    rapid: "#71717a",
    stock: "#d4a373",
    stockEdges: "#a16207",
    gridMinor: "#e4e4e7",
    gridMajor: "#c4c4c8",
  },
  dark: {
    shape: "#e4e4e7",
    model: "#8b9bb4",
    hovered: "#93c5fd",
    selected: "#fb923c",
    selectedHalo: "#18181b",
    selectedDrawing: "#ffffff",
    tab: "#4ade80",
    touchOff: "#22d3ee",
    pin: "#818cf8",
    snap: "#e879f9",
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
  selectedDrawing: 1,
  shapes: 2,
  selected: 3,
  hovered: 4,
  rapids: 5,
  feeds: 6,
  holes: 7,
  origin: 8,
  tabs: 9,
  snap: 10,
} as const;
