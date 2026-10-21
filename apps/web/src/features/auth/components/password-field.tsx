"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { cn } from "@furrow/ui/lib/utils";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "use-intl";
import { FormField } from "./form-field";

export function PasswordField({
  className,
  ...props
}: Omit<ComponentProps<typeof FormField>, "type" | "ref" | "children">) {
  const t = useTranslations("Auth");
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
        aria-label={t("showPassword")}
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </FormField>
  );
}
