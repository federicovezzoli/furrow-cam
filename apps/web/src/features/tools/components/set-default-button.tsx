"use client";

import { Button } from "@furrow/ui/components/ui/button";
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
  const [pending, startTransition] = useTransition();

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
          if (result) window.alert(result.error);
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
