"use client";

import {
  DRILL_DIAMETER_TOLERANCE,
  exceedsVBitCone,
  vBitConeDepth,
  vBitDepthForWidth,
  vBitLineWidth,
} from "@furrow/cam-core";
import {
  canClearFlatBottom,
  type DrillOperation,
  type EngraveOperation,
  type FinishingStrategy,
  LinearAngle,
  MillingDirection,
  type Operation,
  type OperationTarget,
  PeelStart,
  type PocketOperation,
  type PocketStrategy,
  type ProfileOperation,
  ProfileSide,
  type ProfileTabs,
  RasterDirection,
  type ReliefFinishOperation,
  type ReliefRoughOperation,
  type RoughingBoundary,
  type RoughingBoundaryType,
  SpiralStart,
  type Tool,
  toolProblem,
  type VCarveOperation,
} from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@furrow/ui/components/ui/native-select";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useLength } from "../hooks/use-length";
import { useTargetsLabel } from "../hooks/use-targets-label";
import { selectionTargets } from "../lib/path-selection";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { gestureHandlers } from "../stores/gesture-handlers";
import {
  type ActionResult,
  autoPlaceTabs,
  DEFAULT_STEP_OVER,
  DEFAULT_TAB_COUNT,
  defaultTabs,
  renameOperation,
  setOperationTargets,
  setOperationTool,
  toolError,
  updateDrillParams,
  updateEngraveParams,
  updatePocketParams,
  updateProfileParams,
  updateReliefFinishParams,
  updateReliefRoughParams,
  updateVCarveParams,
} from "../stores/operation-actions";
import { EditBitButton } from "./edit-bit-dialog";
import { NewBitDialog } from "./new-bit-dialog";
import { OperationNameInput } from "./operation-name-input";
import { flatBottomToolChoice, matchingToolChoice, useToolLibrary } from "./tool-library";

/** The pocket strategies, in the order the select lists them. */
const STRATEGY_TYPES = ["offset", "linear", "peel"] as const;

/** The strategy each type starts as when picked. */
const DEFAULT_STRATEGIES: Record<PocketStrategy["type"], PocketStrategy> = {
  offset: { type: "offset" },
  linear: { type: "linear", angle: 0 },
  peel: { type: "peel", start: "centre" },
};

const LINEAR_ANGLES = LinearAngle.options.map((option) => option.value);

/** What picking each boundary sets: a margin starts at 5 mm, inside a fitted model's border. */
const DEFAULT_BOUNDARIES: Record<RoughingBoundaryType, RoughingBoundary> = {
  model: { type: "model" },
  margin: { type: "margin", distance: 5 },
  stock: { type: "stock" },
};

/** Where peeling may start in 3D roughing: its islands change from level to level. */
const ROUGHING_PEEL_STARTS = PeelStart.options.filter((start) => start !== "inside");

/** Keeps depths and radii positive, as the operation params require, when stepping or scrubbing down. */
const MIN_LENGTH = 0.01;

