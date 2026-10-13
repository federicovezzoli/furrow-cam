import Link from "next/link";
import { Suspense } from "react";
import { DeleteButton } from "@/components/delete-button";
import { LocalDate } from "@/components/local-date";
import { ExportButton } from "@/components/projects/export-button";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listMachineChoices, type MachineOption } from "@/lib/machines";
import { listProjects, type ProjectListRow } from "@/lib/projects";
import { requireUserId } from "@/lib/session";
import { deleteProject } from "./actions";
import { ImportProjectButton } from "./import-project-button";
import { NewProjectForm } from "./new-project-form";
import { RenameButton } from "./rename-button";

export default function ProjectsPage() {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Projects />
      </Suspense>
    </main>
  );
}

/**
 * Creating and importing projects, then the list. A project is set up for a
 * machine (PRD-0001 R19), so without one the user is sent to add it first.
 */
async function Projects() {
  const userId = await requireUserId();
  const [machines, projects] = await Promise.all([
    listMachineChoices(userId),
    listProjects(userId),
  ]);
  const options: MachineOption[] = machines.map(({ id, machine }) => ({ id, name: machine.name }));

  return (
    <>
      {options.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
          <p className="text-muted-foreground">
            Projects are set up for a machine. Describe your router once, then create or import
            projects for it.
          </p>
          <Button asChild>
            <Link href="/machines/new">Add a machine first</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <NewProjectForm machines={options} />
          <ImportProjectButton machines={options} />
        </div>
      )}
      <ProjectList projects={projects} />
    </>
  );
}

function ProjectList({ projects }: { projects: ProjectListRow[] }) {
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
            <TableHead>Machine</TableHead>
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
                {project.machineName ?? <span className="text-muted-foreground">None</span>}
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
