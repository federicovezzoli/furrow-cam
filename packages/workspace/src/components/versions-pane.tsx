"use client";

import { FormError } from "@furrow/ui/components/form-error";
import { formatLocalDate, LocalDate } from "@furrow/ui/components/local-date";
import { Button } from "@furrow/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@furrow/ui/components/ui/dropdown-menu";
import { Input } from "@furrow/ui/components/ui/input";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import {
  CopyPlusIcon,
  EllipsisIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "use-intl";
import { VERSION_LABEL_MAX } from "../lib/versions";
import type {
  RestoreResult,
  VersionRow,
  VersionsResult,
  WorkspaceHost,
} from "../lib/workspace-host";
import { useWorkspaceHost } from "../providers/workspace-host";
import { useAutosaveApi, useDocumentStoreApi } from "../providers/workspace-stores";
import type { AutosaveStatus } from "../stores/autosave";

/**
 * The Versions pane (ADR-0028): lists the project's versions, newest first,
 * to restore, rename, delete or open as a new project, over a form that saves
 * a new one. The list is fetched when the pane opens. Says so where the
 * workspace host keeps no versions.
 */
export function VersionsPane() {
  const { versions } = useWorkspaceHost();
  const t = useTranslations("Versions");
  if (!versions) {
    return <p className="p-2 text-ui text-muted-foreground">{t("unavailable")}</p>;
  }
  return <Versions host={versions} />;
}

function Versions({ host }: { host: NonNullable<WorkspaceHost["versions"]> }) {
  const t = useTranslations("Versions");
  const locale = useLocale();
  const autosave = useAutosaveApi();
  const documentStore = useDocumentStoreApi();
  /** Why a version can't be saved or restored now: `status` isn't `saved`. */
  const format = useFormatMessage();
  const notSaved = (status: AutosaveStatus) =>
    // Mid-gesture (a drag), autosave waits for it to end; nothing failed.
    status.state === "unsaved"
      ? t("editing")
      : status.error === undefined
        ? t("unsaved")
        : format(status.error);
  /** How a version is named in prompts: its label, or its date. */
  const versionName = (version: VersionRow) =>
    version.label ?? formatLocalDate(version.createdAt, locale);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    void host.list().then((result) => {
      if (!current) return;
      if (result.error !== undefined) setError(result.error);
      else setVersions(result.versions);
    });
    return () => {
      current = false;
    };
  }, [host]);

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
      const result = await host.create(label, status.savedAt);
      if (result.error === undefined) setLabel("");
      return result;
    });
  }

  function restore(version: VersionRow) {
    if (!window.confirm(t("restoreConfirm", { name: versionName(version) }))) {
      return;
    }
    run(async () => {
      // No save may start while the host replaces the document: it would conflict.
      const status = await autosave.hold();
      let result: RestoreResult;
      try {
        result =
          status.state === "saved"
            ? await host.restore(version.id, status.savedAt)
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
      return result;
    });
  }

  function rename(version: VersionRow) {
    const newLabel = window.prompt(t("renamePrompt"), version.label ?? "");
    if (newLabel === null || newLabel.trim() === (version.label ?? "")) return;
    startTransition(async () => {
      const result = await host.rename(version.id, newLabel);
      setError(result?.error);
      if (result) return;
      const renamed = newLabel.trim() || null;
      setVersions(
        (list) => list?.map((v) => (v.id === version.id ? { ...v, label: renamed } : v)) ?? null,
      );
    });
  }

  function remove(version: VersionRow) {
    if (!window.confirm(t("deleteConfirm", { name: versionName(version) }))) return;
    startTransition(async () => {
      const result = await host.delete(version.id);
      setError(result?.error);
      if (!result) setVersions((list) => list?.filter((v) => v.id !== version.id) ?? null);
    });
  }

  function openAsProject(version: VersionRow) {
    startTransition(async () => {
      const result = await host.openAsProject(version.id, versionName(version));
      if (result) setError(result.error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <FormError message={error ?? null} />
        {versions === null ? (
          error === undefined && <p className="text-ui text-muted-foreground">{t("loading")}</p>
        ) : versions.length === 0 ? (
          <p className="text-ui text-muted-foreground">{t("empty")}</p>
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
                      aria-label={t("actionsLabel", { name: versionName(version) })}
                      title={t("actions")}
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
                      {t("restore")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={version.error !== undefined}
                      onSelect={() => openAsProject(version)}
                    >
                      <CopyPlusIcon />
                      {t("openAsProject")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => rename(version)}>
                      <PencilIcon />
                      {t("rename")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => remove(version)}>
                      <Trash2Icon />
                      {t("delete")}
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
          placeholder={t("labelPlaceholder")}
          aria-label={t("labelLabel")}
          maxLength={VERSION_LABEL_MAX}
          className="h-control min-w-0 flex-1 px-2 text-ui md:text-ui"
        />
        <Button type="submit" variant="outline" size="compact" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {t("save")}
        </Button>
      </form>
    </div>
  );
}