/** The selected operation's name, tool, shapes and params. */
export function OperationProperties({ operationId }: { operationId: string }) {
  const operation = useDocumentStore((s) =>
    s.document.operations.find((candidate) => candidate.id === operationId),
  );
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const t = useTranslations("Operation");
  if (!operation) return null;

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium">{operation.name}</h3>
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={() => workspace.getState().selectOperation(null)}
          aria-label={t("closeLabel")}
          title={t("close")}
        >
          <XIcon />
        </Button>
      </div>

      <Row id="operation-name" label={t("name")}>
        <OperationNameInput
          id="operation-name"
          name={operation.name}
          onRename={(name) => renameOperation(store, operation.id, name)}
        />
      </Row>
      <ToolPicker operation={operation} />
      {operation.type === "relief_finish" || operation.type === "relief_rough" ? (
        <ModelField modelId={operation.params.modelId} />
      ) : (
        <TargetsField operationId={operation.id} targets={operation.targets} />
      )}
      {operation.type === "profile" && <ProfileFields operation={operation} />}
      {operation.type === "pocket" && <PocketFields operation={operation} />}
      {operation.type === "drill" && <DrillFields operation={operation} />}
      {operation.type === "engrave" && <EngraveFields operation={operation} />}
      {operation.type === "vcarve" && <VCarveFields operation={operation} />}
      {operation.type === "relief_rough" && <ReliefRoughFields operation={operation} />}
      {operation.type === "relief_finish" && <ReliefFinishFields operation={operation} />}
      {operation.enabled ? (
        <ToolpathDetails operationId={operation.id} />
      ) : (
        <p className="text-muted-foreground">{t("disabled")}</p>
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

/** The tool select's last option, which opens the form for a new bit instead of picking one. */
const NEW_BIT = "__new";

/**
 * Picks the operation's tool from the library, then the catalog; tools the
 * operation can't take, such as a V-bit to drill, are disabled. "New bit…"
 * creates one in place and picks it.
 */
function ToolPicker({ operation }: { operation: Operation }) {
  const store = useDocumentStoreApi();
  const t = useTranslations("Operation");
  const tools = useToolLibrary();
  const { id: operationId, tool } = operation;
  // The same check `setOperationTool` makes.
  const usable = useMemo(
    () =>
      new Set(
        tools
          .filter((choice) => toolError(operation, choice.tool) === null)
          .map((choice) => choice.id),
      ),
    [tools, operation],
  );
  const current = matchingToolChoice(tools, tool);
  const library = { label: t("yourBits"), choices: tools.filter((choice) => !choice.catalog) };
  const catalog = { label: t("catalog"), choices: tools.filter((choice) => choice.catalog) };
  // Cleared once the operation's tool changes.
  const format = useFormatMessage();
  const [rejected, setRejected] = useState<{ tool: Tool; error: Translatable } | null>(null);
  // A tool saved before it was refused, e.g. a drill bit on a profile, until another is picked.
  const error = (rejected?.tool === tool ? rejected.error : null) ?? toolProblem(operation);
  const [creating, setCreating] = useState(false);

  function pick(picked: Tool) {
    const result = setOperationTool(store, operationId, picked);
    setRejected(result.ok ? null : { tool, error: result.error });
  }

  return (
    <>
      <Row id="operation-tool" label={t("tool")}>
        {/* Lets a long tool name shrink the select instead of pushing the button out. */}
        <div className="flex min-w-0 items-center gap-1 *:data-[slot=native-select-wrapper]:min-w-0">
          <NativeSelect
            id="operation-tool"
            size="sm"
            value={current?.id ?? ""}
            onChange={(event) => {
              // Controlled, so the select keeps showing the current tool meanwhile.
              if (event.target.value === NEW_BIT) return setCreating(true);
              const choice = tools.find((candidate) => candidate.id === event.target.value);
              if (choice) pick(choice.tool);
            }}
            className={SELECT_CLASS}
          >
            {!current && (
              // The snapshot differs from every library tool (edited or deleted since it was picked).
              <NativeSelectOption value="">{t("asPicked", { name: tool.name })}</NativeSelectOption>
            )}
            {[library, catalog].map(
              (group) =>
                group.choices.length > 0 && (
                  <NativeSelectOptGroup key={group.label} label={group.label}>
                    {group.choices.map((choice) => (
                      <NativeSelectOption
                        key={choice.id}
                        value={choice.id}
                        disabled={!usable.has(choice.id)}
                      >
                        {choice.tool.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ),
            )}
            <hr />
            <NativeSelectOption value={NEW_BIT}>{t("newBit")}</NativeSelectOption>
          </NativeSelect>
          <EditBitButton choice={current} />
        </div>
      </Row>
      <NewBitDialog
        operation={operation}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(saved) => {
          setCreating(false);
          // A bit the operation can't take stays in the library; the error says why.
          pick(saved.tool);
        }}
      />
      {error && (
        <p role="alert" className="text-destructive">
          {format(error)}
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
  const t = useTranslations("Operation");
  const targetsLabel = useTargetsLabel();
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
          {t("shapes")}
        </h4>
        <Button
          variant="outline"
          size="compact"
          disabled={selected.length === 0}
          onClick={() => setOperationTargets(store, operationId, selected)}
          title={
            selected.length > 0
              ? t("cutInstead", { targets: targetsLabel(selected) })
              : t("selectToCut")
          }
        >
          {t("useSelected")}
        </Button>
      </div>
      <ul className="grid gap-0.5">
        {rows.map(({ shape, paths }) => (
          <li key={shape.id} className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{shape.name || t("unnamedShape")}</span>
            {paths && (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {t("pathsOf", { count: paths.length, total: shape.paths.length })}
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
              aria-label={t("removeLabel", { name: shape.name || t("unnamedShape") })}
              title={rows.length === 1 ? t("needsShape") : t("remove")}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The model a 3D operation machines. */
function ModelField({ modelId }: { modelId: string }) {
  const t = useTranslations("Operation");
  const model = useDocumentStore((s) => s.document.models.find(({ id }) => id === modelId));
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
      <span>{t("model")}</span>
      <span className="truncate" title={model?.fileName}>
        {model?.fileName ?? t("missing")}
      </span>
    </div>
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
  const format = useFormatMessage();
  const [rejected, setRejected] = useState<{
    params: P;
    errors: Partial<Record<keyof P, Translatable>>;
  } | null>(null);
  const kept = rejected?.params === params ? rejected.errors : {};
  // Translated as shown, so they follow a change of language.
  const errors = Object.fromEntries(
    Object.entries(kept).map(([field, error]) => [field, format(error as Translatable)]),
  ) as Partial<Record<keyof P, string>>;

  function update(field: keyof P, changes: Partial<P>) {
    const result = apply(changes);
    if (!result.ok) setRejected({ params, errors: { ...kept, [field]: result.error } });
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
  const t = useTranslations("Operation");
  const straight = tool.plungeAngle === 90;
  return (
    <Checkbox
      id={id}
      label={t("rampIn")}
      hint={straight ? t("rampStraight") : t("rampAngle", { angle: tool.plungeAngle })}
      checked={checked && !straight}
      disabled={straight}
      onChange={onChange}
    />
  );
}

/** The operation's step-over (#332), as a percentage of `tool`'s diameter, and the distance it makes. */
function StepOverField({
  id,
  tool,
  value,
  error,
  spiral = false,
  onValueChange,
}: {
  id: string;
  tool: Tool;
  value: number;
  error: string | undefined;
  /** Spirals step over between laps rather than passes. */
  spiral?: boolean;
  onValueChange: (stepOver: number) => void;
}) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const t = useTranslations("Operation");
  const length = useLength(units);
  return (
    <>
      <NumberField
        id={id}
        label={t("stepOver")}
        layout="inline"
        suffix="%"
        min={1}
        max={100}
        value={value}
        onValueChange={onValueChange}
        error={error}
        {...gestureHandlers(store)}
      />
      <p className="text-muted-foreground">
        {t("spacingHint", {
          spiral: spiral ? "yes" : "no",
          spacing: length((tool.diameter * value) / 100),
        })}
      </p>
    </>
  );
}

function ProfileFields({ operation }: { operation: ProfileOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateProfileParams(store, operation.id, changes),
  );
  const t = useTranslations("Operation");

  const length = {
    layout: "inline",
    quantity: "length",
    units,
    ...gestureHandlers(store),
  } as const;

  return (
    <section aria-labelledby="profile-heading" className="grid gap-2">
      <h4 id="profile-heading" className="font-medium">
        {t("profile")}
      </h4>
      <Row id="profile-side" label={t("side")}>
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
              {t(`sides.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row id="profile-direction" label={t("direction")}>
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
              {t(`directions.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <NumberField
        id="profile-depth"
        label={t("depth")}
        min={MIN_LENGTH}
        value={params.depth}
        onValueChange={(depth) => update("depth", { depth })}
        error={errors.depth}
        {...length}
      />
      <NumberField
        id="profile-allowance"
        label={t("allowance")}
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
        label={t("finishPass")}
        hint={params.allowance === 0 ? t("needsAllowance") : undefined}
        checked={params.finishPass}
        disabled={params.allowance === 0}
        onChange={(finishPass) => update("finishPass", { finishPass })}
      />
      <Checkbox
        id="profile-lead-in"
        label={t("leadIn")}
        checked={params.leadIn !== null}
        onChange={(checked) =>
          update("leadIn", { leadIn: checked ? { radius: tool.diameter } : null })
        }
      />
      {params.leadIn && (
        <NumberField
          id="profile-lead-in-radius"
          label={t("leadInRadius")}
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
        label={t("holdingTabs")}
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
  const t = useTranslations("Operation");

  const length = {
    layout: "inline",
    quantity: "length",
    units,
    ...gestureHandlers(store),
  } as const;

  return (
    <section aria-labelledby="pocket-heading" className="grid gap-2">
      <h4 id="pocket-heading" className="font-medium">
        {t("pocket")}
      </h4>
      <Row id="pocket-strategy" label={t("strategy")}>
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
          {STRATEGY_TYPES.map((type) => (
            <NativeSelectOption key={type} value={type}>
              {t(`strategies.${type}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      {strategy.type === "linear" && (
        <Row id="pocket-angle" label={t("angle")}>
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
        <Row id="pocket-peel-start" label={t("startFrom")}>
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
                {t(`peelStarts.${start}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      )}
      <p className="text-muted-foreground">
        {t("pocketHint", { hint: t(`strategyHints.${strategy.type}`) })}
      </p>
      <StepOverField
        id="pocket-step-over"
        tool={tool}
        value={params.stepOver}
        error={errors.stepOver}
        onValueChange={(stepOver) => update("stepOver", { stepOver })}
      />
      <Row id="pocket-direction" label={t("direction")}>
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
              {t(`directions.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      {strategy.type === "linear" && (
        <p className="text-muted-foreground">{t("linearDirection")}</p>
      )}
      <NumberField
        id="pocket-depth"
        label={t("depth")}
        min={MIN_LENGTH}
        value={params.depth}
        onValueChange={(depth) => update("depth", { depth })}
        error={errors.depth}
        {...length}
      />
      <NumberField
        id="pocket-allowance"
        label={t("allowance")}
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
        label={t("finishPass")}
        hint={params.allowance === 0 ? t("needsAllowance") : t("finishLap")}
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
  const t = useTranslations("Operation");
  const length = useLength(units);

  return (
    <section aria-labelledby="drill-heading" className="grid gap-2">
      <h4 id="drill-heading" className="font-medium">
        {t("drill")}
      </h4>
      <p className="text-muted-foreground">
        {t("drillHint", {
          tolerance: length(DRILL_DIAMETER_TOLERANCE),
          bore: tool.type === "drill" ? "no" : "yes",
        })}
      </p>
      <NumberField
        id="drill-depth"
        label={t("depth")}
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
        label={t("peck")}
        hint={t("peckHint")}
        checked={params.peck}
        onChange={(peck) => update("peck", { peck })}
      />
      {tool.type !== "drill" && (
        <StepOverField
          id="drill-step-over"
          tool={tool}
          value={params.stepOver}
          error={errors.stepOver}
          onValueChange={(stepOver) => update("stepOver", { stepOver })}
        />
      )}
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
  const t = useTranslations("Operation");
  const lengthText = useLength(units);
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
        {t("engrave")}
      </h4>
      <Row id="engrave-side" label={t("position")}>
        <NativeSelect
          id="engrave-side"
          size="sm"
          value={params.side}
          onChange={(event) => update("side", { side: ProfileSide.parse(event.target.value) })}
          className={SELECT_CLASS}
        >
          {(["on", "inside", "outside"] as const).map((option) => (
            <NativeSelectOption key={option} value={option}>
              {t(`sides.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <p className="text-muted-foreground">{t("engraveHint", { side: params.side })}</p>
      <NumberField
        id="engrave-depth"
        label={t("depth")}
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
            label={t("lineWidth")}
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
              ? t("lineTooDeep")
              : tip > 0
                ? t("lineAtTopTip", { angle: tool.vAngle ?? 0, tip: lengthText(tip) })
                : t("lineAtTop", { angle: tool.vAngle ?? 0 })}
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
  const t = useTranslations("Operation");
  const length = useLength(units);
  const cone = vBitConeDepth(tool);
  const width = vBitLineWidth(tool, params.maxDepth);
  const { flatBottom } = params;
  const flatTool = flatBottom?.tool ?? null;
  const defaultFlatTool = flatBottomToolChoice(tools);
  const current = flatTool ? matchingToolChoice(tools, flatTool) : undefined;

  return (
    <section aria-labelledby="vcarve-heading" className="grid gap-2">
      <h4 id="vcarve-heading" className="font-medium">
        {t("vcarve")}
      </h4>
      <p className="text-muted-foreground">{t("vcarveHint")}</p>
      <NumberField
        id="vcarve-max-depth"
        label={t("maxDepth")}
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
            ? t("vcarveTooDeep", { depth: length(cone) })
            : t("vcarveReach", { width: length(width) })}
        </p>
      )}
      <Checkbox
        id="vcarve-flat-bottom"
        label={t("flatBottom")}
        hint={flatTool ? t("flatOn") : defaultFlatTool ? t("flatOffer") : t("flatNeedTool")}
        checked={flatTool !== null}
        disabled={flatTool === null && !defaultFlatTool}
        onChange={(checked) =>
          update("flatBottom", {
            flatBottom:
              checked && defaultFlatTool
                ? { tool: defaultFlatTool.tool, stepOver: DEFAULT_STEP_OVER }
                : null,
          })
        }
      />
      {flatTool && (
        <Row id="vcarve-flat-tool" label={t("endMill")}>
          <NativeSelect
            id="vcarve-flat-tool"
            size="sm"
            value={current?.id ?? ""}
            onChange={(event) => {
              const choice = tools.find((candidate) => candidate.id === event.target.value);
              if (choice && flatBottom) {
                update("flatBottom", { flatBottom: { ...flatBottom, tool: choice.tool } });
              }
            }}
            className={SELECT_CLASS}
          >
            {!current && (
              <NativeSelectOption value="">
                {t("asPicked", { name: flatTool.name })}
              </NativeSelectOption>
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
      {flatBottom && (
        <StepOverField
          id="vcarve-flat-step-over"
          tool={flatBottom.tool}
          value={flatBottom.stepOver}
          error={undefined}
          onValueChange={(stepOver) =>
            update("flatBottom", { flatBottom: { ...flatBottom, stepOver } })
          }
        />
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
function ReliefRoughFields({ operation }: { operation: ReliefRoughOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { strategy } = params;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateReliefRoughParams(store, operation.id, changes),
  );
  const t = useTranslations("Operation");
  const stepDown = useLength(units)(tool.stepDown);

  return (
    <section aria-labelledby="relief-rough-heading" className="grid gap-2">
      <h4 id="relief-rough-heading" className="font-medium">
        {t("rough")}
      </h4>
      <p className="text-muted-foreground">{t("roughHint")}</p>
      <Row id="relief-rough-strategy" label={t("strategy")}>
        <NativeSelect
          id="relief-rough-strategy"
          size="sm"
          value={strategy.type}
          onChange={(event) => {
            const type = event.target.value as PocketStrategy["type"];
            if (type !== strategy.type) update("strategy", { strategy: DEFAULT_STRATEGIES[type] });
          }}
          className={SELECT_CLASS}
        >
          {STRATEGY_TYPES.map((type) => (
            <NativeSelectOption key={type} value={type}>
              {t(`strategies.${type}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      {strategy.type === "linear" && (
        <Row id="relief-rough-angle" label={t("angle")}>
          <NativeSelect
            id="relief-rough-angle"
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
        <Row id="relief-rough-peel-start" label={t("startFrom")}>
          <NativeSelect
            id="relief-rough-peel-start"
            size="sm"
            value={strategy.start}
            onChange={(event) =>
              update("strategy", {
                strategy: { type: "peel", start: PeelStart.parse(event.target.value) },
              })
            }
            className={SELECT_CLASS}
          >
            {ROUGHING_PEEL_STARTS.map((start) => (
              <NativeSelectOption key={start} value={start}>
                {t(`peelStarts.${start}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      )}
      <p className="text-muted-foreground">
        {t("roughStrategyHint", {
          hint:
            strategy.type === "linear"
              ? t("roughingLinearHint")
              : t(`strategyHints.${strategy.type}`),
          stepDown,
        })}
      </p>
      <StepOverField
        id="relief-rough-step-over"
        tool={tool}
        value={params.stepOver}
        error={errors.stepOver}
        onValueChange={(stepOver) => update("stepOver", { stepOver })}
      />
      {strategy.type !== "linear" && (
        <Row id="relief-rough-direction" label={t("direction")}>
          <NativeSelect
            id="relief-rough-direction"
            size="sm"
            value={params.direction}
            onChange={(event) =>
              update("direction", { direction: MillingDirection.parse(event.target.value) })
            }
            className={SELECT_CLASS}
          >
            {MillingDirection.options.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {t(`directions.${option}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      )}
      <NumberField
        id="relief-rough-stock-to-leave"
        label={t("stockToLeave")}
        layout="inline"
        quantity="length"
        units={units}
        min={0}
        value={params.stockToLeave}
        onValueChange={(stockToLeave) => update("stockToLeave", { stockToLeave })}
        error={errors.stockToLeave}
        {...gestureHandlers(store)}
      />
      <Row id="relief-rough-boundary" label={t("clear")}>
        <NativeSelect
          id="relief-rough-boundary"
          size="sm"
          value={params.boundary.type}
          onChange={(event) => {
            const type = event.target.value as RoughingBoundaryType;
            if (type !== params.boundary.type) {
              update("boundary", { boundary: DEFAULT_BOUNDARIES[type] });
            }
          }}
          className={SELECT_CLASS}
        >
          {(["model", "margin", "stock"] as const).map((type) => (
            <NativeSelectOption key={type} value={type}>
              {t(`boundaries.${type}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      {params.boundary.type === "margin" && (
        <NumberField
          id="relief-rough-margin"
          label={t("margin")}
          layout="inline"
          quantity="length"
          units={units}
          min={MIN_LENGTH}
          value={params.boundary.distance}
          onValueChange={(distance) =>
            update("boundary", { boundary: { type: "margin", distance } })
          }
          error={errors.boundary}
          {...gestureHandlers(store)}
        />
      )}
      <p className="text-muted-foreground">{t(`boundaryHints.${params.boundary.type}`)}</p>
      <RampCheckbox
        id="relief-rough-ramp"
        tool={tool}
        checked={params.ramp}
        onChange={(ramp) => update("ramp", { ramp })}
      />
      <RestCheckbox
        id="relief-rough-rest"
        checked={params.rest}
        onChange={(rest) => update("rest", { rest })}
      />
      {(errors.strategy ?? errors.direction ?? errors.ramp ?? errors.rest) && (
        <p role="alert" className="text-destructive">
          {errors.strategy ?? errors.direction ?? errors.ramp ?? errors.rest}
        </p>
      )}
    </section>
  );
}

/** Rest machining (PRD-0005 S8): the switch and what it does. */
function RestCheckbox({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations("Operation");
  return (
    <Checkbox
      id={id}
      label={t("rest")}
      hint={t("restHint")}
      checked={checked}
      onChange={onChange}
    />
  );
}

/** What picking each finishing strategy sets: contours start 0.5 mm apart, spirals at the outline. */
const DEFAULT_FINISHING_STRATEGIES: Record<FinishingStrategy["type"], FinishingStrategy> = {
  parallel: { type: "parallel", angle: 0, direction: "zigzag" },
  waterline: { type: "waterline", stepDown: 0.5 },
  spiral: { type: "spiral", start: "outside" },
};

/** Steps the passes' angle by 15°. 180° is 0° again, so the field stops short of it. */
const ANGLE_STEP = 15;

function ReliefFinishFields({ operation }: { operation: ReliefFinishOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateReliefFinishParams(store, operation.id, changes),
  );
  const t = useTranslations("Operation");
  const { strategy } = params;
  const gestures = gestureHandlers(store);

  return (
    <section aria-labelledby="relief-finish-heading" className="grid gap-2">
      <h4 id="relief-finish-heading" className="font-medium">
        {t("finish")}
      </h4>
      <p className="text-muted-foreground">{t("finishHint")}</p>
      <Row id="relief-strategy" label={t("strategy")}>
        <NativeSelect
          id="relief-strategy"
          size="sm"
          value={strategy.type}
          onChange={(event) => {
            const type = event.target.value as FinishingStrategy["type"];
            if (type !== strategy.type) {
              update("strategy", { strategy: DEFAULT_FINISHING_STRATEGIES[type] });
            }
          }}
          className={SELECT_CLASS}
        >
          {(["parallel", "waterline", "spiral"] as const).map((type) => (
            <NativeSelectOption key={type} value={type}>
              {t(`finishing.${type}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <p className="text-muted-foreground">{t(`finishingHints.${strategy.type}`)}</p>
      {strategy.type === "parallel" && (
        <NumberField
          id="relief-angle"
          label={t("angle")}
          layout="inline"
          suffix="°"
          min={0}
          max={179.9}
          step={ANGLE_STEP}
          value={strategy.angle}
          onValueChange={(angle) => update("strategy", { strategy: { ...strategy, angle } })}
          error={errors.strategy}
          {...gestures}
        />
      )}
      {strategy.type === "waterline" && (
        <NumberField
          id="relief-step-down"
          label={t("stepDown")}
          layout="inline"
          quantity="length"
          units={units}
          min={MIN_LENGTH}
          value={strategy.stepDown}
          onValueChange={(stepDown) =>
            update("strategy", { strategy: { type: "waterline", stepDown } })
          }
          error={errors.strategy}
          {...gestures}
        />
      )}
      {strategy.type === "spiral" && (
        <Row id="relief-spiral-start" label={t("startFrom")}>
          <NativeSelect
            id="relief-spiral-start"
            size="sm"
            value={strategy.start}
            onChange={(event) =>
              update("strategy", {
                strategy: { type: "spiral", start: SpiralStart.parse(event.target.value) },
              })
            }
            className={SELECT_CLASS}
          >
            {SpiralStart.options.map((start) => (
              <NativeSelectOption key={start} value={start}>
                {t(`spiralStarts.${start}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
      )}
      {strategy.type !== "waterline" && (
        <StepOverField
          id="relief-step-over"
          tool={tool}
          value={params.stepOver}
          error={errors.stepOver}
          spiral={strategy.type === "spiral"}
          onValueChange={(stepOver) => update("stepOver", { stepOver })}
        />
      )}
      {strategy.type === "parallel" && (
        <>
          <Row id="relief-direction" label={t("direction")}>
            <NativeSelect
              id="relief-direction"
              size="sm"
              value={strategy.direction}
              onChange={(event) =>
                update("strategy", {
                  strategy: { ...strategy, direction: RasterDirection.parse(event.target.value) },
                })
              }
              className={SELECT_CLASS}
            >
              {RasterDirection.options.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {t(`raster.${option}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Row>
          <p className="text-muted-foreground">
            {strategy.direction === "zigzag" ? t("zigzagHint") : t("oneWayHint")}
          </p>
        </>
      )}
      <NumberField
        id="relief-stock-to-leave"
        label={t("stockToLeave")}
        layout="inline"
        quantity="length"
        units={units}
        min={0}
        value={params.stockToLeave}
        onValueChange={(stockToLeave) => update("stockToLeave", { stockToLeave })}
        error={errors.stockToLeave}
        {...gestures}
      />
      <RestCheckbox
        id="relief-finish-rest"
        checked={params.rest}
        onChange={(rest) => update("rest", { rest })}
      />
      {errors.rest && (
        <p role="alert" className="text-destructive">
          {errors.rest}
        </p>
      )}
    </section>
  );
}

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
  const t = useTranslations("Operation");
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
        label={t("tabWidth")}
        min={MIN_LENGTH}
        value={tabs.width}
        onValueChange={(width) => onChange({ ...tabs, width })}
        {...length}
      />
      <NumberField
        id="profile-tab-height"
        label={t("tabHeight")}
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
      <Row id="profile-tab-placement" label={t("autoPlace")}>
        <NativeSelect
          id="profile-tab-placement"
          size="sm"
          value={mode}
          onChange={(event) => setMode(event.target.value as PlacementMode)}
          className={SELECT_CLASS}
        >
          <NativeSelectOption value="count">{t("perContour")}</NativeSelectOption>
          <NativeSelectOption value="spacing">{t("bySpacing")}</NativeSelectOption>
        </NativeSelect>
      </Row>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          {mode === "count" ? (
            <NumberField
              id="profile-tab-count"
              label={t("tabs")}
              layout="inline"
              integer
              min={1}
              value={count}
              onValueChange={setCount}
            />
          ) : (
            <NumberField
              id="profile-tab-spacing"
              label={t("every")}
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
          title={t("placeTitle")}
        >
          {t("place")}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">{t("tabCount", { count: tabCount })}</span>
        <Button
          variant={editing ? "secondary" : "outline"}
          size="compact"
          aria-pressed={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? t("done") : t("editInViewport")}
        </Button>
      </div>
      {editing && <p className="text-muted-foreground">{t("editHint")}</p>}
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

/**
 * The toolpath's state from the worker, with its error or warnings spelt out,
 * and how far it got with a way to cancel it when it reports that.
 */
function ToolpathDetails({ operationId }: { operationId: string }) {
  const entry = useToolpathStore((s) => s.entries[operationId]);
  const controls = useToolpathStore((s) => s.controls);
  const format = useFormatMessage();
  const t = useTranslations("Operation");
  if (!entry || entry.status === "computing") {
    const progress = entry?.status === "computing" ? entry.progress : undefined;
    if (progress === undefined) {
      return <p className="text-muted-foreground">{t("computing")}</p>;
    }
    const percent = Math.floor(progress * 100);
    return (
      <div className="flex items-center gap-2">
        <label htmlFor="toolpath-progress" className="shrink-0 text-muted-foreground">
          {t("computing")}
        </label>
        <progress
          id="toolpath-progress"
          max={100}
          value={percent}
          className="h-1.5 min-w-0 flex-1 accent-primary"
        >
          {percent}%
        </progress>
        <Button variant="outline" size="compact" onClick={() => controls.cancel(operationId)}>
          {t("cancel")}
        </Button>
      </div>
    );
  }
  if (entry.status === "error" && entry.cancelled) {
    return (
      <div className="flex items-center gap-2">
        <p className="flex-1 text-muted-foreground">{t("cancelled")}</p>
        <Button variant="outline" size="compact" onClick={() => controls.retry(operationId)}>
          {t("computeAgain")}
        </Button>
      </div>
    );
  }
  if (entry.status === "error") {
    return (
      <p role="alert" className="text-destructive">
        {t("failed", { error: format(entry.error) })}
      </p>
    );
  }
  const { warnings } = entry;
  if (warnings.length === 0) return null;
  return (
    <section aria-label={t("warnings")} className="grid gap-1 text-amber-700 dark:text-amber-500">
      {warnings.map((warning) => (
        <p key={JSON.stringify(warning)}>{format(warning)}</p>
      ))}
    </section>
  );
}
