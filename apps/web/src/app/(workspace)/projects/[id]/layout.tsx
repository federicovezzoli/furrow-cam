import { notFound } from "next/navigation";
import { Suspense } from "react";
import { meshLimits } from "@/features/assets/server";
import { requireSession } from "@/features/auth/server";
import { listMachineChoices } from "@/features/machines/server";
import { getProject } from "@/features/projects/server";
import { listToolChoices } from "@/features/tools/server";
import { ProjectShell } from "@/features/workspace/components/project-shell";

/**
 * Loads the project once for all its pages and keeps its stores while the
 * user moves between them (ADR-0042).
 */
export default function ProjectLayout({ params, children }: LayoutProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<p className="m-auto text-ui text-muted-foreground">Loading project…</p>}>
      <Project params={params}>{children}</Project>
    </Suspense>
  );
}

async function Project({
  params,
  children,
}: Pick<LayoutProps<"/projects/[id]">, "params" | "children">) {
  const { id } = await params;
  const { user } = await requireSession();
  const userId = user.id;
  const [project, tools, machines] = await Promise.all([
    getProject(userId, id),
    listToolChoices(userId),
    listMachineChoices(userId),
  ]);
  if (!project) notFound();

  return (
    <ProjectShell
      project={project}
      tools={tools}
      machines={machines}
      meshLimits={meshLimits()}
      userId={userId}
      tourDone={user.workspaceTourDoneAt != null}
    >
      {children}
    </ProjectShell>
  );
}
