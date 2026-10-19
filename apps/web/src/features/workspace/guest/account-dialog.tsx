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
import { exportProjectFile } from "@furrow/workspace/lib/export-project";
import type { AccountReason } from "@furrow/workspace/lib/workspace-host";
import { useWorkspaceHost } from "@furrow/workspace/providers/workspace-host";
import { useDocumentStoreApi } from "@furrow/workspace/providers/workspace-stores";
import { DownloadIcon, MonitorDownIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DESKTOP_DOWNLOADS_PAGE, desktopDownload } from "./desktop-download";

/** What the dialog says each reason needs. */
export const ACCOUNT_REASONS: Record<AccountReason, { title: string; description: string }> = {
  "export-gcode": {
    title: "G-code is made for your machine",
    description:
      "Exporting G-code needs your machine's work area, feeds and G-code dialect, which are saved in a free account or the desktop app.",
  },
  machine: {
    title: "Your machine is saved in an account",
    description:
      "Machine profiles, from a preset or your own values, are saved in a free account or the desktop app, and used for every project made for them.",
  },
  "save-bit": {
    title: "Your bits are saved in an account",
    description:
      "The catalog's bits work without an account. Bits of your own, or changes to a catalog bit, are saved in a free account or the desktop app.",
  },
};

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
      setError(error instanceof Error ? error.message : "This project couldn't be exported.");
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <p>After you sign in, you can bring the projects in this browser into your account.</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/sign-up">Create a free account</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
          <p className="text-muted-foreground">
            Or use the desktop app: no account, projects saved as files on your computer.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={download?.url ?? DESKTOP_DOWNLOADS_PAGE}>
                <MonitorDownIcon />
                {download ? `Download for ${download.system}` : "Download the desktop app"}
              </a>
            </Button>
            <Button variant="outline" onClick={saveFile} disabled={exporting}>
              <DownloadIcon />
              Save this project as a file
            </Button>
          </div>
          {download && (
            <p className="text-ui text-muted-foreground">
              Other systems and Intel Macs:{" "}
              <a href={DESKTOP_DOWNLOADS_PAGE} className="underline underline-offset-2">
                all downloads
              </a>
              .
            </p>
          )}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
