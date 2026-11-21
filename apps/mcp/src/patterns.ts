import { PatternSettings } from "@furrow/document";
import { boundaryCorner, DEFAULT_PATTERN, generatePattern } from "@furrow/workspace/lib/patterns";
import { addPatternItem, patternBoundary } from "@furrow/workspace/stores/pattern-actions";
import { text } from "./drawings-and-models";
import { type TargetInput, targetsOf } from "./operations";
import { change, type Project, ToolError, t } from "./projects";
import { parsed } from "./setup";

/** A pattern as an assistant asks for it: what it fills and the settings it changes from the app's defaults. */
export type PatternRequest = Partial<Omit<PatternSettings, "placement" | "boundary">> & {
  targets: TargetInput[];
  name?: string;
  /** Degrees counter-clockwise. */
  rotation?: number;
  /** The origin's offset from the boundary's bottom-left corner, in mm. */
  offset?: [number, number];
};

/**
 * Fills the closed paths `request.targets` select with a pattern, as the
 * app's *Pattern* command does (PRD-0016 P1, P10): the app's default
 * settings but those given, its origin at the boundary's bottom-left corner
 * moved by `offset`. Returns its drawing's id and how many cells it has.
 */
export function addPattern(project: Project, request: PatternRequest) {
  const { targets, name, rotation = 0, offset = [0, 0], ...given } = request;
  const { document } = project.store.getState();
  const bound = patternBoundary(document, targetsOf(document, targets));
  if (!bound.ok) throw new ToolError(text(bound.error));
  const [x, y] = boundaryCorner(document.geometry, bound.boundary);
  const settings = parsed(PatternSettings, {
    ...DEFAULT_PATTERN,
    ...given,
    placement: {
      position: [x + offset[0], y + offset[1]],
      rotation: ((rotation % 360) + 360) % 360,
      mirrored: false,
    },
    boundary: bound.boundary,
  });
  const generated = generatePattern(document.geometry, settings);
  if (!generated.ok) throw new ToolError(text(generated.error));
  let drawingId = "";
  change(project, (store) => {
    drawingId = addPatternItem(store, name ?? t("Pattern.defaultName"), settings, generated.paths);
  });
  return { drawingId, cells: generated.paths.length };
}
