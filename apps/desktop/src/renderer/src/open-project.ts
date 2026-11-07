import { type ProjectFile, readProjectFile } from "@furrow/workspace/lib/project-file";
import { t } from "./i18n";

/**
 * Opens the bytes of the file `name` as a project: reports why if they
 * aren't one, else calls `open` once `replaceWith` has closed the open
 * project. `open` is where the file is listed as recent, so a file that
 * fails to open, or isn't opened after all, isn't (#494).
 */
export async function openProjectBytes(
  bytes: Uint8Array,
  name: string,
  steps: {
    report: (message: string) => void;
    replaceWith: (next: () => void) => Promise<void>;
    open: (file: ProjectFile) => void;
  },
): Promise<void> {
  let file: ProjectFile;
  try {
    file = await readProjectFile(bytes, t);
  } catch (error) {
    const reason = error instanceof Error ? error.message : t("Desktop.App.unreadable");
    steps.report(t("Desktop.App.openFailed", { name, reason }));
    return;
  }
  await steps.replaceWith(() => steps.open(file));
}
