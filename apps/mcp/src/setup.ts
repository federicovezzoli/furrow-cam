import {
  type FlipAxis,
  HoldingTabs,
  issueMessage,
  LocatingPins,
  type PinHoles,
  type Point,
  type StockAnchor,
  type StockCorner,
  stockPins,
  Tool,
  taperedDiameter,
  type Units,
  type ZOrigin,
} from "@furrow/document";
import { formatMessage, type Translatable } from "@furrow/ui/lib/i18n";
import { setMachine } from "@furrow/workspace/stores/machine-actions";
import { setOperationTool } from "@furrow/workspace/stores/operation-actions";
import {
  addTouchOff,
  autoPlaceHoldingTabs,
  partingDepthLimits,
  pickXYOrigin,
  removeTouchOff,
  type StockDimension,
  setFenceCorner,
  setFlipAxis,
  setHoldingTabPositions,
  setHoldingTabSize,
  setHoldingTabs,
  setLineUp,
  setPartingDepth,
  setStockDimension,
  setTouchOffField,
  setTwoSided,
  setUnits,
  setXYAnchor,
  setZOrigin,
  updateLocatingPins,
} from "@furrow/workspace/stores/stock-actions";
import type { z } from "zod";
import type { Library } from "./library";
import { change, type Project, ToolError, t } from "./projects";

/** The app's message for the assistant. */
const text = (message: Translatable) => formatMessage(t, message);

/** Sets the project's display units and the stock's size in millimetres, as the stock fields do. */
export function setStock(
  project: Project,
  { units, ...size }: { units?: Units } & Partial<Record<StockDimension, number>>,
) {
  change(project, (store) => {
    if (units) setUnits(store, units);
    for (const [dimension, mm] of Object.entries(size) as [StockDimension, number | undefined][]) {
      if (mm !== undefined) setStockDimension(store, dimension, mm);
    }
  });
}

/**
 * Puts the XY zero on a stock anchor, which aligns the design to the stock
 * there, or on a custom point in millimetres from the stock's bottom-left
 * corner, where the design stays; and sets the Z zero.
 */
export function setZero(project: Project, { xy, z }: { xy?: StockAnchor | Point; z?: ZOrigin }) {
  change(project, (store) => {
    if (typeof xy === "string") setXYAnchor(store, xy);
    else if (xy) pickXYOrigin(store, xy);
    if (z) setZOrigin(store, z);
  });
}

/**
 * Adds the touch-off pad (centred on the XY zero) or removes it, and sets its
 * centre, in millimetres from the stock's bottom-left corner, and diameter.
 */
export function setTouchOff(
  project: Project,
  { pad, ...fields }: { pad: boolean; x?: number; y?: number; diameter?: number },
) {
  const given = Object.entries(fields).filter(([, mm]) => mm !== undefined);
  if (!pad && given.length > 0) {
    throw new ToolError(
      `pad: false removes the pad; ${given.map(([field]) => field).join(", ")} can't be set with it.`,
    );
  }
  const { width, height } = project.store.getState().document.stock;
  // Checked first, so a refused diameter changes nothing.
  if (pad && fields.diameter !== undefined && fields.diameter > Math.min(width, height)) {
    throw new ToolError(text({ code: "document.padOffStock" }));
  }
  change(project, (store) => {
    if (!pad) {
      removeTouchOff(store);
      return;
    }
    addTouchOff(store);
    for (const [field, mm] of Object.entries(fields) as ["x" | "y" | "diameter", number][]) {
      if (mm !== undefined) setTouchOffField(store, field, mm);
    }
  });
}

/** What `set_two_sided` is given: each setting left out stays as it is. */
export type TwoSidedRequest = {
  twoSided: boolean;
  flipAxis?: FlipAxis;
  partingDepth?: number;
  lineUp?:
    | null
    | { type: "edges"; corner: StockCorner }
    | { type: "pins"; diameter?: number; positions?: number[]; holes?: PinHoles };
  tabs?: null | { width?: number; thickness?: number; count?: number; positions?: Point[] };
};

/**
 * Makes the project two-sided (PRD-0011, ADR-0060) and sets up its flip
 * axis, parting depth, line-up and holding tabs, as the app's two-sided
 * settings do; or one-sided again. Refused as a whole, changing nothing, if
 * any setting is.
 */
