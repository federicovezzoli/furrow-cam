import Link from "next/link";
import { Suspense } from "react";
import { DeleteButton } from "@/components/delete-button";
import { LocalDate } from "@/components/local-date";
import { ExportButton } from "@/components/projects/export-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listProjects } from "@/lib/projects";
import { requireUserId } from "@/lib/session";
import { deleteProject } from "./actions";
import { ImportProjectButton } from "./import-project-button";
import { NewProjectForm } from "./new-project-form";
import { RenameButton } from "./rename-button";

export default function ProjectsPage() {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <NewProjectForm />
        <ImportProjectButton />
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ProjectList />
      </Suspense>
    </main>
  );
}

async function ProjectList() {
  const projects = await listProjects(await requireUserId());
  if (projects.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-muted-foreground">
        No projects yet. Create one, then import your drawings and set up the cuts.
      </p>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Name</TableHead>
            <TableHead>Last saved</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {projects.map((project) => (
            <TableRow key={project.id}>
              <TableCell className="pl-4">
                <Link href={`/projects/${project.id}`} className="font-medium hover:underline">
                  {project.name}
                </Link>
              </TableCell>
              <TableCell>
                <LocalDate date={project.updatedAt} />
              </TableCell>
              <TableCell>
                <LocalDate date={project.createdAt} />
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex justify-end gap-1">
                  <RenameButton id={project.id} name={project.name} />
                  <ExportButton id={project.id} name={project.name} />
                  <DeleteButton
                    name={project.name}
                    confirmText={`Delete "${project.name}"? This can't be undone.`}
                    action={deleteProject.bind(null, project.id)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
