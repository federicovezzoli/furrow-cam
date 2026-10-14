"use client";

import {
  DRILL_DIAMETER_TOLERANCE,
  exceedsVBitCone,
  formatQuantity,
  unitLabel,
  vBitConeDepth,
  vBitDepthForWidth,
  vBitLineWidth,
} from "@furrow/cam-core";
import {
  canClearFlatBottom,
  type DrillOperation,
  type EngraveOperation,
  LinearAngle,
  MillingDirection,
  Operation,
  type OperationTarget,
  PeelStart,
  type PocketOperation,
  type PocketStrategy,
  type ProfileOperation,
  ProfileSide,
  type ProfileTabs,
  type Tool,
  type VCarveOperation,
} from "@furrow/document";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { selectionTargets, targetsLabel } from "@/features/workspace/lib/path-selection";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import { gestureHandlers } from "@/features/workspace/stores/gesture-handlers";
import {
  type ActionResult,
  autoPlaceTabs,
  DEFAULT_TAB_COUNT,
  defaultTabs,
  renameOperation,
  setOperationTargets,
  setOperationTool,
  updateDrillParams,
  updateEngraveParams,
  updatePocketParams,
  updateProfileParams,
  updateVCarveParams,
} from "@/features/workspace/stores/operation-actions";
import { EditBitButton } from "./edit-bit-dialog";
import { OperationNameInput } from "./operation-name-input";
import { flatBottomToolChoice, matchingToolChoice, useToolLibrary } from "./tool-library";

const SIDE_LABELS: Record<ProfileSide, string> = {
  outside: "Outside",
  inside: "Inside",
  on: "On the line",
};

const DIRECTION_LABELS: Record<MillingDirection, string> = {
  climb: "Climb",
  conventional: "Conventional",
};

const STRATEGY_LABELS: Record<PocketStrategy["type"], string> = {
  offset: "Offset",
  linear: "Linear",
  peel: "Peel",
};

/** What each strategy does with the tool's step-over and step-down. */
const STRATEGY_HINTS: Record<PocketStrategy["type"], string> = {
  offset: "Rings parallel to the walls, cleared from the centre out",
  linear: "Zig-zag passes at an angle, after a lap around the walls",
  peel: "Cuts no wider than the step-over, growing from the start",
};

/** The strategy each type starts as when picked. */
const DEFAULT_STRATEGIES: Record<PocketStrategy["type"], PocketStrategy> = {
  offset: { type: "offset" },
  linear: { type: "linear", angle: 0 },
  peel: { type: "peel", start: "centre" },
};

const LINEAR_ANGLES = LinearAngle.options.map((option) => option.value);

const PEEL_START_LABELS: Record<PeelStart, string> = {
  centre: "Centre",
  inside: "Island",
  outside: "Outer wall",
};

/** Keeps depths and radii positive, as the operation params require, when stepping or scrubbing down. */
const MIN_LENGTH = 0.01;

/** The selected operation's name, tool, shapes and params. */
export function OperationProperties({ operationId }: { operationId: string }) {
  const operation = useDocumentStore((s) =>
    s.document.operations.find((candidate) => candidate.id === operationId),
  );
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  if (!operation) return null;

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium">{operation.name}</h3>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={() => workspace.getState().selectOperation(null)}
          aria-label="Close operation properties"
          title="Close"
        >
          <XIcon />
        </Button>
      </div>

      <Row id="operation-name" label="Name">
        <OperationNameInput
          id="operation-name"
          name={operation.name}
          onRename={(name) => renameOperation(store, operation.id, name)}
        />
      </Row>
      <ToolPicker operation={operation} />
      <TargetsField operationId={operation.id} targets={operation.targets} />
      {operation.type === "profile" && <ProfileFields operation={operation} />}
      {operation.type === "pocket" && <PocketFields operation={operation} />}
      {operation.type === "drill" && <DrillFields operation={operation} />}
      {operation.type === "engrave" && <EngraveFields operation={operation} />}
      {operation.type === "vcarve" && <VCarveFields operation={operation} />}
      {operation.enabled ? (
        <ToolpathDetails operationId={operation.id} />
      ) : (
        <p className="text-muted-foreground">Disabled: no toolpath is computed.</p>
      )}
    </div>
  );
}

