import { Input } from "@furrow/ui/components/ui/input";
import { Label } from "@furrow/ui/components/ui/label";
import type { ComponentProps, ReactNode } from "react";

/** A labelled auth input; `children` are overlaid inside it (e.g. a trailing button). */
export function FormField({
  label,
  id,
  children,
  ...props
}: ComponentProps<typeof Input> & { label: string; id: string; children?: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} name={id} required {...props} />
        {children}
      </div>
    </div>
  );
}
