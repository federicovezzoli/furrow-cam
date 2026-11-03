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
  /** Start points (#426), where the selected operation's cuts begin. */
  startPoint: string;
  /** Corner overcuts (#428) of the selected profile. */
  overcut: string;
  /** The touch-off pad (ADR-0043), unlike anything cut or left uncut. */
  touchOff: string;
  /** The locating pins (#356). */
  pin: string;
  /** A two-sided project's parting plane (#473). */
  parting: string;
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
    startPoint: "#dc2626",
    overcut: "#ea580c",
    touchOff: "#0891b2",
    pin: "#4f46e5",
    parting: "#7c3aed",
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
    startPoint: "#f87171",
    overcut: "#fb923c",
    touchOff: "#22d3ee",
    pin: "#818cf8",
    parting: "#a78bfa",
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
  parting: 1,
  selectedDrawing: 2,
  shapes: 3,
  selected: 4,
  hovered: 5,
  rapids: 6,
  feeds: 7,
  holes: 8,
  origin: 9,
  tabs: 10,
  snap: 11,
} as const;
