import {
  issueMessage,
  type Point,
  type StockAnchor,
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
  pickXYOrigin,
  removeTouchOff,
  type StockDimension,
  setStockDimension,
  setTouchOffField,
  setUnits,
  setXYAnchor,
  setZOrigin,
} from "@furrow/workspace/stores/stock-actions";
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

/** Snapshots library machine `id` into the project (ADR-0003), as choosing it in the app does. */
export function chooseMachine(project: Project, library: Library, id: string) {
  const choice = library.machines.find((m) => m.id === id);
  if (!choice) {
    throw new ToolError(`The machine list has no machine ${JSON.stringify(id)}.${why(library)}`);
  }
  change(project, (store) => setMachine(store, choice.machine));
}

/**
 * Gives operation `id` a snapshot of library tool `toolId`, or of `settings`
 * checked by the tool schema (ADR-0003), as picking a bit in the app does.
 */
export function setToolOf(
  project: Project,
  library: Library,
  id: string,
  { toolId, settings }: { toolId?: string; settings?: unknown },
) {
  if (!project.store.getState().document.operations.some((operation) => operation.id === id)) {
    throw new ToolError(`The project has no operation ${JSON.stringify(id)}.`);
  }
  if (toolId !== undefined && settings !== undefined) {
    throw new ToolError("Give a library tool's id or the tool's settings, not both.");
  }
  let tool: Tool;
  if (toolId !== undefined) {
    const choice = library.tools.find((choice) => choice.id === toolId);
    if (!choice) {
      throw new ToolError(`The tool library has no tool ${JSON.stringify(toolId)}.${why(library)}`);
    }
    tool = choice.tool;
  } else if (settings !== undefined) {
    const parsed = Tool.safeParse(withTaperedDiameter(settings));
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      const where = issue?.path.join(".");
      const message = text(issue ? issueMessage(issue) : { code: "validation.invalid" });
      throw new ToolError(where ? `${where}: ${message}` : message);
    }
    tool = parsed.data;
  } else {
    throw new ToolError("Give a library tool's id or the tool's settings.");
  }
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
