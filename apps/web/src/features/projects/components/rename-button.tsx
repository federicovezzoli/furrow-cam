"use client";

import { useDialogs } from "@furrow/ui/components/dialogs";
import { Button } from "@furrow/ui/components/ui/button";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import { PencilIcon } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "use-intl";
import { renameProject } from "@/features/projects/actions";

/** Asks for a new name, then renames the project `id`. */
export function RenameButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("Projects");
  const format = useFormatMessage();
  const [pending, startTransition] = useTransition();
  const { alert, prompt } = useDialogs();

  async function onClick() {
    const newName = await prompt(t("renamePrompt"), name);
    if (newName === null || newName.trim() === name) return;
    startTransition(async () => {
      const result = await renameProject(id, newName);
      if (result) void alert(format(result.error));
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-label={t("renameLabel", { name })}
      title={t("rename")}
    >
      <PencilIcon />
    </Button>
  );
}
