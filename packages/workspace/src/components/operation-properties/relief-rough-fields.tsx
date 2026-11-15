"use client";

import {
  LinearAngle,
  MillingDirection,
  PeelStart,
  type PocketStrategy,
  type ReliefRoughOperation,
} from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useTranslations } from "use-intl";
import { useLength } from "../../hooks/use-length";
import { useDocumentStore, useDocumentStoreApi } from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import { updateReliefRoughParams } from "../../stores/operation-actions";
import {
  BoundaryFields,
  DEFAULT_STRATEGIES,
  LINEAR_ANGLES,
  RampCheckbox,
  RestCheckbox,
  Row,
  SELECT_CLASS,
  STRATEGY_TYPES,
  StepOverField,
  useParamsUpdate,
} from "./fields";

/** Where peeling may start in 3D roughing: its islands change from level to level. */
const ROUGHING_PEEL_STARTS = PeelStart.options.filter((start) => start !== "inside");

export function ReliefRoughFields({ operation }: { operation: ReliefRoughOperation }) {
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
      <BoundaryFields
        id="relief-rough"
        label={t("clear")}
        hint={t(`boundaryHints.${params.boundary.type}`)}
        boundary={params.boundary}
        error={errors.boundary}
        onChange={(boundary) => update("boundary", { boundary })}
      />
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
