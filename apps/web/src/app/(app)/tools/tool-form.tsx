"use client";

import { type Tool, ToolType } from "@furrow/document";
import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { FormError } from "@/components/auth/form-error";
import { Field, FieldError, fieldProps, SelectField } from "@/components/form-fields";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveTool, type ToolFormErrors } from "./actions";
import { BitTypeIcon } from "./bit-type-icon";
import { CUT_DIRECTION_LABELS, TOOL_TYPE_LABELS } from "./labels";

/** Starting values for a new tool; the rest of the fields start empty. */
const NEW_TOOL: Partial<Tool> = {
  type: "flat_end_mill",
  fluteCount: 2,
  cutDirection: "upcut",
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  stepDown: 1,
  stepOver: 40,
};

/** Edits the tool `id`, or creates one when `id` is `null`, starting from `NEW_TOOL` plus `values`. */
export function ToolForm({ id = null, values }: { id?: string | null; values: Partial<Tool> }) {
  const tool = id === null ? { ...NEW_TOOL, ...values } : values;
  const [type, setType] = useState<ToolType>(tool.type ?? "flat_end_mill");
  const [errors, setErrors] = useState<ToolFormErrors>({});
  const [pending, startTransition] = useTransition();
  const isEndMill = type === "flat_end_mill" || type === "ball_end_mill";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      // Redirects to the library on success, so only errors come back.
      setErrors(await saveTool(id, form));
    });
  }

  const field = fieldProps(tool, errors);
  const number = fieldProps(tool, errors, null);

  return (
    <form onSubmit={onSubmit} className="grid gap-8" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TypePicker value={type} onChange={setType} error={errors.type} />
        <Field label="Name" {...field("name")} placeholder="6 mm 2-flute upcut" />
        <Field label="Colour" {...field("color")} type="color" className="p-1" />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">Geometry</legend>
        <NumberField label="Diameter" {...number("diameter")} quantity="length" min={0} />
        <NumberField label="Flutes" {...number("fluteCount")} integer min={1} />
        <NumberField label="Flute length" {...number("fluteLength")} quantity="length" min={0} />
        {isEndMill && (
          <SelectField
            label="Cut direction"
            id="cutDirection"
            defaultValue={tool.cutDirection ?? "upcut"}
            options={CUT_DIRECTION_LABELS}
            error={errors.cutDirection}
          />
        )}
        {type === "v_bit" && (
          <>
            <NumberField label="V angle" {...number("vAngle")} suffix="°" min={0} />
            <NumberField
              label="Tip diameter"
              {...number("tipDiameter")}
              defaultValue={tool.tipDiameter ?? 0}
              quantity="length"
              min={0}
            />
          </>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-4 font-medium">Cutting data</legend>
        <NumberField
          label="Spindle speed"
          {...number("spindleRpm")}
          suffix="RPM"
          integer
          step={1000}
          min={0}
        />
        <NumberField label="Feed rate" {...number("feedRate")} quantity="feed" min={0} />
        <NumberField label="Plunge rate" {...number("plungeRate")} quantity="feed" min={0} />
        <NumberField label="Step down per pass" {...number("stepDown")} quantity="length" min={0} />
        <NumberField
          label="Step over (of diameter)"
          {...number("stepOver")}
          suffix="%"
          min={0}
          max={100}
        />
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" defaultValue={tool.notes ?? ""} />
      </div>

      <FormError message={errors.form ?? null} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add bit"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/tools">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

/** The bit types as picture cards, so the profile is visible while choosing. */
function TypePicker({
  value,
  onChange,
  error,
}: {
  value: ToolType;
  onChange: (type: ToolType) => void;
  error?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby="type-label"
      aria-describedby={error ? "type-error" : undefined}
      className="grid gap-2 sm:col-span-full"
    >
      <span id="type-label" className="text-sm leading-none font-medium">
        Type
      </span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ToolType.options.map((type) => (
          <label
            key={type}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-md border p-3 text-sm shadow-xs transition-colors hover:bg-accent has-checked:border-primary has-checked:bg-accent has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
          >
            <input
              type="radio"
              name="type"
              value={type}
              checked={value === type}
              onChange={() => onChange(type)}
              className="sr-only"
            />
            <BitTypeIcon type={type} className="h-14 w-7" />
            {TOOL_TYPE_LABELS[type]}
          </label>
        ))}
      </div>
      <FieldError id="type" error={error} />
    </div>
  );
}
