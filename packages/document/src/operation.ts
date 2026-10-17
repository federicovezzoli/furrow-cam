import { z } from "zod";
import { Point, type Shape } from "./geometry";
import { Tool } from "./tool";
import { Name, PositiveLength } from "./units";

export const OperationType = z.enum([
  "profile",
  "pocket",
  "drill",
  "engrave",
  "vcarve",
  "relief_finish",
  "relief_rough",
]);
export type OperationType = z.infer<typeof OperationType>;

/**
 * Some or all of a shape's paths (ADR-0018). Shapes aren't edited after
 * import, so path indices are stable.
 */
export const OperationTarget = z.strictObject({
  shapeId: z.uuid(),
  /** Indices into the shape's `paths`, ascending, or `null` for all of them. */
  paths: z
    .array(z.int().nonnegative())
    .min(1)
    .refine((paths) => paths.every((path, i) => i === 0 || path > (paths[i - 1] as number)), {
      message: "Path indices must be ascending, each once",
    })
    .nullable(),
});
export type OperationTarget = z.infer<typeof OperationTarget>;

/**
 * `targets` in the form the document stores: one per shape, in the order of
 * `geometry`, paths ascending and `null` once they are all the shape's.
 * Targets of the same shape are merged; shapes and paths not in `geometry`
 * are skipped, and targets left with no paths dropped.
 */
export function normalizeTargets(
  geometry: readonly Shape[],
  targets: readonly OperationTarget[],
): OperationTarget[] {
  const wanted = new Map<string, Set<number> | null>();
  for (const { shapeId, paths } of targets) {
    const previous = wanted.get(shapeId);
    if (paths === null || previous === null) wanted.set(shapeId, null);
    else wanted.set(shapeId, new Set([...(previous ?? []), ...paths]));
  }
  return geometry.flatMap((shape) => {
    const paths = wanted.get(shape.id);
    if (paths === undefined) return [];
    if (paths === null) return [{ shapeId: shape.id, paths: null }];
    const kept = shape.paths.flatMap((_, index) => (paths.has(index) ? [index] : []));
    if (kept.length === 0) return [];
    return [{ shapeId: shape.id, paths: kept.length === shape.paths.length ? null : kept }];
  });
}

const operationFields = {
  id: z.uuid(),
  name: Name,
  enabled: z.boolean(),
  /** What this operation cuts, one target per shape. */
  targets: z.array(OperationTarget),
  /** Snapshot of the tool at the time it was picked (ADR-0003). */
  tool: Tool,
};

/** Which side of the contour the tool cuts on: `on` follows the line itself. */
export const ProfileSide = z.enum(["inside", "outside", "on"]);
export type ProfileSide = z.infer<typeof ProfileSide>;

/** Milling direction, for a spindle turning clockwise seen from above. */
export const MillingDirection = z.enum(["climb", "conventional"]);
export type MillingDirection = z.infer<typeof MillingDirection>;

/**
 * Holding tabs (#22): bridges of material the profile leaves so the part stays
 * attached to the stock. Rectangular: over a tab the tool rises straight to
 * `height` above the final depth, crosses it flat and goes straight back down,
 * on the passes that would otherwise cut lower.
 */
export const ProfileTabs = z.strictObject({
  /** Length of the material left along the contour. */
  width: PositiveLength,
  /** Height of the material left, up from the profile's final depth. */
  height: PositiveLength,
  /** Where the tabs are, in stock coordinates; each goes to the nearest closed contour. */
  positions: z.array(Point),
});
export type ProfileTabs = z.infer<typeof ProfileTabs>;

/** Profile parameters (#21). The step-down and the ramp angle come from the tool. */
export const ProfileParams = z
  .strictObject({
    side: ProfileSide,
    direction: MillingDirection,
    /** Final depth below the stock top. */
    depth: PositiveLength,
    /** Material the depth passes leave on the wall. */
    allowance: z.number().nonnegative(),
    /** One more lap at full depth on the exact contour, removing the allowance. */
    finishPass: z.boolean(),
    /** Tangent arc on the waste side into each closed contour, or `null` to start on it. */
    leadIn: z.strictObject({ radius: PositiveLength }).nullable(),
    /** Ramp in at the tool's plunge angle instead of plunging straight down. */
    ramp: z.boolean(),
    /** Holding tabs, or `null` to cut the closed contours all the way round. */
    tabs: ProfileTabs.nullable(),
  })
  .superRefine((params, ctx) => {
    if (params.side === "on" && params.allowance !== 0) {
      ctx.addIssue({ code: "custom", path: ["allowance"], message: "Must be 0 on the line" });
    }
    if (params.finishPass && params.allowance === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["finishPass"],
        message: "Needs an allowance to remove",
      });
    }
  });
