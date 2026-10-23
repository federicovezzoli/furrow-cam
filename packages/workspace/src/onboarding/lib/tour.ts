/**
 * The guided tours (PRD-0001 R22): their steps and how a tour moves through
 * them. Steps point at elements marked `data-tour="<anchor>"`; the tour
 * explains each area whatever the project holds, and skips a step whose
 * anchor isn't on screen rather than misplacing it.
 */

export type TourId = "app" | "workspace";

/** A workspace sidebar tab the tour opens when it reaches a step inside it. */
export type TourPane = "operations" | "properties";

export interface TourStep {
  /** Its title and text are `Tour.steps.<id>` in the catalogs (ADR-0054). */
  id: TourStepId;
  /** The `data-tour` value of the element the step points at. */
  anchor: string;
  /** The sidebar tab holding the anchor, opened for the step. */
  pane?: TourPane;
  /** Where the popover goes: beside the anchor, or inside the top of a large one. */
  side: "top" | "right" | "bottom" | "left" | "inside";
}

/** The steps of every tour, which the catalogs name and describe. */
export type TourStepId =
  | "bits"
  | "machines"
  | "new-project"
  | "import"
  | "properties"
  | "select"
  | "operations"
  | "preview"
  | "export-gcode"
  | "versions";

export const TOURS: Record<TourId, readonly TourStep[]> = {
  app: [
    {
      id: "bits",
      anchor: "bits",
      side: "bottom",
    },
    {
      id: "machines",
      anchor: "machines",
      side: "bottom",
    },
    {
      id: "new-project",
      anchor: "new-project",
      side: "bottom",
    },
  ],
  workspace: [
    {
      id: "import",
      anchor: "import",
      side: "bottom",
    },
    {
      id: "properties",
      anchor: "properties",
      pane: "properties",
      side: "right",
    },
    {
      id: "select",
      anchor: "viewport",
      side: "inside",
    },
    {
      id: "operations",
      anchor: "operations",
      pane: "operations",
      side: "right",
    },
    {
      id: "preview",
      anchor: "viewport",
      side: "inside",
    },
    {
      id: "export-gcode",
      anchor: "export-gcode",
      pane: "operations",
      side: "right",
    },
    {
      id: "versions",
      anchor: "versions",
      side: "bottom",
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
