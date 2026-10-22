"use client";

import { useDialogs } from "@furrow/ui/components/dialogs";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { Trash2Icon } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "use-intl";
import type { ActionResult } from "@/lib/form-data";

/** Asks `confirmText` before calling `action`, a server action bound to the item to delete. */
export function DeleteButton({
  name,
  confirmText,
  action,
}: {
  name: string;
  confirmText: string;
  action: () => Promise<ActionResult>;
}) {
  const t = useTranslations("Common");
  const format = useFormatMessage();
  const [pending, startTransition] = useTransition();
  const { alert, confirm } = useDialogs();

  async function onClick() {
    if (!(await confirm(confirmText, { destructive: true }))) return;
    startTransition(async () => {
      const result = await action();
      if (result) void alert(format(result.error));
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-label={t("deleteLabel", { name })}
      title={t("delete")}
    >
      <Trash2Icon />
    </Button>
  );
}
