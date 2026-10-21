"use client";

import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@furrow/ui/components/ui/dialog";
import { errorText } from "@furrow/ui/lib/i18n";
import { exportProjectFile } from "@furrow/workspace/lib/export-project";
import type { AccountReason } from "@furrow/workspace/lib/workspace-host";
import { useWorkspaceHost } from "@furrow/workspace/providers/workspace-host";
import { useDocumentStoreApi } from "@furrow/workspace/providers/workspace-stores";
import { DownloadIcon, MonitorDownIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { DESKTOP_DOWNLOADS_PAGE, desktopDownload } from "./desktop-download";

/** The catalog keys of what the dialog says each reason needs. */
const ACCOUNT_REASONS = {
  "export-gcode": { title: "gcodeTitle", description: "gcodeDescription" },
  machine: { title: "machineTitle", description: "machineDescription" },
} as const satisfies Record<AccountReason, unknown>;

/**
 * Explains what needs an account when a guest tries it (PRD-0008 G6), with
 * a free account, the desktop app for their system, or the open project as
 * a file to keep. Shown while `reason` is set; inside the project's shell.
 */
export function AccountDialog({
  reason,
  onClose,
}: {
  reason: AccountReason | null;
  onClose: () => void;
}) {
  const t = useTranslations("Guest");
  const appT = useTranslations();
  const { project, meshes } = useWorkspaceHost();
  const documentStore = useDocumentStoreApi();
  // Kept while closing, so the text doesn't change as the dialog animates out.
  const [shown, setShown] = useState<AccountReason>("export-gcode");
  const [download, setDownload] = useState<ReturnType<typeof desktopDownload>>(null);
  const [error, setError] = useState<string | null>(null);
  // One export at a time: a large project's meshes take a while to read and pack.
  const [exporting, setExporting] = useState(false);
  if (reason !== null && reason !== shown) setShown(reason);

  useEffect(() => {
    // Read in the browser only, so the server render matches the first client one.
    setDownload(desktopDownload(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
  }, []);

  async function saveFile() {
    setExporting(true);
    try {
      await exportProjectFile(documentStore.getState().document, project.name, meshes.get);
      setError(null);
    } catch (error) {
      setError(errorText(appT, error, t("cantExport")));
    } finally {
      setExporting(false);
    }
  }

  const { title, description } = ACCOUNT_REASONS[shown];
  return (
    <Dialog
      open={reason !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(title)}</DialogTitle>
          <DialogDescription>{t(description)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <p>{t("afterSignIn")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/sign-up">{t("createFreeAccount")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/sign-in">{t("signIn")}</Link>
            </Button>
          </div>
          <p className="text-muted-foreground">{t("orDesktop")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={download?.url ?? DESKTOP_DOWNLOADS_PAGE}>
                <MonitorDownIcon />
                {download ? t("downloadFor", { system: download.system }) : t("downloadDesktop")}
              </a>
            </Button>
            <Button variant="outline" onClick={saveFile} disabled={exporting}>
              <DownloadIcon />
              {t("saveAsFile")}
            </Button>
          </div>
          {download && (
            <p className="text-ui text-muted-foreground">
              {t.rich("otherSystems", {
                link: (chunks) => (
                  <a href={DESKTOP_DOWNLOADS_PAGE} className="underline underline-offset-2">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          )}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("notNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
