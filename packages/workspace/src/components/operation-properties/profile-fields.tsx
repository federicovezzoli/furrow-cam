"use client";

import { MIN_LENGTH } from "@furrow/cam-core";
import {
  type CornerOvercuts,
  MillingDirection,
  type ProfileOperation,
  ProfileSide,
  type ProfileTabs,
} from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useTabCount } from "../../hooks/use-tab-count";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import {
  autoPlaceTabs,
  DEFAULT_TAB_COUNT,
  defaultTabs,
  tabContourCount,
  updateProfileParams,
} from "../../stores/operation-actions";
import { Checkbox } from "../checkbox";
import { RampCheckbox, Row, SELECT_CLASS, StartPointsFields, useParamsUpdate } from "./fields";

/** Corner overcuts (#428) start on right angles and anything sharper. */
const DEFAULT_OVERCUT_ANGLE = 90;

export function ProfileFields({ operation }: { operation: ProfileOperation }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const { params, tool } = operation;
  const { errors, update } = useParamsUpdate(params, (changes) =>
    updateProfileParams(store, operation.id, changes),
  );
  const t = useTranslations("Operation");
  const plunges = params.startPoints.filter(({ plunge }) => plunge !== null).length;

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
            // On the line leaves no wall for an allowance to stay on, and no corner to overcut.
            update(
              "side",
              side === "on"
                ? { side, allowance: 0, finishPass: false, cornerOvercuts: null }
                : { side },
            );
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
        hint={plunges > 0 ? t("tabsNeedNoPlunges") : undefined}
        checked={params.tabs !== null}
        disabled={params.tabs === null && plunges > 0}
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
      <StartPointsFields
        count={params.startPoints.length}
        plunges={params.tabs === null ? plunges : null}
      />
      <Checkbox
        id="profile-corner-overcuts"
        label={t("cornerOvercuts")}
        hint={params.side === "on" ? t("overcutsNeedSide") : undefined}
        checked={params.cornerOvercuts !== null}
        disabled={params.side === "on"}
        onChange={(checked) =>
          update("cornerOvercuts", {
            cornerOvercuts: checked ? { maxAngle: DEFAULT_OVERCUT_ANGLE, excluded: [] } : null,
          })
        }
      />
      {params.cornerOvercuts && (
        <div className="grid gap-2 border-l-2 pl-2">
          <NumberField
            id="profile-overcut-angle"
            label={t("maxCornerAngle")}
            layout="inline"
            suffix="°"
            min={0}
            max={180}
            value={params.cornerOvercuts.maxAngle}
            onValueChange={(maxAngle) =>
              update("cornerOvercuts", {
                cornerOvercuts: { ...(params.cornerOvercuts as CornerOvercuts), maxAngle },
              })
            }
            error={errors.cornerOvercuts}
            {...gestureHandlers(store)}
          />
          <OvercutsEditing />
        </div>
      )}
      {(errors.side ?? errors.direction ?? errors.finishPass ?? errors.ramp) && (
        <p role="alert" className="text-destructive">
          {errors.side ?? errors.direction ?? errors.finishPass ?? errors.ramp}
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
  const t = useTranslations("Operation");
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const editing = useWorkspaceStore((s) => s.editing === "tabs");
  const setEditing = useWorkspaceStore((s) => s.setEditing);
  const [mode, setMode] = useState<PlacementMode>("count");
  const geometry = useDocumentStore((s) => s.document.geometry);
  const { targets } = operation;
  const { side } = operation.params;
  // Flattening and nesting every targeted path is slow on big drawings: only redo it when they change.
  const contours = useMemo(
    () => tabContourCount(geometry, targets, side),
    [geometry, targets, side],
  );
  const [count, setCount] = useTabCount(tabs.positions.length, contours, DEFAULT_TAB_COUNT);
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
        disabled={tabs.fullHeight}
        onValueChange={(height) => onChange({ ...tabs, height })}
        {...length}
      />
      <Checkbox
        id="profile-tab-full-height"
        label={t("tabFullHeight")}
        checked={tabs.fullHeight}
        onChange={(fullHeight) => onChange({ ...tabs, fullHeight })}
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
          onClick={() => setEditing(editing ? null : "tabs")}
        >
          {editing ? t("done") : t("editInViewport")}
        </Button>
      </div>
      {editing && <p className="text-muted-foreground">{t("editHint")}</p>}
    </div>
  );
}

/** What corner overcuts (#428) do, and a toggle for leaving them out in the viewport. */
function OvercutsEditing() {
  const t = useTranslations("Operation");
  const editing = useWorkspaceStore((s) => s.editing === "overcuts");
  const setEditing = useWorkspaceStore((s) => s.setEditing);
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">{t("overcutsHint")}</span>
        <Button
          variant={editing ? "secondary" : "outline"}
          size="compact"
          aria-pressed={editing}
          onClick={() => setEditing(editing ? null : "overcuts")}
        >
          {editing ? t("done") : t("editOvercuts")}
        </Button>
      </div>
      {editing && <p className="text-muted-foreground">{t("overcutsEditHint")}</p>}
    </>
  );
}
