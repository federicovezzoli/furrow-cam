"use client";

import { type Tool, ToolType } from "@furrow/document";
import Link from "next/link";
import { type ComponentProps, type FormEvent, useState, useTransition } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saveTool, type ToolFormErrors } from "./actions";
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

  const field = (name: keyof Tool) => ({
    id: name,
    name,
    defaultValue: tool[name] ?? "",
    error: errors[name],
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-8" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" {...field("name")} placeholder="6 mm 2-flute upcut" />
        <SelectField
          label="Type"
          id="type"
          value={type}
          onChange={(event) => setType(ToolType.parse(event.target.value))}
          options={TOOL_TYPE_LABELS}
          error={errors.type}
        />
        <Field label="Colour" {...field("color")} type="color" className="p-1" />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-4 font-medium">Geometry</legend>
        <Field label="Diameter (mm)" {...field("diameter")} type="number" step="any" min={0} />
        <Field label="Flutes" {...field("fluteCount")} type="number" step={1} min={1} />
        <Field
          label="Flute length (mm)"
          {...field("fluteLength")}
          type="number"
          step="any"
          min={0}
        />
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
            <Field label="V angle (°)" {...field("vAngle")} type="number" step="any" min={0} />
            <Field
              label="Tip diameter (mm)"
              {...field("tipDiameter")}
              defaultValue={tool.tipDiameter ?? 0}
              type="number"
              step="any"
              min={0}
            />
          </>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-4 font-medium">Cutting data</legend>
        <Field
          label="Spindle speed (RPM)"
          {...field("spindleRpm")}
          type="number"
          step={1000}
          min={0}
        />
        <Field label="Feed rate (mm/min)" {...field("feedRate")} type="number" step="any" min={0} />
        <Field
          label="Plunge rate (mm/min)"
          {...field("plungeRate")}
          type="number"
          step="any"
          min={0}
        />
        <Field
          label="Step down (mm per pass)"
          {...field("stepDown")}
          type="number"
          step="any"
          min={0}
        />
        <Field
          label="Step over (% of diameter)"
          {...field("stepOver")}
          type="number"
          step="any"
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
          {pending ? "Saving…" : id ? "Save changes" : "Add tool"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/tools">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  id,
  error,
  ...props
}: ComponentProps<typeof Input> & { label: string; id: string; error?: string }) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

function SelectField<T extends string>({
  label,
  id,
  options,
  error,
  ...props
}: ComponentProps<typeof NativeSelect> & {
  label: string;
  id: string;
  options: Record<T, string>;
  error?: string;
}) {
  return (
    <div className="grid content-start gap-2 *:data-[slot=native-select-wrapper]:w-full">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      >
        {Object.entries<string>(options).map(([value, text]) => (
          <NativeSelectOption key={value} value={value}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldError id={id} error={error} />
    </div>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="text-sm text-destructive">
      {error}
    </p>
  );
}
