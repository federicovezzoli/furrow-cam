import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProject } from "@/lib/projects";
import { requireUserId } from "@/lib/session";
import { WorkspaceShell } from "./workspace-shell";

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
  const project = await getProject(userId, id);
  if (!project) notFound();

  return <WorkspaceShell project={project} />;
}