function Row({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
      <Label htmlFor={id} className="text-ui font-normal">
        {label}
      </Label>
      {children}
    </div>
  );
}

const SELECT_CLASS = "h-control px-2 pr-7 text-ui";

/** Picks the operation's tool; library tools the operation can't take, such as a V-bit to drill, are disabled. */
function ToolPicker({ operation }: { operation: Operation }) {
  const store = useDocumentStoreApi();
  const tools = useToolLibrary();
  const { id: operationId, tool } = operation;
  // The same check `setOperationTool` makes.
  const usable = useMemo(
    () =>
      new Set(
        tools
          .filter((choice) => Operation.safeParse({ ...operation, tool: choice.tool }).success)
          .map((choice) => choice.id),
      ),
    [tools, operation],
  );
  const current = matchingToolChoice(tools, tool);
  // Cleared once the operation's tool changes.
  const [rejected, setRejected] = useState<{ tool: Tool; error: string } | null>(null);
  const error = rejected?.tool === tool ? rejected.error : null;

  return (
    <>
      <Row id="operation-tool" label="Tool">
        {/* Lets a long tool name shrink the select instead of pushing the button out. */}
        <div className="flex min-w-0 items-center gap-1 *:data-[slot=native-select-wrapper]:min-w-0">
          <NativeSelect
            id="operation-tool"
            size="sm"
            value={current?.id ?? ""}
            onChange={(event) => {
              const choice = tools.find((candidate) => candidate.id === event.target.value);
              if (!choice) return;
              const result = setOperationTool(store, operationId, choice.tool);
              setRejected(result.ok ? null : { tool, error: result.error });
            }}
            className={SELECT_CLASS}
          >
            {!current && (
              // The snapshot differs from every library tool (edited or deleted since it was picked).
              <NativeSelectOption value="">{tool.name} (as picked)</NativeSelectOption>
            )}
            {tools.map((choice) => (
              <NativeSelectOption
                key={choice.id}
                value={choice.id}
                disabled={!usable.has(choice.id)}
              >
                {choice.tool.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <EditBitButton choice={current} />
        </div>
      </Row>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function TargetsField({
  operationId,
  targets,
}: {
  operationId: string;
  targets: OperationTarget[];
}) {
  const store = useDocumentStoreApi();
  const geometry = useDocumentStore((s) => s.document.geometry);
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths);
  const selected = useMemo(
    () => selectionTargets(geometry, selectedPaths),
    [geometry, selectedPaths],
  );
  const rows = useMemo(() => {
    const shapes = new Map(geometry.map((shape) => [shape.id, shape]));
    return targets.flatMap((target) => {
      const shape = shapes.get(target.shapeId);
      return shape ? [{ shape, paths: target.paths }] : [];
    });
  }, [geometry, targets]);

  return (
    <section aria-labelledby="operation-shapes-heading" className="grid gap-1">
      <div className="flex items-center gap-2">
        <h4 id="operation-shapes-heading" className="flex-1">
          Shapes
        </h4>
        <Button
          variant="outline"
          size="compact"
          disabled={selected.length === 0}
          onClick={() => setOperationTargets(store, operationId, selected)}
          title={
            selected.length > 0
              ? `Cut the ${targetsLabel(selected)} instead`
              : "Select shapes or paths to cut them instead"
          }
        >
          Use selected
        </Button>
      </div>
      <ul className="grid gap-0.5">
        {rows.map(({ shape, paths }) => (
          <li key={shape.id} className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{shape.name || "Unnamed shape"}</span>
            {paths && (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {paths.length} of {shape.paths.length} paths
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-compact"
              disabled={rows.length === 1}
              onClick={() =>
                setOperationTargets(
                  store,
                  operationId,
                  targets.filter((target) => target.shapeId !== shape.id),
                )
              }
              aria-label={`Remove ${shape.name || "unnamed shape"}`}
              title={rows.length === 1 ? "An operation needs at least one shape" : "Remove"}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Applies changes to an operation's params through `apply`, keeping why the
 * last one was rejected and the params it was rejected against: once they
 * change (another edit, an undo), the error no longer applies.
 */
function useParamsUpdate<P extends object>(
  params: P,
  apply: (changes: Partial<P>) => ActionResult,
) {
  const [rejected, setRejected] = useState<{
    params: P;
    errors: Partial<Record<keyof P, string>>;
  } | null>(null);
  const errors: Partial<Record<keyof P, string>> =
    rejected?.params === params ? rejected.errors : {};

  function update(field: keyof P, changes: Partial<P>) {
    const result = apply(changes);
    if (!result.ok) setRejected({ params, errors: { ...errors, [field]: result.error } });
  }

  return { errors, update };
}

/** The "Ramp in" checkbox, disabled for a tool that plunges straight down whatever it says. */
function RampCheckbox({
  id,
  tool,
  checked,
  onChange,
}: {
  id: string;
  tool: Tool;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const straight = tool.plungeAngle === 90;
  return (
    <Checkbox
      id={id}
      label="Ramp in"
      hint={
        straight
          ? "The tool's plunge angle is 90°, so it plunges straight down."
          : `At the tool's plunge angle (${tool.plungeAngle}°).`
      }
      checked={checked && !straight}
      disabled={straight}
      onChange={onChange}
    />
  );
}

function ProfileFields({ operation }: { operation: ProfileOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateProfileParams(store, operation.id, changes),
  );

  const length = {
    layout: "inline",
    quantity: "length",
    units,
    ...gestureHandlers(store),
  } as const;

  return (
    <section aria-labelledby="profile-heading" className="grid gap-2">
      <h4 id="profile-heading" className="font-medium">
        Profile
      </h4>
      <Row id="profile-side" label="Side">
        <NativeSelect
          id="profile-side"
          size="sm"
          value={params.side}
          onChange={(event) => {
            const side = ProfileSide.parse(event.target.value);
            // On the line leaves no wall for an allowance to stay on.
            update("side", side === "on" ? { side, allowance: 0, finishPass: false } : { side });
          }}
          className={SELECT_CLASS}
        >
          {ProfileSide.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {SIDE_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row id="profile-direction" label="Direction">
        <NativeSelect
          id="profile-direction"
          size="sm"
          value={params.direction}
          onChange={(event) =>
            update("direction", { direction: MillingDirection.parse(event.target.value) })
          }
          className={SELECT_CLASS}
        >
          {MillingDirection.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {DIRECTION_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <NumberField
        id="profile-depth"
        label="Depth"
        min={MIN_LENGTH}
        value={params.depth}
        onValueChange={(depth) => update("depth", { depth })}
        error={errors.depth}
        {...length}
      />
      <NumberField
        id="profile-allowance"
        label="Allowance"
        min={0}
        value={params.allowance}
        disabled={params.side === "on"}
        onValueChange={(allowance) =>
          // Nothing left for a finish pass to remove.
          update("allowance", allowance === 0 ? { allowance, finishPass: false } : { allowance })
        }
        error={errors.allowance}
        {...length}
      />
      <Checkbox
        id="profile-finish-pass"
        label="Finish pass"
        hint={params.allowance === 0 ? "Needs an allowance to remove." : undefined}
        checked={params.finishPass}
        disabled={params.allowance === 0}
        onChange={(finishPass) => update("finishPass", { finishPass })}
      />
      <Checkbox
        id="profile-lead-in"
        label="Lead-in arc"
        checked={params.leadIn !== null}
        onChange={(checked) =>
          update("leadIn", { leadIn: checked ? { radius: tool.diameter } : null })
        }
      />
      {params.leadIn && (
        <NumberField
          id="profile-lead-in-radius"
          label="Lead-in radius"
          min={MIN_LENGTH}
          value={params.leadIn.radius}
          onValueChange={(radius) => update("leadIn", { leadIn: { radius } })}
          error={errors.leadIn}
          {...length}
        />
      )}
      <RampCheckbox
        id="profile-ramp"
        tool={tool}
        checked={params.ramp}
        onChange={(ramp) => update("ramp", { ramp })}
      />
      <Checkbox
        id="profile-tabs"
        label="Holding tabs"
        checked={params.tabs !== null}
        onChange={(checked) =>
          update("tabs", {
            tabs: checked ? defaultTabs(store.getState().document, operation) : null,
          })
        }
      />
      {params.tabs && (
        <TabsFields
          operation={operation}
          tabs={params.tabs}
          error={errors.tabs}
          onChange={(tabs) => update("tabs", { tabs })}
        />
      )}
      {(errors.side ?? errors.direction ?? errors.finishPass ?? errors.ramp) && (
        <p role="alert" className="text-destructive">
          {errors.side ?? errors.direction ?? errors.finishPass ?? errors.ramp}
        </p>
      )}
    </section>
  );
}

function PocketFields({ operation }: { operation: PocketOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { strategy } = params;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updatePocketParams(store, operation.id, changes),
  );

  const length = {
    layout: "inline",
    quantity: "length",
    units,
    ...gestureHandlers(store),
  } as const;

  return (
    <section aria-labelledby="pocket-heading" className="grid gap-2">
      <h4 id="pocket-heading" className="font-medium">
        Pocket
      </h4>
      <Row id="pocket-strategy" label="Strategy">
        <NativeSelect
          id="pocket-strategy"
          size="sm"
          value={strategy.type}
          onChange={(event) => {
            const type = event.target.value as PocketStrategy["type"];
            if (type !== strategy.type) update("strategy", { strategy: DEFAULT_STRATEGIES[type] });
          }}
          className={SELECT_CLASS}
        >
          {Object.entries(STRATEGY_LABELS).map(([type, label]) => (
            <NativeSelectOption key={type} value={type}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      {strategy.type === "linear" && (
        <Row id="pocket-angle" label="Angle">
          <NativeSelect
            id="pocket-angle"
            size="sm"
            value={strategy.angle}
            onChange={(event) =>
              update("strategy", {
                strategy: { type: "linear", angle: LinearAngle.parse(Number(event.target.value)) },
              })
            }
            className={SELECT_CLASS}
          >
            {LINEAR_ANGLES.map((angle) => (
              <NativeSelectOption key={angle} value={angle}>
                {`${angle < 0 ? "−" : ""}${Math.abs(angle)}°`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      )}
      {strategy.type === "peel" && (
        <Row id="pocket-peel-start" label="Start from">
          <NativeSelect
            id="pocket-peel-start"
            size="sm"
            value={strategy.start}
            onChange={(event) =>
              update("strategy", {
                strategy: { type: "peel", start: PeelStart.parse(event.target.value) },
              })
            }
            className={SELECT_CLASS}
          >
            {PeelStart.options.map((start) => (
              <NativeSelectOption key={start} value={start}>
                {PEEL_START_LABELS[start]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      )}
      <p className="text-muted-foreground">
        {STRATEGY_HINTS[strategy.type]}, at the tool's step-over ({tool.stepOver}%) and step-down.
      </p>
      <Row id="pocket-direction" label="Direction">
        <NativeSelect
          id="pocket-direction"
          size="sm"
          value={params.direction}
          onChange={(event) =>
            update("direction", { direction: MillingDirection.parse(event.target.value) })
          }
          className={SELECT_CLASS}
        >
          {MillingDirection.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {DIRECTION_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      {strategy.type === "linear" && (
        <p className="text-muted-foreground">
          Linear passes alternate direction; this one applies to the laps and the finish pass.
        </p>
      )}
      <NumberField
        id="pocket-depth"
        label="Depth"
        min={MIN_LENGTH}
        value={params.depth}
        onValueChange={(depth) => update("depth", { depth })}
        error={errors.depth}
        {...length}
      />
      <NumberField
        id="pocket-allowance"
        label="Allowance"
        min={0}
        value={params.allowance}
        onValueChange={(allowance) =>
          // Nothing left for a finish pass to remove.
          update("allowance", allowance === 0 ? { allowance, finishPass: false } : { allowance })
        }
        error={errors.allowance}
        {...length}
      />
      <Checkbox
        id="pocket-finish-pass"
        label="Finish pass"
        hint={
          params.allowance === 0
            ? "Needs an allowance to remove."
            : "One lap on the walls and islands at full depth."
        }
        checked={params.finishPass}
        disabled={params.allowance === 0}
        onChange={(finishPass) => update("finishPass", { finishPass })}
      />
      <RampCheckbox
        id="pocket-ramp"
        tool={tool}
        checked={params.ramp}
        onChange={(ramp) => update("ramp", { ramp })}
      />
      {(errors.strategy ?? errors.direction ?? errors.finishPass ?? errors.ramp) && (
        <p role="alert" className="text-destructive">
          {errors.strategy ?? errors.direction ?? errors.finishPass ?? errors.ramp}
        </p>
      )}
    </section>
  );
}

function DrillFields({ operation }: { operation: DrillOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateDrillParams(store, operation.id, changes),
  );

  return (
    <section aria-labelledby="drill-heading" className="grid gap-2">
      <h4 id="drill-heading" className="font-medium">
        Drill
      </h4>
      <p className="text-muted-foreground">
        Holes at the points and circles. The tool plunges into the points and the circles it fits
        within {formatQuantity(DRILL_DIAMETER_TOLERANCE, "length", units)}{" "}
        {unitLabel("length", units)}
        {tool.type === "drill"
          ? "; a drill bit can't bore larger circles."
          : ", and bores larger circles with a helix at its plunge angle."}
      </p>
      <NumberField
        id="drill-depth"
        label="Depth"
        min={MIN_LENGTH}
        value={params.depth}
        onValueChange={(depth) => update("depth", { depth })}
        error={errors.depth}
        layout="inline"
        quantity="length"
        units={units}
        {...gestureHandlers(store)}
      />
      <Checkbox
        id="drill-peck"
        label="Peck"
        hint="Plunges in pecks no deeper than the tool's step-down, retracting after each to clear chips."
        checked={params.peck}
        onChange={(peck) => update("peck", { peck })}
      />
      {errors.peck && (
        <p role="alert" className="text-destructive">
          {errors.peck}
        </p>
      )}
    </section>
  );
}

function EngraveFields({ operation }: { operation: EngraveOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateEngraveParams(store, operation.id, changes),
  );
  const length = {
    layout: "inline",
    quantity: "length",
    units,
    ...gestureHandlers(store),
  } as const;
  const width = vBitLineWidth(tool, params.depth);
  // The narrowest line the depth field allows, so the two fields share a floor.
  const minWidth = vBitLineWidth(tool, MIN_LENGTH);
  const tip = tool.tipDiameter ?? 0;

  return (
    <section aria-labelledby="engrave-heading" className="grid gap-2">
      <h4 id="engrave-heading" className="font-medium">
        Engrave
      </h4>
      <Row id="engrave-side" label="Position">
        <NativeSelect
          id="engrave-side"
          size="sm"
          value={params.side}
          onChange={(event) => update("side", { side: ProfileSide.parse(event.target.value) })}
          className={SELECT_CLASS}
        >
          {(["on", "inside", "outside"] as const).map((option) => (
            <NativeSelectOption key={option} value={option}>
              {SIDE_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <p className="text-muted-foreground">
        {params.side === "on"
          ? "Follows every path, open and closed, on the line, "
          : `Follows the closed paths ${params.side} the line, with an edge of the groove on it, `}
        in passes no deeper than the tool's step-down.
      </p>
      <NumberField
        id="engrave-depth"
        label="Depth"
        min={MIN_LENGTH}
        value={params.depth}
        onValueChange={(depth) => update("depth", { depth })}
        error={errors.depth}
        {...length}
      />
      {width !== null && minWidth !== null && (
        <>
          <NumberField
            id="engrave-width"
            label="Line width"
            min={minWidth}
            max={tool.diameter}
            value={width}
            onValueChange={(value) => {
              const depth = vBitDepthForWidth(tool, value);
              if (depth !== null) update("depth", { depth });
            }}
            {...length}
          />
          <p className="text-muted-foreground">
            {exceedsVBitCone(tool, params.depth)
              ? "Deeper than the cone, so the line is as wide as the bit."
              : `At the stock top, from the bit's ${tool.vAngle}° angle${
                  tip > 0
                    ? ` and ${formatQuantity(tip, "length", units)} ${unitLabel("length", units)} tip`
                    : ""
                }.`}
          </p>
        </>
      )}
      <RampCheckbox
        id="engrave-ramp"
        tool={tool}
        checked={params.ramp}
        onChange={(ramp) => update("ramp", { ramp })}
      />
      {(errors.side ?? errors.ramp) && (
        <p role="alert" className="text-destructive">
          {errors.side ?? errors.ramp}
        </p>
      )}
    </section>
  );
}

function VCarveFields({ operation }: { operation: VCarveOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const tools = useToolLibrary();
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateVCarveParams(store, operation.id, changes),
  );
  const length = (value: number) =>
    `${formatQuantity(value, "length", units)} ${unitLabel("length", units)}`;
  const cone = vBitConeDepth(tool);
  const width = vBitLineWidth(tool, params.maxDepth);
  const flatTool = params.flatBottom?.tool ?? null;
  const defaultFlatTool = flatBottomToolChoice(tools);
  const current = flatTool ? matchingToolChoice(tools, flatTool) : undefined;

  return (
    <section aria-labelledby="vcarve-heading" className="grid gap-2">
      <h4 id="vcarve-heading" className="font-medium">
        V-carve
      </h4>
      <p className="text-muted-foreground">
        Follows the middle of the closed paths, as deep as the bit's angle needs to reach their
        edges, in passes no deeper than the tool's step-down. Islands stay standing.
      </p>
      <NumberField
        id="vcarve-max-depth"
        label="Max depth"
        min={MIN_LENGTH}
        value={params.maxDepth}
        onValueChange={(maxDepth) => update("maxDepth", { maxDepth })}
        error={errors.maxDepth}
        layout="inline"
        quantity="length"
        units={units}
        {...gestureHandlers(store)}
      />
      {cone !== null && width !== null && (
        <p className="text-muted-foreground">
          {exceedsVBitCone(tool, params.maxDepth)
            ? `Deeper than the cone, so the bit carves no deeper than ${length(cone)}.`
            : `Parts wider than ${length(width)} reach it.`}
        </p>
      )}
      <Checkbox
        id="vcarve-flat-bottom"
        label="Flat bottom"
        hint={
          flatTool
            ? "The end mill clears those parts flat first; the V-bit then carves their walls."
            : defaultFlatTool
              ? "Clear the parts that reach the max depth flat with an end mill."
              : "Add a flat end mill to your tool library to clear a flat bottom."
        }
        checked={flatTool !== null}
        disabled={flatTool === null && !defaultFlatTool}
        onChange={(checked) =>
          update("flatBottom", {
            flatBottom: checked && defaultFlatTool ? { tool: defaultFlatTool.tool } : null,
          })
        }
      />
      {flatTool && (
        <Row id="vcarve-flat-tool" label="End mill">
          <NativeSelect
            id="vcarve-flat-tool"
            size="sm"
            value={current?.id ?? ""}
            onChange={(event) => {
              const choice = tools.find((candidate) => candidate.id === event.target.value);
              if (choice) update("flatBottom", { flatBottom: { tool: choice.tool } });
            }}
            className={SELECT_CLASS}
          >
            {!current && (
              <NativeSelectOption value="">{flatTool.name} (as picked)</NativeSelectOption>
            )}
            {tools.map((choice) => (
              <NativeSelectOption
                key={choice.id}
                value={choice.id}
                disabled={!canClearFlatBottom(choice.tool)}
              >
                {choice.tool.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      )}
      {errors.flatBottom && (
        <p role="alert" className="text-destructive">
          {errors.flatBottom}
        </p>
      )}
    </section>
  );
}

type PlacementMode = "count" | "spacing";

/** Tab size, auto placement and the switch into editing them in the viewport. */
function TabsFields({
  operation,
  tabs,
  error,
  onChange,
}: {
  operation: ProfileOperation;
  tabs: ProfileTabs;
  error?: string;
  onChange: (tabs: ProfileTabs) => void;
}) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const editing = useWorkspaceStore((s) => s.editingTabs);
  const setEditing = useWorkspaceStore((s) => s.setEditingTabs);
  const [mode, setMode] = useState<PlacementMode>("count");
  const [count, setCount] = useState(DEFAULT_TAB_COUNT);
  const [spacing, setSpacing] = useState(100);
  const length = {
    layout: "inline",
    quantity: "length",
    units,
    ...gestureHandlers(store),
  } as const;
  const tabCount = tabs.positions.length;

  return (
    <div className="grid gap-2 border-l-2 pl-2">
      <NumberField
        id="profile-tab-width"
        label="Tab width"
        min={MIN_LENGTH}
        value={tabs.width}
        onValueChange={(width) => onChange({ ...tabs, width })}
        {...length}
      />
      <NumberField
        id="profile-tab-height"
        label="Tab height"
        min={MIN_LENGTH}
        value={tabs.height}
        onValueChange={(height) => onChange({ ...tabs, height })}
        {...length}
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Row id="profile-tab-placement" label="Auto place">
        <NativeSelect
          id="profile-tab-placement"
          size="sm"
          value={mode}
          onChange={(event) => setMode(event.target.value as PlacementMode)}
          className={SELECT_CLASS}
        >
          <NativeSelectOption value="count">Per contour</NativeSelectOption>
          <NativeSelectOption value="spacing">By spacing</NativeSelectOption>
        </NativeSelect>
      </Row>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          {mode === "count" ? (
            <NumberField
              id="profile-tab-count"
              label="Tabs"
              layout="inline"
              integer
              min={1}
              value={count}
              onValueChange={setCount}
            />
          ) : (
            <NumberField
              id="profile-tab-spacing"
              label="Every"
              layout="inline"
              quantity="length"
              units={units}
              min={MIN_LENGTH}
              value={spacing}
              onValueChange={setSpacing}
            />
          )}
        </div>
        <Button
          variant="outline"
          size="compact"
          onClick={() =>
            autoPlaceTabs(store, operation.id, mode === "count" ? { count } : { spacing })
          }
          title="Replace the tabs with ones spread evenly along each contour"
        >
          Place
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">
          {tabCount === 1 ? "1 tab" : `${tabCount} tabs`}
        </span>
        <Button
          variant={editing ? "secondary" : "outline"}
          size="compact"
          aria-pressed={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Done" : "Edit in viewport"}
        </Button>
      </div>
      {editing && (
        <p className="text-muted-foreground">
          Click a contour to add a tab, drag a tab to move it, click it to remove it.
        </p>
      )}
    </div>
  );
}

function Checkbox({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="size-3.5 accent-primary"
      />
      <Label htmlFor={id} className="text-ui font-normal">
        {label}
      </Label>
      {hint && (
        <p id={`${id}-hint`} className="col-start-2 text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** The toolpath's state from the worker, with its error or warnings spelt out. */
function ToolpathDetails({ operationId }: { operationId: string }) {
  const entry = useToolpathStore((s) => s.entries[operationId]);
  if (!entry || entry.status === "computing") {
    return <p className="text-muted-foreground">Computing toolpath…</p>;
  }
  if (entry.status === "error") {
    return (
      <p role="alert" className="text-destructive">
        The toolpath couldn't be computed: {entry.error}
      </p>
    );
  }
  const { warnings } = entry;
  if (warnings.length === 0) return null;
  return (
    <section
      aria-label="Toolpath warnings"
      className="grid gap-1 text-amber-700 dark:text-amber-500"
    >
      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </section>
  );
}