export function setTwoSidedSetup(
  project: Project,
  { twoSided, flipAxis, partingDepth, lineUp, tabs }: TwoSidedRequest,
) {
  const given = Object.entries({ flipAxis, partingDepth, lineUp, tabs }).filter(
    ([, value]) => value !== undefined,
  );
  if (!twoSided && given.length > 0) {
    throw new ToolError(
      `twoSided: false removes the setup; ${given.map(([field]) => field).join(", ")} can't be set with it.`,
    );
  }
  // The schema's own message for this one says "characters".
  if (lineUp?.type === "pins" && lineUp.positions && lineUp.positions.length < 2) {
    throw new ToolError("lineUp.positions: give two pins at least, to stop the stock turning.");
  }
  if (tabs?.count !== undefined && tabs.positions !== undefined) {
    throw new ToolError("tabs: give a count or positions, not both.");
  }
  // Every refusal below throws inside `change`, which undoes the whole call.
  change(project, (store) => {
    setTwoSided(store, twoSided);
    if (!twoSided) return;
    const stock = () => store.getState().document.stock;
    if (flipAxis) setFlipAxis(store, flipAxis);
    if (partingDepth !== undefined) {
      const [min, max] = partingDepthLimits(stock().thickness);
      if (!(partingDepth >= min && partingDepth <= max)) {
        throw new ToolError(
          `partingDepth: give a depth from ${min} to ${max} mm below the stock top.`,
        );
      }
      setPartingDepth(store, partingDepth);
    }
    if (lineUp !== undefined) {
      setLineUp(store, lineUp?.type ?? null);
      if (lineUp?.type === "edges") setFenceCorner(store, lineUp.corner);
      if (lineUp?.type === "pins") {
        const { type: _, ...changes } = lineUp;
        const pins = { ...stockPins(stock()), ...changes };
        if (!updateLocatingPins(store, changes)) {
          parsed(LocatingPins, pins, "lineUp");
          throw new ToolError(`lineUp.holes.depth: ${text({ code: "document.pinHolesThrough" })}`);
        }
      }
    }
    if (tabs !== undefined) {
      setHoldingTabs(store, tabs !== null);
      if (!tabs) return;
      for (const field of ["width", "thickness"] as const) {
        const value = tabs[field];
        if (value === undefined || setHoldingTabSize(store, field, value)) continue;
        parsed(HoldingTabs, { ...stock().twoSided?.tabs, [field]: value }, "tabs");
        throw new ToolError(`tabs.thickness: ${text({ code: "document.tabsThickerThanSide" })}`);
      }
      if (tabs.count !== undefined) autoPlaceHoldingTabs(store, tabs.count);
      if (tabs.positions && !setHoldingTabPositions(store, tabs.positions)) {
        throw new ToolError("tabs.positions: holding tabs hold a model, and the project has none.");
      }
    }
  });
}

/** Snapshots library machine `id` into the project (ADR-0003), as choosing it in the app does. */
export function chooseMachine(project: Project, library: Library, id: string) {
  const choice = library.machines.find((m) => m.id === id);
  if (!choice) {
    throw new ToolError(`The machine list has no machine ${JSON.stringify(id)}.${why(library)}`);
  }
  change(project, (store) => setMachine(store, choice.machine, choice.id));
}

/** A library tool's or a tool's settings, as the tools that take a tool are given it. */
export type ToolChoice = { toolId?: string; settings?: unknown };

/**
 * A snapshot of library tool `toolId`, or of `settings` checked by the tool
 * schema (ADR-0003), as picking a bit in the app makes one; `what` names the
 * tool in messages.
 */
export function resolveTool(
  library: Library,
  { toolId, settings }: ToolChoice,
  what = "tool",
): Tool {
  if (toolId !== undefined && settings !== undefined) {
    throw new ToolError(`Give a library tool's id or the ${what}'s settings, not both.`);
  }
  if (toolId !== undefined) {
    const choice = library.tools.find((choice) => choice.id === toolId);
    if (!choice) {
      throw new ToolError(`The tool library has no tool ${JSON.stringify(toolId)}.${why(library)}`);
    }
    return choice.tool;
  }
  if (settings === undefined) {
    throw new ToolError(`Give a library tool's id or the ${what}'s settings.`);
  }
  return parsed(Tool, withTaperedDiameter(settings));
}

/**
 * `input` parsed by `schema`; else throws a `ToolError` with the app's message
 * for the first problem, after where it is (`prefix`, then the issue's path).
 */
export function parsed<T>(schema: z.ZodType<T>, input: unknown, prefix?: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const where = [...(prefix ? [prefix] : []), ...(issue?.path ?? [])].join(".");
  const message = text(issue ? issueMessage(issue) : { code: "validation.invalid" });
  throw new ToolError(where ? `${where}: ${message}` : message);
}

/** Gives operation `id` a snapshot of a library tool or of a tool's settings, as picking a bit in the app does. */
export function setToolOf(project: Project, library: Library, id: string, choice: ToolChoice) {
  if (!project.store.getState().document.operations.some((operation) => operation.id === id)) {
    throw new ToolError(`The project has no operation ${JSON.stringify(id)}.`);
  }
  const tool = resolveTool(library, choice);
  change(project, (store) => {
    const result = setOperationTool(store, id, tool);
    if (!result.ok) throw new ToolError(text(result.error));
  });
}

/** `settings` with a tapered ball end mill's diameter worked out, as the app's bit form does. */
function withTaperedDiameter(settings: unknown): unknown {
  if (typeof settings !== "object" || settings === null) return settings;
  const fields = settings as Record<string, unknown>;
  if (fields.type !== "tapered_ball_end_mill") return settings;
  const number = (value: unknown) => (typeof value === "number" ? value : null);
  const diameter = taperedDiameter({
    tipDiameter: number(fields.tipDiameter),
    taperAngle: number(fields.taperAngle),
    fluteLength: number(fields.fluteLength),
  });
  return { ...fields, diameter };
}

/** What kept the library from being read, after a sentence, or nothing. */
function why({ problems }: Library): string {
  return problems.length > 0 ? ` ${problems.join(" ")}` : "";
}
