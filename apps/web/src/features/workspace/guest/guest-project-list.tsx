"use client";

import { useDialogs } from "@furrow/ui/components/dialogs";
import { FormError } from "@furrow/ui/components/form-error";
import { LocalDate } from "@furrow/ui/components/local-date";
import { Button } from "@furrow/ui/components/ui/button";
import { Input } from "@furrow/ui/components/ui/input";
import { Label } from "@furrow/ui/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@furrow/ui/components/ui/table";
import { exportProjectFile } from "@furrow/workspace/lib/export-project";
import { DownloadIcon, PencilIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "use-intl";
import { DeleteButton } from "@/components/delete-button";
import { Loading } from "@/components/loading";
import { DESKTOP_DOWNLOADS_PAGE } from "./desktop-download";
import { importGuestProject } from "./import-guest-project";
import {
  deleteGuestProject,
  type GuestProjectRow,
  getGuestAsset,
  getGuestProject,
  listGuestProjects,
  messageOf,
  renameGuestProject,
} from "./storage";

const ACCEPT = ".furrow,.furrow.json,.furrow.zip,.json,.zip,application/json,application/zip";

/**
 * The guest's projects, kept in this browser (PRD-0008 G3), on the projects
 * page: create, open, rename, delete, import and export.
 */
export function GuestProjectList({
  onCreate,
  onOpen,
}: {
  onCreate: (name: string) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
}) {
  const t = useTranslations("Guest");
  const projectsT = useTranslations("Projects");
  const [projects, setProjects] = useState<GuestProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { prompt } = useDialogs();
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setProjects(await listGuestProjects());
    } catch (error) {
      setError(messageOf(error));
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs `work`, showing its error instead of throwing it. */
  function run(work: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        await work();
        setError(null);
      } catch (error) {
        setError(messageOf(error));
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    run(() => onCreate(name || t("untitledProject")));
  }

  function onImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (file) run(async () => onOpen((await importGuestProject(file)).id));
  }

  async function rename(project: GuestProjectRow) {
    const name = (await prompt(projectsT("renamePrompt"), project.name))?.trim();
    if (!name || name === project.name) return;
    run(async () => {
      await renameGuestProject(project.id, name.slice(0, 100));
      await reload();
    });
  }

  function exportProject(project: GuestProjectRow) {
    run(async () => {
      const stored = await getGuestProject(project.id);
      if (!stored) throw new Error(t("projectNotFound"));
      await exportProjectFile(stored.document, stored.name, {
        meshes: { get: (sha256) => getGuestAsset(project.id, sha256) },
        fonts: { get: (sha256) => getGuestAsset(project.id, sha256, "font") },
      });
    });
  }

  return (
    <>
      <p className="max-w-2xl text-muted-foreground">
        {t.rich("intro", {
          account: (chunks) => (
            <Link href="/sign-up" className="underline underline-offset-4">
              {chunks}
            </Link>
          ),
          desktop: (chunks) => (
            <a href={DESKTOP_DOWNLOADS_PAGE} className="underline underline-offset-4">
              {chunks}
            </a>
          ),
        })}
      </p>
      <FormError message={error} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form onSubmit={onSubmit} className="grid gap-2">
          <Label htmlFor="guest-project-name">{projectsT("newProject")}</Label>
          <div className="flex max-w-xl flex-wrap gap-2">
            <Input
              id="guest-project-name"
              name="name"
              maxLength={100}
              placeholder={projectsT("namePlaceholder")}
              className="w-auto min-w-48 flex-1"
            />
            <Button type="submit" disabled={pending}>
              {projectsT("create")}
            </Button>
          </div>
        </form>
        <div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            onChange={onImport}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
          />
          <Button variant="outline" onClick={() => input.current?.click()} disabled={pending}>
            <UploadIcon />
            {projectsT("importFile")}
          </Button>
        </div>
      </div>
      {projects === null ? (
        <Loading />
      ) : projects.length === 0 ? (
        <p className="rounded-lg border p-4 text-muted-foreground">{projectsT("noProjects")}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{projectsT("name")}</TableHead>
                <TableHead>{projectsT("lastSaved")}</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">{projectsT("actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="pl-4">
                    <button
                      type="button"
                      onClick={() => run(() => onOpen(project.id))}
                      className="font-medium hover:underline"
                    >
                      {project.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <LocalDate date={project.savedAt} />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => rename(project)}
                        disabled={pending}
                        aria-label={projectsT("renameLabel", { name: project.name })}
                        title={projectsT("rename")}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => exportProject(project)}
                        disabled={pending}
                        aria-label={t("exportLabel", { name: project.name })}
                        title={t("export")}
                      >
                        <DownloadIcon />
                      </Button>
                      <DeleteButton
                        name={project.name}
                        confirmText={t("deleteConfirm", { name: project.name })}
                        action={async () => {
                          try {
                            await deleteGuestProject(project.id);
                          } catch (error) {
                            return { error: messageOf(error) };
                          }
                          await reload();
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
