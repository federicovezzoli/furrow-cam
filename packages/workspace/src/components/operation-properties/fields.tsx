"use client";

import { MIN_LENGTH } from "@furrow/cam-core";
import {
  LinearAngle,
  type PocketStrategy,
  type RoughingBoundary,
  type RoughingBoundaryType,
  type Tool,
} from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type * as React from "react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useLength } from "../../hooks/use-length";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStore,
} from "../../providers/workspace-stores";
import { gestureHandlers } from "../../stores/gesture-handlers";
import type { ActionResult } from "../../stores/operation-actions";
import { Checkbox } from "../checkbox";

/** The pocket strategies, in the order the select lists them. */
export const STRATEGY_TYPES = ["offset", "linear", "peel"] as const;

/** The strategy each type starts as when picked. */
export const DEFAULT_STRATEGIES: Record<PocketStrategy["type"], PocketStrategy> = {
  offset: { type: "offset" },
  linear: { type: "linear", angle: 0 },
  peel: { type: "peel", start: "centre" },
};

export const LINEAR_ANGLES = LinearAngle.options.map((option) => option.value);

/** What picking each boundary sets: a margin starts at 5 mm, inside a fitted model's border. */
const DEFAULT_BOUNDARIES: Record<RoughingBoundaryType, RoughingBoundary> = {
  model: { type: "model" },
  margin: { type: "margin", distance: 5 },
  stock: { type: "stock" },
};

/** A label beside its control, as the panels lay fields out. */
export function Row({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
      <Label htmlFor={id} className="text-ui font-normal">
        {label}
      </Label>
      {children}
    </div>
  );
}

export const SELECT_CLASS = "h-control px-2 pr-7 text-ui";

/**
 * Applies changes to an operation's params through `apply`, keeping why the
 * last one was rejected and the params it was rejected against: once they
 * change (another edit, an undo), the error no longer applies.
 */
export function useParamsUpdate<P extends object>(
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

/** What a 3D operation covers (ADR-0038, ADR-0064): the model, a margin around it, or the whole stock. */
export function BoundaryFields({
  id,
  label,
  hint,
  boundary,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  boundary: RoughingBoundary;
  error: string | undefined;
  onChange: (boundary: RoughingBoundary) => void;
}) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const t = useTranslations("Operation");
  return (
    <>
      <Row id={`${id}-boundary`} label={label}>
        <NativeSelect
          id={`${id}-boundary`}
          size="sm"
          value={boundary.type}
          onChange={(event) => {
            const type = event.target.value as RoughingBoundaryType;
            if (type !== boundary.type) onChange(DEFAULT_BOUNDARIES[type]);
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
      {boundary.type === "margin" && (
        <NumberField
          id={`${id}-margin`}
          label={t("margin")}
          layout="inline"
          quantity="length"
          units={units}
          min={MIN_LENGTH}
          value={boundary.distance}
          onValueChange={(distance) => onChange({ type: "margin", distance })}
          error={error}
          {...gestureHandlers(store)}
        />
      )}
      <p className="text-muted-foreground">{hint}</p>
    </>
  );
}

/** The "Ramp in" checkbox, disabled for a tool that plunges straight down whatever it says. */
export function RampCheckbox({
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
export function StepOverField({
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

/** Rest machining (PRD-0005 S8): the switch and what it does. */
export function RestCheckbox({
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

/**
 * How many start points (#426) an operation has, and how many of a profile's
 * have a plunge point (#427), or `null` when it can't have them (an
 * engraving, a profile with tabs); and a toggle for editing them in the
 * viewport.
 */
export function StartPointsFields({
  count,
  plunges = null,
}: {
  count: number;
  plunges?: number | null;
}) {
  const t = useTranslations("Operation");
  const editing = useWorkspaceStore((s) => s.editing === "startPoints");
  const setEditing = useWorkspaceStore((s) => s.setEditing);
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">
          {t("startPointCount", { count })}
          {plunges !== null && plunges > 0 && ` · ${t("plungeCount", { count: plunges })}`}
        </span>
        <Button
          variant={editing ? "secondary" : "outline"}
          size="compact"
          aria-pressed={editing}
          onClick={() => setEditing(editing ? null : "startPoints")}
        >
          {editing ? t("done") : t("editStartPoints")}
        </Button>
      </div>
      {editing && (
        <p className="text-muted-foreground">
          {t("startPointsHint")}
          {plunges !== null && ` ${t("plungeHint")}`}
        </p>
      )}
    </>
  );
}
