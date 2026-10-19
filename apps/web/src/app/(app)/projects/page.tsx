import { Suspense } from "react";
import { meshLimits } from "@/features/assets/server";
import { requireUserId } from "@/features/auth/server";
import { listMachines, type MachineOption, snapshotMachine } from "@/features/machines/server";
import { ImportProjectButton } from "@/features/projects/components/import-project-button";
import { NewProjectForm } from "@/features/projects/components/new-project-form";
import { ProjectList } from "@/features/projects/components/project-list";
import { listProjects } from "@/features/projects/server";

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
 * Creating and importing projects, then the list. Neither needs a machine:
 * it is chosen in the project before exporting G-code (PRD-0008 G13).
 */
async function Projects() {
  const userId = await requireUserId();
  const [machines, projects] = await Promise.all([listMachines(userId), listProjects(userId)]);
  // Machines that fail today's rules can't be snapshotted until they are fixed.
  const options: MachineOption[] = machines
    .filter((row) => snapshotMachine(row) !== null)
    .map(({ id, name }) => ({ id, name }));

  return (
    <>
      <div data-tour="new-project" className="flex flex-wrap items-end justify-between gap-4">
        <NewProjectForm machines={options} />
        <ImportProjectButton machines={options} meshLimits={meshLimits()} />
      </div>
      <ProjectList projects={projects} />
    </>
  );
}
