"use client";

import {
  CopyPlusIcon,
  EllipsisIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { formatLocalDate, LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  createVersion,
  deleteVersion,
  getVersions,
  openVersionAsProject,
  renameVersion,
  restoreVersion,
  type VersionsResult,
} from "@/features/projects/actions";
import type { VersionRow } from "@/features/projects/server";
import {
  useAutosaveApi,
  useDocumentStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import { rememberSavedVersion } from "@/features/workspace/stores/saved-versions";

const UNSAVED = "The project has changes that couldn't be saved. Save them first.";

/**
 * The Versions pane (ADR-0028): lists the project's versions, newest first,
 * to restore, rename, delete or open as a new project, over a form that saves
 * a new one. The list is fetched when the pane opens.
 */
export function VersionsPane({ projectId }: { projectId: string }) {
  const autosave = useAutosaveApi();
  const documentStore = useDocumentStoreApi();
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    void getVersions(projectId).then((result) => {
      if (!current) return;
      if (result.error !== undefined) setError(result.error);
      else setVersions(result.versions);
    });
    return () => {
      current = false;
    };
  }, [projectId]);

  function run(action: () => Promise<VersionsResult>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      if (result.error === undefined) setVersions(result.versions);
    });
  }

  /** The `updatedAt` of the stored document once pending changes are saved, or why they aren't. */
  async function savedAt(): Promise<{ savedAt: Date; error?: never } | { error: string }> {
    const status = await autosave.settle();
    return status.state === "saved"
      ? { savedAt: status.savedAt }
      : { error: status.error ?? UNSAVED };
  }

  function save() {
    run(async () => {
      const saved = await savedAt();
      if (saved.error !== undefined) return saved;
      const result = await createVersion(projectId, label, saved.savedAt);
      if (result.error === undefined) setLabel("");
      return result;
    });
  }

  function restore(version: VersionRow) {
    if (
      !window.confirm(
        `Restore "${versionName(version)}"? It replaces the project's contents, which are kept as a version first. Undo history is cleared.`,
      )
    ) {
      return;
    }
    run(async () => {
      const saved = await savedAt();
      if (saved.error !== undefined) return saved;
      const result = await restoreVersion(version.id, saved.savedAt);
      if (result.error !== undefined) return result;
      // A restore isn't an undo step: the store starts over from the restored document.
      autosave.reset(result.document, result.updatedAt);
      documentStore.getState().load(result.document);
      rememberSavedVersion(projectId, { document: result.document, updatedAt: result.updatedAt });
      return result;
    });
  }

  function rename(version: VersionRow) {
    const newLabel = window.prompt(
      "Rename version (leave blank to show its date)",
      version.label ?? "",
    );
    if (newLabel === null || newLabel.trim() === (version.label ?? "")) return;
    run(() => renameVersion(version.id, newLabel));
  }

  function remove(version: VersionRow) {
    if (!window.confirm(`Delete the version "${versionName(version)}"? This can't be undone.`))
      return;
    run(() => deleteVersion(version.id));
  }

  function openAsProject(version: VersionRow) {
    startTransition(async () => {
      const result = await openVersionAsProject(version.id, formatLocalDate(version.createdAt));
      if (result) setError(result.error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <FormError message={error ?? null} />
        {versions === null ? (
          error === undefined && <p className="text-ui text-muted-foreground">Loading versions…</p>
        ) : versions.length === 0 ? (
          <p className="text-ui text-muted-foreground">
            No versions yet. Save one to go back to this state later.
          </p>
        ) : (
          <ul className="flex flex-col">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex items-start gap-1 rounded-md py-1 pl-1 hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1 text-ui">
                  <p className="truncate" title={version.label ?? undefined}>
                    {version.label ?? <LocalDate date={version.createdAt} />}
                  </p>
                  {version.label !== null && (
                    <p className="text-muted-foreground">
                      <LocalDate date={version.createdAt} />
                    </p>
                  )}
                  {version.error !== undefined && (
                    <p className="text-destructive">{version.error}</p>
                  )}
                </div>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      disabled={pending}
                      aria-label={`Actions for ${versionName(version)}`}
                      title="Actions"
                    >
                      <EllipsisIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={version.error !== undefined}
                      onSelect={() => restore(version)}
                    >
                      <HistoryIcon />
                      Restore…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={version.error !== undefined}
                      onSelect={() => openAsProject(version)}
                    >
                      <CopyPlusIcon />
                      Open as new project
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => rename(version)}>
                      <PencilIcon />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => remove(version)}>
                      <Trash2Icon />
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="flex shrink-0 gap-1 border-t p-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label (optional)"
          aria-label="Version label"
          maxLength={100}
          className="h-control min-w-0 flex-1 px-2 text-ui md:text-ui"
        />
        <Button type="submit" variant="outline" size="compact" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          Save version
        </Button>
      </form>
    </div>
  );
}

/** How a version is named in prompts: its label, or its date. */
function versionName(version: VersionRow) {
  return version.label ?? formatLocalDate(version.createdAt);
}
