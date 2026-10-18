import { WorkspaceShell } from "@furrow/workspace/components/workspace-shell";
import {
  parseWorkspaceLayout,
  WORKSPACE_LAYOUT_COOKIE,
} from "@furrow/workspace/lib/workspace-layout";
import { cookies } from "next/headers";
import { Suspense } from "react";

/** The project's workspace; the layout loads the project and holds its stores. */
export default function WorkspacePage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}

async function Workspace() {
  const layout = parseWorkspaceLayout((await cookies()).get(WORKSPACE_LAYOUT_COOKIE)?.value);
  return <WorkspaceShell layout={layout} />;
}
