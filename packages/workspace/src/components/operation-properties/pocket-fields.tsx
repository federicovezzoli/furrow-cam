"use client";

import { MIN_LENGTH } from "@furrow/cam-core";
import {
  LinearAngle,
  MillingDirection,
  PeelStart,
  type PocketOperation,
  type PocketStrategy,
  ProfileSide,
} from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useTranslations } from "use-intl";
import { useDocumentStore, useDocumentStoreApi } from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import { updatePocketParams } from "../../stores/operation-actions";
import { Checkbox } from "../checkbox";
import {
  DEFAULT_STRATEGIES,
  LINEAR_ANGLES,
  RampCheckbox,
  Row,
  SELECT_CLASS,
  STRATEGY_TYPES,
  StepOverField,
  useParamsUpdate,
} from "./fields";

export function PocketFields({ operation }: { operation: PocketOperation }) {
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
      <Row id="pocket-side" label={t("side")}>
        <NativeSelect
          id="pocket-side"
          size="sm"
          value={params.side}
          onChange={(event) => update("side", { side: ProfileSide.parse(event.target.value) })}
          className={SELECT_CLASS}
        >
          {ProfileSide.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {t(`sides.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
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
      {(errors.side ?? errors.strategy ?? errors.direction ?? errors.finishPass ?? errors.ramp) && (
        <p role="alert" className="text-destructive">
          {errors.side ?? errors.strategy ?? errors.direction ?? errors.finishPass ?? errors.ramp}
        </p>
      )}
    </section>
  );
}
