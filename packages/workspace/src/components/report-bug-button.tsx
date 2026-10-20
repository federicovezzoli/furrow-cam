"use client";

import { Button } from "@furrow/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@furrow/ui/components/ui/dialog";
import { Input } from "@furrow/ui/components/ui/input";
import { Label } from "@furrow/ui/components/ui/label";
import { Textarea } from "@furrow/ui/components/ui/textarea";
import { downloadFile } from "@furrow/ui/lib/download";
import { BugIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { type Diagnostics, projectDiagnostics, reportBody, reportUrl } from "../lib/bug-report";
import { captureViewport } from "../lib/viewport-capture";
import { useWorkspaceHost } from "../providers/workspace-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../providers/workspace-stores";

/**
 * Reports a bug as a prefilled GitHub issue draft, opened in the browser
 * with the diagnostics the dialog shows first. A report too long for the
 * draft's URL is copied for the user to paste. GitHub can't receive files
 * from the app, so the viewport's screenshot stays in the dialog, which stays
 * open, for the user to copy or save into the issue.
 */
export function ReportBugButton() {
  const { app } = useWorkspaceHost();
  const documentStore = useDocumentStoreApi();
  const workspaceStore = useWorkspaceStoreApi();
  const id = useId();
  // Taken when the dialog opens, so the report describes what the user just saw.
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"opened" | "copied" | "not-copied" | null>(null);
  const [screenshot, setScreenshot] = useState<{ blob: Blob; url: string } | null>(null);
  const [screenshotCopied, setScreenshotCopied] = useState<boolean | null>(null);
  // Counts openings, so a screenshot finished after its dialog closed is dropped.
  const opening = useRef(0);

  function open() {
    const current = ++opening.current;
    setStatus(null);
    setScreenshotCopied(null);
    const viewport = captureViewport();
    viewport?.screenshot.then((blob) => {
      if (blob && opening.current === current) {
        setScreenshot({ blob, url: URL.createObjectURL(blob) });
      }
    });
    setDiagnostics([
      ["App", `${app.name} ${app.version}`],
      ["Browser", navigator.userAgent],
      ["Graphics", viewport?.renderer ?? "unknown"],
      ...projectDiagnostics(
        documentStore.getState().document,
        workspaceStore.getState().selectedOperationId,
      ),
    ]);
  }

  async function send(diagnostics: Diagnostics) {
    const body = reportBody(description, diagnostics, screenshot !== null);
    const { url, fits } = reportUrl(title.trim(), body);
    // Both start in the click: Safari blocks a window opened after an `await`.
    const copying = fits ? null : copyText(body);
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus(copying === null ? "opened" : (await copying) ? "copied" : "not-copied");
  }

  function close() {
    opening.current++;
    setDiagnostics(null);
    if (screenshot) URL.revokeObjectURL(screenshot.url);
    setScreenshot(null);
  }

  async function copyScreenshot(blob: Blob) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setScreenshotCopied(true);
    } catch {
      // No `ClipboardItem` (Firefox before 127), or the copy was refused.
      setScreenshotCopied(false);
    }
  }

  async function saveScreenshot(blob: Blob) {
    downloadFile(new Uint8Array(await blob.arrayBuffer()), "furrow-bug-report.png", blob.type);
  }

  return (
    <>
      <Button variant="ghost" size="compact" onClick={open}>
        <BugIcon />
        Report a bug
      </Button>
      <Dialog open={diagnostics !== null} onOpenChange={(isOpen) => !isOpen && close()}>
        {diagnostics && (
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Report a bug</DialogTitle>
              <DialogDescription>
                This opens a new GitHub issue with your report filled in. Nothing is sent until you
                submit it there, which needs a GitHub account.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-title`}>Title</Label>
              <Input
                id={`${id}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Pocket leaves an island uncut"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-description`}>What happened, and what did you expect?</Label>
              <Textarea
                id={`${id}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-diagnostics`}>Filled in for you</Label>
              <pre
                id={`${id}-diagnostics`}
                className="max-h-40 overflow-auto rounded-md border bg-muted p-2 text-xs whitespace-pre-wrap"
              >
                {diagnostics.map(([label, value]) => `${label}: ${value}`).join("\n")}
              </pre>
            </div>
            <section className="grid gap-2" aria-labelledby={`${id}-attach`}>
              <h3 id={`${id}-attach`} className="text-sm font-medium">
                Add these yourself on GitHub
              </h3>
              <p className="text-sm text-muted-foreground">
                GitHub can&apos;t receive files from the app. After opening the issue, paste or drop
                them into it.
              </p>
              {screenshot && (
                <figure className="grid gap-2">
                  <img
                    src={screenshot.url}
                    alt="Screenshot of the viewport"
                    className="max-h-48 w-full rounded-md border object-contain"
                  />
                  <figcaption className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="mr-auto">The viewport, not attached yet.</span>
                    <Button
                      variant="outline"
                      size="compact"
                      onClick={() => copyScreenshot(screenshot.blob)}
                    >
                      <CopyIcon />
                      {screenshotCopied ? "Copied" : "Copy screenshot"}
                    </Button>
                    <Button
                      variant="outline"
                      size="compact"
                      onClick={() => saveScreenshot(screenshot.blob)}
                    >
                      <DownloadIcon />
                      Save PNG
                    </Button>
                  </figcaption>
                  {screenshotCopied === false && (
                    <p className="text-sm text-destructive" role="alert">
                      The screenshot couldn&apos;t be copied: save it instead.
                    </p>
                  )}
                </figure>
              )}
              <p className="text-sm text-muted-foreground">
                The project, if it helps: export it from the operations pane and drop the file in.
              </p>
            </section>
            {status === "opened" && (
              <p className="text-sm" role="status">
                The issue opened in your browser. Add what you want from above, then submit it
                there.
              </p>
            )}
            {status === "copied" && (
              <p className="text-sm" role="status">
                The report was too long for the link, so it was copied: paste it into the GitHub
                issue that opened.
              </p>
            )}
            {status === "not-copied" && (
              <p className="text-sm text-destructive" role="alert">
                The report is too long for the link and couldn&apos;t be copied. Shorten it and try
                again.
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => send(diagnostics)}>Open GitHub issue</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/** Copies `text`; `false` when the browser refused or has no clipboard. */
function copyText(text: string): Promise<boolean> {
  try {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}
