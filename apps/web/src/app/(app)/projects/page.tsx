import { Suspense } from "react";
import { meshLimits } from "@/features/assets/server";
import { getUserId } from "@/features/auth/server";
import { listMachines, type MachineOption, snapshotMachine } from "@/features/machines/server";
import { ImportProjectButton } from "@/features/projects/components/import-project-button";
import { NewProjectForm } from "@/features/projects/components/new-project-form";
import { ProjectList } from "@/features/projects/components/project-list";
import { listProjects } from "@/features/projects/server";
import { GuestProjects } from "@/features/workspace/guest/guest-app";
import { GuestImportOffer } from "@/features/workspace/guest/guest-import-offer";

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
 * The offer to import projects made in this browser without an account
 * (PRD-0008 G7), creating and importing projects, then the list. Neither
 * needs a machine: it is chosen in the project before exporting G-code (G13).
 * Without an account, the projects kept in this browser instead (G3).
 */
async function Projects() {
  const userId = await getUserId();
  if (!userId) return <GuestProjects />;
  const [machines, projects] = await Promise.all([listMachines(userId), listProjects(userId)]);
  // Machines that fail today's rules can't be snapshotted until they are fixed.
  const options: MachineOption[] = machines
    .filter((row) => snapshotMachine(row) !== null)
    .map(({ id, name }) => ({ id, name }));

  return (
    <>
      <GuestImportOffer meshLimits={meshLimits()} />
      <div data-tour="new-project" className="flex flex-wrap items-end justify-between gap-4">
        <NewProjectForm machines={options} />
        <ImportProjectButton machines={options} meshLimits={meshLimits()} />
      </div>
      <ProjectList projects={projects} />
    </>
  );
}
