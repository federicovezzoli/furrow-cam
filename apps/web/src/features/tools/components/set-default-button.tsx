"use client";

import { useDialogs } from "@furrow/ui/components/dialogs";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { StarIcon } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "use-intl";
import { setDefaultTool } from "@/features/tools/actions";

/** A filled star marks the default tool; an outlined one makes this tool the default. */
export function SetDefaultButton({
  id,
  name,
  isDefault,
}: {
  id: string;
  name: string;
  isDefault: boolean;
}) {
  const t = useTranslations("Tools");
  const format = useFormatMessage();
  const [pending, startTransition] = useTransition();
  const { alert } = useDialogs();

  if (isDefault) {
    return (
      <span className="inline-flex size-8 items-center justify-center" title={t("defaultBit")}>
        <StarIcon className="size-4 fill-current" aria-label={t("defaultBit")} />
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() =>
        startTransition(async () => {
          const result = await setDefaultTool(id);
          if (result) void alert(format(result.error));
        })
      }
      disabled={pending}
      aria-label={t("makeDefaultLabel", { name })}
      title={t("setAsDefault")}
    >
      <StarIcon className="text-muted-foreground" />
    </Button>
  );
}
