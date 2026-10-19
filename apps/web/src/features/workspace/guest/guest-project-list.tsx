"use client";

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
import { DeleteButton } from "@/components/delete-button";
import { importGuestProject } from "./import-guest-project";
import {
  deleteGuestProject,
  type GuestProjectRow,
  getGuestMesh,
  getGuestProject,
  listGuestProjects,
  renameGuestProject,
} from "./storage";

const ACCEPT = ".furrow,.furrow.json,.furrow.zip,.json,.zip,application/json,application/zip";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The guest's projects, kept in this browser (PRD-0008 G3): create, open,
 * rename, delete, import and export. `error` is shown above, e.g. why the
 * last project couldn't be opened.
 */
export function GuestProjectList({
  error: initialError,
  onCreate,
  onOpen,
}: {
  error: string | null;
  onCreate: (name: string) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
}) {
  const [projects, setProjects] = useState<GuestProjectRow[] | null>(null);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();
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
    run(() => onCreate(name || "Untitled project"));
  }

  function onImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (file) run(async () => onOpen((await importGuestProject(file)).id));
  }

  function rename(project: GuestProjectRow) {
    const name = window.prompt("Rename project", project.name)?.trim();
    if (!name || name === project.name) return;
    run(async () => {
      await renameGuestProject(project.id, name.slice(0, 100));
      await reload();
    });
  }

  function exportProject(project: GuestProjectRow) {
    run(async () => {
      const stored = await getGuestProject(project.id);
      if (!stored) throw new Error("This project no longer exists in this browser.");
      await exportProjectFile(stored.document, stored.name, (sha256) =>
        getGuestMesh(project.id, sha256),
      );
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Button variant="outline" asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
      <p className="max-w-2xl text-muted-foreground">
        Your projects are kept in this browser only, until you{" "}
        <Link href="/sign-up" className="underline underline-offset-4">
          create a free account
        </Link>
        . Clearing this site's data deletes them, so export the ones you want to keep.
      </p>
      <FormError message={error} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form onSubmit={onSubmit} className="grid gap-2">
          <Label htmlFor="guest-project-name">New project</Label>
          <div className="flex max-w-xl flex-wrap gap-2">
            <Input
              id="guest-project-name"
              name="name"
              maxLength={100}
              placeholder="Walnut cutting board"
              className="w-auto min-w-48 flex-1"
            />
            <Button type="submit" disabled={pending}>
              Create
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
            Import file…
          </Button>
        </div>
      </div>
      {projects === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="rounded-lg border p-4 text-muted-foreground">
          No projects yet. Create one, then import your drawings and set up the cuts.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Last saved</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
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
                        aria-label={`Rename ${project.name}`}
                        title="Rename"
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => exportProject(project)}
                        disabled={pending}
                        aria-label={`Export ${project.name}`}
                        title="Export"
                      >
                        <DownloadIcon />
                      </Button>
                      <DeleteButton
                        name={project.name}
                        confirmText={`Delete "${project.name}" from this browser? This can't be undone.`}
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
    </main>
  );
}
