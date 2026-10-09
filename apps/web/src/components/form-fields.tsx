import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/**
 * Props for a `Field` named after one of the form's values, e.g.
 * `const field = fieldProps(tool, errors)` then `<Field {...field("diameter")} />`.
 */
export function fieldProps<T extends object>(
  values: Partial<T>,
  errors: Partial<Record<keyof T | "form", string>>,
) {
  return <K extends keyof T & string>(name: K) => ({
    id: name,
    name,
    defaultValue: (values[name] ?? "") as string | number,
    error: errors[name],
  });
}

/** A labelled input whose error is announced via `aria-describedby`. */
export function Field({
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

export function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="text-sm text-destructive">
      {error}
    </p>
  );
}
