import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProject } from "@/lib/projects";
import { requireUserId } from "@/lib/session";
import { parseWorkspaceLayout, WORKSPACE_LAYOUT_COOKIE } from "@/lib/workspace-layout";
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

  const layout = parseWorkspaceLayout((await cookies()).get(WORKSPACE_LAYOUT_COOKIE)?.value);

  return <WorkspaceShell project={project} layout={layout} />;
}
