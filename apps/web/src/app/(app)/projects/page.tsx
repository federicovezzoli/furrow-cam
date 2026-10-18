import { Button } from "@furrow/ui/components/ui/button";
import Link from "next/link";
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
 * Creating and importing projects, then the list. A project is set up for a
 * machine (PRD-0001 R19), so without one the user is sent to add it first.
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
      {options.length === 0 ? (
        <div
          data-tour="new-project"
          className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
        >
          <p className="text-muted-foreground">
            {machines.length === 0
              ? "Projects are set up for a machine. Pick your router from the presets, or describe it once, then create or import projects for it."
              : "Projects are set up for a machine, and your machines' settings need fixing before they can be used."}
          </p>
          <Button asChild>
            {machines.length === 0 ? (
              <Link href="/machines/new">Add your machine</Link>
            ) : (
              <Link href="/machines">Fix your machines</Link>
            )}
          </Button>
        </div>
      ) : (
        <div data-tour="new-project" className="flex flex-wrap items-end justify-between gap-4">
          <NewProjectForm machines={options} />
          <ImportProjectButton machines={options} meshLimits={meshLimits()} />
        </div>
      )}
      <ProjectList projects={projects} />
    </>
  );
}
