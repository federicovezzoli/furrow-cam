import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUserId } from "@/features/auth/server";
import { listMachineChoices } from "@/features/machines/server";
import { getProject } from "@/features/projects/server";
import { listToolChoices } from "@/features/tools/server";
import { WorkspaceShell } from "@/features/workspace/components/workspace-shell";
import {
  parseWorkspaceLayout,
  WORKSPACE_LAYOUT_COOKIE,
} from "@/features/workspace/lib/workspace-layout";

export default function WorkspacePage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<p className="m-auto text-ui text-muted-foreground">Loading project…</p>}>
      <Workspace params={params} />
    </Suspense>
  );
}

async function Workspace({ params }: Pick<PageProps<"/projects/[id]">, "params">) {
  const { id } = await params;
  const userId = await requireUserId();
  const [project, tools, machines] = await Promise.all([
    getProject(userId, id),
    listToolChoices(userId),
    listMachineChoices(userId),
  ]);
  if (!project) notFound();

  const layout = parseWorkspaceLayout((await cookies()).get(WORKSPACE_LAYOUT_COOKIE)?.value);

  return <WorkspaceShell project={project} tools={tools} machines={machines} layout={layout} />;
}