export type ProfileParams = z.infer<typeof ProfileParams>;

export const ProfileOperation = z.strictObject({
  ...operationFields,
  type: z.literal("profile"),
  params: ProfileParams,
});
export type ProfileOperation = z.infer<typeof ProfileOperation>;

/** Linear clearing angles: degrees counter-clockwise from the stock's X axis, presets only. */
export const LinearAngle = z.union([z.literal(0), z.literal(90), z.literal(45), z.literal(-45)]);
export type LinearAngle = z.infer<typeof LinearAngle>;

/** Where a peel starts: the point furthest from the walls, the single island or the outer wall. */
export const PeelStart = z.enum(["centre", "inside", "outside"]);
export type PeelStart = z.infer<typeof PeelStart>;

/**
 * How a pocket's area is cleared (#57, PRD-0001 R20): concentric offset rings
 * from the centre out, zig-zag passes at a preset angle, or engagement-limited
 * peeling grown from a starting cut.
 */
export const PocketStrategy = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("offset") }),
  z.strictObject({
    type: z.literal("linear"),
    /** Degrees counter-clockwise from the stock's X axis. */
    angle: LinearAngle,
  }),
  z.strictObject({
    type: z.literal("peel"),
    /** Where the cleared area starts growing from. */
    start: PeelStart,
  }),
]);
export type PocketStrategy = z.infer<typeof PocketStrategy>;

/**
 * Pocket parameters (#23): clearing of the area inside the closed paths,
 * islands left standing. The step-over, step-down and ramp angle come from
 * the tool.
 */
export const PocketParams = z
  .strictObject({
    strategy: PocketStrategy,
    direction: MillingDirection,
    /** Final depth below the stock top. */
    depth: PositiveLength,
    /** Material the clearing passes leave on the walls and islands. */
    allowance: z.number().nonnegative(),
    /** One more lap at full depth on each exact wall, removing the allowance. */
    finishPass: z.boolean(),
    /** Ramp in at the tool's plunge angle instead of plunging straight down. */
    ramp: z.boolean(),
  })
  .superRefine((params, ctx) => {
    if (params.finishPass && params.allowance === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["finishPass"],
        message: "Needs an allowance to remove",
      });
    }
  });
export type PocketParams = z.infer<typeof PocketParams>;

export const PocketOperation = z.strictObject({
  ...operationFields,
  type: z.literal("pocket"),
  params: PocketParams,
});
export type PocketOperation = z.infer<typeof PocketOperation>;

/**
 * Drill parameters (#24): holes at points and at circles of the tool's
 * diameter. The peck depth comes from the tool's step-down.
 */
export const DrillParams = z.strictObject({
  /** Depth of the tool tip below the stock top. */
  depth: PositiveLength,
  /** Drill in pecks, retracting above the stock after each to clear chips. */
  peck: z.boolean(),
});
export type DrillParams = z.infer<typeof DrillParams>;

/** Drills and end mills can drill: a V-bit's diameter doesn't describe the hole it makes. */
export function canDrill(tool: Tool): boolean {
  return tool.type !== "v_bit";
}

export const DrillOperation = z
  .strictObject({
    ...operationFields,
    type: z.literal("drill"),
    params: DrillParams,
  })
  .superRefine((operation, ctx) => {
    if (!canDrill(operation.tool)) {
      ctx.addIssue({ code: "custom", path: ["tool", "type"], message: "V-bits can't drill" });
    }
  });
export type DrillOperation = z.infer<typeof DrillOperation>;

/**
 * Engrave parameters (#95): the paths followed on the line, or inside or
 * outside the closed ones with an edge of the groove on the line, cut to
 * `depth` in passes no deeper than the tool's step-down. With a V-bit the
 * depth sets the line width; the width isn't stored, so it follows the bit
 * the operation uses.
 */
