"use client";

import {
  engraveCut,
  exceedsVBitCone,
  MIN_LENGTH,
  vBitDepthForWidth,
  vBitLineWidth,
} from "@furrow/cam-core";
import { type EngraveOperation, EngraveSide } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useTranslations } from "use-intl";
import { useLength } from "../../hooks/use-length";
import { useDocumentStore, useDocumentStoreApi } from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import { updateEngraveParams } from "../../stores/operation-actions";
import { RampCheckbox, Row, SELECT_CLASS, StartPointsFields, useParamsUpdate } from "./fields";

export function EngraveFields({ operation }: { operation: EngraveOperation }) {
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
  const lineWidth = vBitLineWidth(tool, params.depth);
  // The narrowest line the depth field allows, so the two fields share a floor.
  const minWidth = vBitLineWidth(tool, MIN_LENGTH);
  const tip = tool.tipDiameter ?? 0;
  const chamfer = params.side === "chamfer";
  const cut = engraveCut(tool, params);
  const sides = ["on", "inside", "outside", ...(tool.type === "v_bit" ? ["chamfer"] : [])] as const;

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
          onChange={(event) => update("side", { side: EngraveSide.parse(event.target.value) })}
          className={SELECT_CLASS}
        >
          {sides.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {t(`sides.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <p className="text-muted-foreground">{t("engraveHint", { side: params.side })}</p>
      {chamfer ? (
        <>
          <NumberField
            id="engrave-chamfer"
            label={t("chamferWidth")}
            min={MIN_LENGTH}
            value={params.width}
            onValueChange={(value) => update("width", { width: value })}
            error={errors.width}
            {...length}
          />
          <p className="text-muted-foreground">
            {cut.coneWide
              ? t("chamferTooWide")
              : t("chamferDepth", { depth: lengthText(cut.depth) })}
          </p>
        </>
      ) : (
        <NumberField
          id="engrave-depth"
          label={t("depth")}
          min={MIN_LENGTH}
          value={params.depth}
          onValueChange={(depth) => update("depth", { depth })}
          error={errors.depth}
          {...length}
        />
      )}
      {!chamfer && lineWidth !== null && minWidth !== null && (
        <>
          <NumberField
            id="engrave-width"
            label={t("lineWidth")}
            min={minWidth}
            max={tool.diameter}
            value={lineWidth}
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
      <StartPointsFields count={params.startPoints.length} />
      {(errors.side ?? errors.ramp) && (
        <p role="alert" className="text-destructive">
          {errors.side ?? errors.ramp}
        </p>
      )}
    </section>
  );
}
