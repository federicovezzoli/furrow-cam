"use client";

import { exceedsVBitCone, MIN_LENGTH, vBitConeDepth, vBitLineWidth } from "@furrow/cam-core";
import { canClearFlatBottom, type VCarveOperation } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useTranslations } from "use-intl";
import { useLength } from "../../hooks/use-length";
import { useDocumentStore, useDocumentStoreApi } from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import { DEFAULT_STEP_OVER, updateVCarveParams } from "../../stores/operation-actions";
import { Checkbox } from "../checkbox";
import { flatBottomToolChoice, matchingToolChoice, useToolLibrary } from "../tool-library";
import { Row, SELECT_CLASS, StepOverField, useParamsUpdate } from "./fields";

export function VCarveFields({ operation }: { operation: VCarveOperation }) {
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
        id="vcarve-start-depth"
        label={t("startDepth")}
        min={0}
        value={params.startDepth}
        onValueChange={(startDepth) => update("startDepth", { startDepth })}
        error={errors.startDepth}
        layout="inline"
        quantity="length"
        units={units}
        {...gestureHandlers(store)}
      />
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
          {exceedsVBitCone(tool, params.startDepth + params.maxDepth)
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
