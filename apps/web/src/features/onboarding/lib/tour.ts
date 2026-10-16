/**
 * The guided tours (PRD-0001 R22): their steps and how a tour moves through
 * them. Steps point at elements marked `data-tour="<anchor>"`; the tour
 * explains each area whatever the project holds, and skips a step whose
 * anchor isn't on screen rather than misplacing it.
 */

export type TourId = "app" | "workspace";

/** A workspace pane the tour expands when it reaches a step inside it. */
export type TourPane = "operations" | "properties" | "versions";

export interface TourStep {
  id: string;
  /** The `data-tour` value of the element the step points at. */
  anchor: string;
  /** The collapsible pane holding the anchor, expanded for the step. */
  pane?: TourPane;
  /** Where the popover goes: beside the anchor, or inside the top of a large one. */
  side: "top" | "right" | "bottom" | "left" | "inside";
  title: string;
  body: string;
}

export const TOURS: Record<TourId, readonly TourStep[]> = {
  app: [
    {
      id: "bits",
      anchor: "bits",
      side: "bottom",
      title: "Your bits",
      body: "Add the router bits you own, with their sizes and feeds. Operations pick their bit from this library.",
    },
    {
      id: "machines",
      anchor: "machines",
      side: "bottom",
      title: "Your machine",
      body: "Describe your router once, or start from a preset. Its work area, feeds and G-code dialect apply to every project made for it.",
    },
    {
      id: "new-project",
      anchor: "new-project",
      side: "bottom",
      title: "Start a project",
      body: "Projects are made for one of your machines. Create one here, or import a project file.",
    },
  ],
  workspace: [
    {
      id: "import",
      anchor: "import",
      side: "bottom",
      title: "Import a drawing",
      body: "Start from an SVG or DXF file: its paths become the shapes you cut.",
    },
    {
      id: "properties",
      anchor: "properties",
      pane: "properties",
      side: "right",
      title: "Project properties",
      body: "Set the units, the machine and the stock: the size and thickness of the material, and where its zero is.",
    },
    {
      id: "select",
      anchor: "viewport",
      side: "inside",
      title: "Select paths",
      body: "Click a path in the viewport to select it, and Shift+click to add more. Operations cut what is selected.",
    },
    {
      id: "operations",
      anchor: "operations",
      pane: "operations",
      side: "right",
      title: "Add operations",
      body: "Add an operation (profile, pocket, drill, engrave or V-carve) for the selected paths, then pick its bit and depths.",
    },
    {
      id: "preview",
      anchor: "viewport",
      side: "inside",
      title: "Preview the toolpaths",
      body: "The viewport shows the toolpaths of every enabled operation, with rapid moves told apart from cuts. Check them before you cut.",
    },
    {
      id: "export-gcode",
      anchor: "export-gcode",
      pane: "operations",
      side: "right",
      title: "Export G-code",
      body: "When the toolpaths look right, export the G-code and run it with your usual sender.",
    },
    {
      id: "versions",
      anchor: "versions",
      pane: "versions",
      side: "right",
      title: "Versions",
      body: "Optional: save a named version before a big change, and restore it whenever you need.",
    },
  ],
};

/**
 * A running tour: its steps, less those dropped because their anchor wasn't
 * on screen when reached, and the one shown.
 */
export interface TourState {
  steps: readonly TourStep[];
  index: number;
}

/**
 * Starts a tour at its first step. Anchors are only looked for when their
 * step is reached: the page may still be streaming in when the tour starts.
 */
export function startTour(steps: readonly TourStep[]): TourState {
  return { steps, index: 0 };
}

/** Moves one step forward or back; `null` when moving past the last step ends the tour. */
export function moveTour(state: TourState, direction: 1 | -1): TourState | null {
  const index = state.index + direction;
  if (index >= state.steps.length) return null;
  return { ...state, index: Math.max(0, index) };
}

/**
 * Drops the step shown, whose anchor turned out not to be on screen, and
 * shows the next one in `direction`: the one after it, or before it when
 * going back (the one after when there is none before). `null` when no step
 * is left in that direction.
 */
export function dropStep(state: TourState, direction: 1 | -1): TourState | null {
  const steps = state.steps.filter((_, i) => i !== state.index);
  if (steps.length === 0) return null;
  if (direction === -1 && state.index > 0) return { steps, index: state.index - 1 };
  return state.index < steps.length ? { steps, index: state.index } : null;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Whether an element's box is visible at all and overlaps the window. */
export function isOnScreen(rect: Rect, viewport: { width: number; height: number }) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left < viewport.width &&
    rect.top < viewport.height &&
    rect.left + rect.width > 0 &&
    rect.top + rect.height > 0
  );
}
