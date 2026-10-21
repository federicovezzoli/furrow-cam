"use client";

import type { ComponentProps } from "react";
import { useFormatMessage } from "../hooks/use-format-message";
import type { Translatable } from "../lib/i18n";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

type FieldErrors<T> = Partial<Record<keyof T | "form", Translatable>>;

/**
 * Props for a field named after one of the form's values, e.g.
 * `const field = fieldProps(tool, errors)` then `<Field {...field("name")} />`.
 * Pass `null` as `blank` for a `NumberField`, which starts empty on `null`:
 * `const number = fieldProps(tool, errors, null)` then `<NumberField {...number("diameter")} />`.
 */
export function fieldProps<T extends object>(
  values: Partial<T>,
  errors: FieldErrors<T>,
): <K extends keyof T & string>(name: K) => FieldProps<K, string | number>;
export function fieldProps<T extends object>(
  values: Partial<T>,
  errors: FieldErrors<T>,
  blank: null,
): <K extends keyof T & string>(name: K) => FieldProps<K, number | null>;
export function fieldProps<T extends object>(
  values: Partial<T>,
  errors: FieldErrors<T>,
  blank: "" | null = "",
) {
  return <K extends keyof T & string>(name: K) => ({
    id: name,
    name,
    defaultValue: values[name] ?? blank,
    error: errors[name],
  });
}

type FieldProps<K extends string, V> = { id: K; name: K; defaultValue: V; error?: Translatable };

/** A labelled input whose error is announced via `aria-describedby`. */
export function Field({
  label,
  id,
  error,
  ...props
}: ComponentProps<typeof Input> & { label: string; id: string; error?: Translatable }) {
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

/** A labelled native select with one option per `options` entry. */
export function SelectField<T extends string>({
  label,
  id,
  options,
  error,
  ...props
}: ComponentProps<typeof NativeSelect> & {
  label: string;
  id: string;
  options: Record<T, string>;
  error?: Translatable;
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

export function FieldError({ id, error }: { id: string; error?: Translatable }) {
  const format = useFormatMessage();
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="text-sm text-destructive">
      {format(error)}
    </p>
  );
}
