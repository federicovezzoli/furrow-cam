"use client";

import { cn } from "cn";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";

export function PasswordField({
  className,
  ...props
}: Omit<ComponentProps<typeof FormField>, "type" | "ref" | "children">) {
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Hide the password again before the form submits: some password managers only
  // capture `type="password"` inputs.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const hide = () => flushSync(() => setVisible(false));
    form.addEventListener("submit", hide, { capture: true });
    return () => form.removeEventListener("submit", hide, { capture: true });
  }, []);

  return (
    <FormField
      {...props}
      ref={input}
      type={visible ? "text" : "password"}
      className={cn("pr-10", className)}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute inset-y-0 right-0 text-muted-foreground hover:bg-transparent"
        aria-label="Show password"
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </FormField>
  );
}
