"use client";

import { MIN_LENGTH } from "@furrow/cam-core";
import {
  type FinishingStrategy,
  RasterDirection,
  type ReliefFinishOperation,
  SpiralStart,
} from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useTranslations } from "use-intl";
import { useDocumentStore, useDocumentStoreApi } from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import { updateReliefFinishParams } from "../../stores/operation-actions";
import {
  BoundaryFields,
  RestCheckbox,
  Row,
  SELECT_CLASS,
  StepOverField,
  useParamsUpdate,
} from "./fields";

/** What picking each finishing strategy sets: contours start 0.5 mm apart, spirals at the outline. */
const DEFAULT_FINISHING_STRATEGIES: Record<FinishingStrategy["type"], FinishingStrategy> = {
  parallel: { type: "parallel", angle: 0, direction: "zigzag" },
  waterline: { type: "waterline", stepDown: 0.5 },
  spiral: { type: "spiral", start: "outside" },
};

/** Steps the passes' angle by 15°. 180° is 0° again, so the field stops short of it. */
const ANGLE_STEP = 15;

export function ReliefFinishFields({ operation }: { operation: ReliefFinishOperation }) {
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
      <BoundaryFields
        id="relief-finish"
        label={t("cover")}
        hint={t(`finishBoundaryHints.${params.boundary.type}`)}
        boundary={params.boundary}
        error={errors.boundary}
        onChange={(boundary) => update("boundary", { boundary })}
      />
      {strategy.type === "waterline" && params.boundary.type !== "model" && (
        <p className="text-muted-foreground">{t("finishBoundaryWaterline")}</p>
      )}
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
