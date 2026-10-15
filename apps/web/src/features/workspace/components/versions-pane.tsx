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
import { VERSION_LABEL_MAX } from "@/features/projects/lib/versions";
import type { VersionRow } from "@/features/projects/server";
import {
  useAutosaveApi,
  useDocumentStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import type { AutosaveStatus } from "@/features/workspace/stores/autosave";
import { rememberSavedVersion } from "@/features/workspace/stores/saved-versions";

const UNSAVED = "The project has changes that couldn't be saved. Save them first.";
const EDITING = "Finish the change you're making first.";

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

  function save() {
    run(async () => {
      const status = await autosave.settle();
      if (status.state !== "saved") return { error: notSaved(status) };
      const result = await createVersion(projectId, label, status.savedAt);
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
      // No save may start while the server replaces the document: it would conflict.
      const status = await autosave.hold();
      let result: Awaited<ReturnType<typeof restoreVersion>>;
      try {
        result =
          status.state === "saved"
            ? await restoreVersion(version.id, status.savedAt)
            : { error: notSaved(status) };
      } catch (error) {
        autosave.release();
        throw error;
      }
      if (result.error !== undefined) {
        autosave.release();
        return result;
      }
      // A restore isn't an undo step: the store starts over from the restored
      // document, replacing any change made while it ran.
      autosave.release({ document: result.document, savedAt: result.updatedAt });
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
    startTransition(async () => {
      const result = await renameVersion(version.id, newLabel);
      setError(result?.error);
      if (result) return;
      const renamed = newLabel.trim() || null;
      setVersions(
        (list) => list?.map((v) => (v.id === version.id ? { ...v, label: renamed } : v)) ?? null,
      );
    });
  }

  function remove(version: VersionRow) {
    if (!window.confirm(`Delete the version "${versionName(version)}"? This can't be undone.`))
      return;
    startTransition(async () => {
      const result = await deleteVersion(version.id);
      setError(result?.error);
      if (!result) setVersions((list) => list?.filter((v) => v.id !== version.id) ?? null);
    });
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
          maxLength={VERSION_LABEL_MAX}
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

/** Why a version can't be saved or restored now: `status` isn't `saved`. */
function notSaved(status: AutosaveStatus) {
  // Mid-gesture (a drag), autosave waits for it to end; nothing failed.
  if (status.state === "unsaved") return EDITING;
  return status.error ?? UNSAVED;
}

/** How a version is named in prompts: its label, or its date. */
function versionName(version: VersionRow) {
  return version.label ?? formatLocalDate(version.createdAt);
}
