import { LocalDate } from "@furrow/ui/components/local-date";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@furrow/ui/components/ui/table";
import Link from "next/link";
import { DeleteButton } from "@/components/delete-button";
import { deleteProject } from "@/features/projects/actions";
import type { ProjectListRow } from "@/features/projects/server";
import { getTranslator } from "@/lib/locale";
import { ExportButton } from "./export-button";
import { RenameButton } from "./rename-button";

export async function ProjectList({ projects }: { projects: ProjectListRow[] }) {
  const t = await getTranslator();
  if (projects.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-muted-foreground">{t("Projects.noProjects")}</p>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">{t("Projects.name")}</TableHead>
            <TableHead>{t("Projects.machine")}</TableHead>
            <TableHead>{t("Projects.lastSaved")}</TableHead>
            <TableHead>{t("Projects.created")}</TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">{t("Projects.actions")}</span>
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
                {project.machineName ?? (
                  <span className="text-muted-foreground">{t("Projects.none")}</span>
                )}
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
                    confirmText={t("Projects.deleteConfirm", { name: project.name })}
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
