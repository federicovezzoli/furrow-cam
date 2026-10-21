import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { meshLimits } from "@/features/assets/server";
import { getSession } from "@/features/auth/server";
import { listMachineChoices } from "@/features/machines/server";
import { getProject } from "@/features/projects/server";
import { listToolChoices } from "@/features/tools/server";
import { GuestProjectShell } from "@/features/workspace/guest/guest-app";
import {
  parseLayoutCookie,
  WORKSPACE_LAYOUT_COOKIE,
} from "@/features/workspace/host/layout-cookie";
import { WebProjectShell } from "@/features/workspace/host/web-project-shell";

/**
 * Loads the project once for all its pages and keeps its stores while the
 * user moves between them (ADR-0042): from the account, or without one from
 * this browser (PRD-0008, ADR-0050).
 */
export default function ProjectLayout({ params, children }: LayoutProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<Loading className="m-auto text-ui text-muted-foreground" project />}>
      <Project params={params}>{children}</Project>
    </Suspense>
  );
}

async function Project({
  params,
  children,
}: Pick<LayoutProps<"/projects/[id]">, "params" | "children">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return <GuestProjectShell id={id}>{children}</GuestProjectShell>;
  const { user } = session;
  const userId = user.id;
  const [project, tools, machines, cookieStore] = await Promise.all([
    getProject(userId, id),
    listToolChoices(userId),
    listMachineChoices(userId),
    cookies(),
  ]);
  if (!project) notFound();

  return (
    <WebProjectShell
      project={project}
      tools={tools}
      machines={machines}
      meshLimits={meshLimits()}
      userId={userId}
      tourDone={user.workspaceTourDoneAt != null}
      layout={parseLayoutCookie(cookieStore.get(WORKSPACE_LAYOUT_COOKIE)?.value)}
    >
      {children}
    </WebProjectShell>
  );
}
