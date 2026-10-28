"use client";

import { Label } from "@furrow/ui/components/ui/label";
import { cn } from "@furrow/ui/lib/utils";

/** A checkbox with its label, and a hint under it if any. */
export function Checkbox({
  id,
  label,
  heading,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  /** Labels the section it heads, as `${id}-heading`, in a heavier weight. */
  heading?: boolean;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="size-3.5 accent-primary"
      />
      <Label
        id={heading ? `${id}-heading` : undefined}
        htmlFor={id}
        className={cn("text-ui", heading ? "font-medium" : "font-normal")}
      >
        {label}
      </Label>
      {hint && (
        <p id={`${id}-hint`} className="col-start-2 text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