export const EngraveParams = z.strictObject({
  /** Where the groove is: centred on the line, or inside or outside it. */
  side: ProfileSide,
  /** Depth of the tool tip below the stock top. */
  depth: PositiveLength,
  /** Ramp in at the tool's plunge angle instead of plunging straight down. */
  ramp: z.boolean(),
});
export type EngraveParams = z.infer<typeof EngraveParams>;

/** V-bits, ball and flat end mills engrave: a drill bit can't cut sideways. */
export function canEngrave(tool: Tool): boolean {
  return tool.type !== "drill";
}

export const EngraveOperation = z
  .strictObject({
    ...operationFields,
    type: z.literal("engrave"),
    params: EngraveParams,
  })
  .superRefine((operation, ctx) => {
    if (!canEngrave(operation.tool)) {
      ctx.addIssue({ code: "custom", path: ["tool", "type"], message: "Drill bits can't engrave" });
    }
  });
export type EngraveOperation = z.infer<typeof EngraveOperation>;

/**
 * V-carve parameters (#97, PRD-0001 R16): the V-bit follows the medial axis
 * of the area inside the closed paths, as deep as the bit's angle and tip
 * need to reach the edges there, down to `maxDepth`. The step-down comes from
 * the tool.
 */
export const VCarveParams = z
  .strictObject({
    /** Deepest the V-bit goes below the stock top; wider parts are carved no deeper. */
    maxDepth: PositiveLength,
    /**
     * Where the shape is wider than the V-bit reaches at `maxDepth`, the bit
     * carves the walls down to it and `tool`, a flat end mill, clears the
     * floor between them flat, before the V-bit. `null` leaves those parts
     * carved to `maxDepth` along the axis only.
     */
    flatBottom: z.strictObject({ tool: Tool }).nullable(),
  })
  .superRefine((params, ctx) => {
    const tool = params.flatBottom?.tool;
    if (tool && !canClearFlatBottom(tool)) {
      ctx.addIssue({
        code: "custom",
        path: ["flatBottom", "tool", "type"],
        message: "Only flat end mills clear a flat bottom",
      });
    }
  });
export type VCarveParams = z.infer<typeof VCarveParams>;

/** Only V-bits V-carve: the depth comes from the bit's angle. */
export function canVCarve(tool: Tool): boolean {
  return tool.type === "v_bit";
}

/** Only flat end mills clear a V-carve's flat bottom. */
export function canClearFlatBottom(tool: Tool): boolean {
  return tool.type === "flat_end_mill";
}

export const VCarveOperation = z
  .strictObject({
    ...operationFields,
    type: z.literal("vcarve"),
    params: VCarveParams,
  })
  .superRefine((operation, ctx) => {
    if (!canVCarve(operation.tool)) {
      ctx.addIssue({ code: "custom", path: ["tool", "type"], message: "Only V-bits V-carve" });
    }
  });
export type VCarveOperation = z.infer<typeof VCarveOperation>;

/** How raster passes follow each other: all cut the same way, or every other one back. */
export const RasterDirection = z.enum(["one_way", "zigzag"]);
export type RasterDirection = z.infer<typeof RasterDirection>;

/** Where a spiral finishing pass starts: at the model's outline, or in its middle. */
export const SpiralStart = z.enum(["outside", "centre"]);
export type SpiralStart = z.infer<typeof SpiralStart>;

/**
 * How 3D finishing covers the model (#130, ADR-0039), each strategy with
 * only what it uses:
 *
 * - `parallel`: straight passes at `angle` degrees counter-clockwise from the
 *   stock's X axis.
 * - `waterline`: contours at constant Z, `stepDown` millimetres apart.
 * - `spiral`: one continuous spiral over the model's outline.
 */
export const FinishingStrategy = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("parallel"),
    angle: z.number().min(0).lt(180),
    direction: RasterDirection,
  }),
  z.strictObject({ type: z.literal("waterline"), stepDown: PositiveLength }),
  z.strictObject({ type: z.literal("spiral"), start: SpiralStart }),
]);
export type FinishingStrategy = z.infer<typeof FinishingStrategy>;

/**
 * 3D finishing parameters (#115, PRD-0005 S4): passes over a model, the tool
 * dropped onto the model at every point along them (ADR-0030).
 */
