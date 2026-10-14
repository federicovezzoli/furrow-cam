import Link from "next/link";
import { DeleteButton } from "@/components/delete-button";
import { LocalDate } from "@/components/local-date";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteProject } from "@/features/projects/actions";
import type { ProjectListRow } from "@/features/projects/server";
import { ExportButton } from "./export-button";
import { RenameButton } from "./rename-button";

export function ProjectList({ projects }: { projects: ProjectListRow[] }) {
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