export const ReliefFinishParams = z.strictObject({
  /** The model it machines, one of the document's `models`. */
  modelId: z.uuid(),
  strategy: FinishingStrategy,
  /**
   * Distance between parallel passes or spiral laps, as a percentage of the
   * tool's diameter. Waterline contours are a step-down apart instead.
   */
  stepOver: z.number().gt(0).max(100),
  /** Material left on the model in every direction, walls included. */
  stockToLeave: z.number().nonnegative(),
  /** Rest machining (#118): only cut where the earlier operations left material. */
  rest: z.boolean(),
});
export type ReliefFinishParams = z.infer<typeof ReliefFinishParams>;

/** Operations on a model have no shapes to cut. */
function refineModelTargets(operation: { targets: OperationTarget[] }, ctx: z.RefinementCtx) {
  if (operation.targets.length > 0) {
    ctx.addIssue({ code: "custom", path: ["targets"], message: "Machines a model, not shapes" });
  }
}

export const ReliefFinishOperation = z
  .strictObject({
    ...operationFields,
    type: z.literal("relief_finish"),
    params: ReliefFinishParams,
  })
  .superRefine(refineModelTargets);
export type ReliefFinishOperation = z.infer<typeof ReliefFinishOperation>;

/**
 * What 3D roughing clears (ADR-0038): the model's outline or the whole
 * stock, the tool's centre reaching its edges, or the model's outline grown
 * by `distance` millimetres, the tool staying inside it.
 */
export const RoughingBoundary = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("model") }),
  z.strictObject({ type: z.literal("margin"), distance: PositiveLength }),
  z.strictObject({ type: z.literal("stock") }),
]);
export type RoughingBoundary = z.infer<typeof RoughingBoundary>;
export type RoughingBoundaryType = RoughingBoundary["type"];

/**
 * 3D roughing parameters (#116, PRD-0005 S5): the material above the model,
 * offset by the stock to leave, cleared in levels with a pocket strategy
 * (ADR-0030). The step-down and ramp angle come from the tool, and the
 * step-over too unless the operation sets its own.
 */
export const ReliefRoughParams = z
  .strictObject({
    /** The model it machines, one of the document's `models`. */
    modelId: z.uuid(),
    strategy: PocketStrategy,
    direction: MillingDirection,
    /**
     * Distance between passes, as a percentage of the tool's diameter, or
     * `null` for the tool's own step-over. The tool itself is left alone.
     */
    stepOver: z.number().gt(0).max(100).nullable(),
    /** Material left on the model in every direction, walls included. */
    stockToLeave: z.number().nonnegative(),
    boundary: RoughingBoundary,
    /** Ramp in at the tool's plunge angle instead of plunging straight down. */
    ramp: z.boolean(),
    /** Rest machining (#118): only cut where the earlier operations left material. */
    rest: z.boolean(),
  })
  .superRefine((params, ctx) => {
    // The islands change from level to level, so there is no single one to start from.
    if (params.strategy.type === "peel" && params.strategy.start === "inside") {
      ctx.addIssue({
        code: "custom",
        path: ["strategy", "start"],
        message: "Peeling starts from the centre or the outer wall",
      });
    }
  });
export type ReliefRoughParams = z.infer<typeof ReliefRoughParams>;

export const ReliefRoughOperation = z
  .strictObject({
    ...operationFields,
    type: z.literal("relief_rough"),
    params: ReliefRoughParams,
  })
  .superRefine(refineModelTargets);
export type ReliefRoughOperation = z.infer<typeof ReliefRoughOperation>;

/** Operations that machine a model (PRD-0005) rather than shapes. */
export function operationModelId(operation: Operation): string | null {
  return operation.type === "relief_finish" || operation.type === "relief_rough"
    ? operation.params.modelId
    : null;
}

export const Operation = z.discriminatedUnion("type", [
  ProfileOperation,
  PocketOperation,
  DrillOperation,
  EngraveOperation,
  VCarveOperation,
  ReliefFinishOperation,
  ReliefRoughOperation,
]);
export type Operation = z.infer<typeof Operation>;

/**
 * The second tool an operation cuts with, before its own (ADR-0026): a
 * V-carve's flat-bottom end mill. `null` for every other operation.
 */
export function clearingTool(operation: Operation): Tool | null {
  return operation.type === "vcarve" ? (operation.params.flatBottom?.tool ?? null) : null;
}
