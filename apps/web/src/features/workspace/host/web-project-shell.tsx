"use client";

import { FormError } from "@furrow/ui/components/form-error";
import { ThemeToggle } from "@furrow/ui/components/theme-toggle";
import { Button } from "@furrow/ui/components/ui/button";
import { ProjectShell } from "@furrow/workspace/components/project-shell";
import type {
  WorkspaceDestination,
  WorkspaceHost,
  WorkspaceLinkProps,
} from "@furrow/workspace/lib/workspace-host";
import { useWorkspaceHost } from "@furrow/workspace/providers/workspace-host";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useMemo } from "react";
import { cacheMesh, loadMesh } from "@/features/assets/lib/mesh-cache";
import { discardUpload, uploadMesh } from "@/features/assets/lib/meshes";
import type { MeshLimits } from "@/features/assets/server";
import type { MachineChoice } from "@/features/machines/server";
import { finishTour } from "@/features/onboarding/actions";
import {
  createVersion,
  deleteVersion,
  getVersions,
  openVersionAsProject,
  renameVersion,
  restoreVersion,
  saveProject,
} from "@/features/projects/actions";
import type { getProject } from "@/features/projects/server";
import { saveTool } from "@/features/tools/lib/save-tool";
import type { ToolChoice } from "@/features/tools/server";
import { latestVersion, rememberSavedVersion } from "./saved-versions";

type WebProject = NonNullable<Awaited<ReturnType<typeof getProject>>>;

/**
 * The open project in the web app (ADR-0045): the workspace, with a host that
 * saves through the server actions and links to the app's routes. `tools` and
 * `machines` are the user's library, `meshLimits` the STL files the server
 * stores (`null` when STL import is off), and `tourDone` says the account
 * `userId` finished the workspace tour (PRD-0001 R22).
 */
export function WebProjectShell({
  project,
  children,
  ...rest
}: {
  project: WebProject;
  tools: ToolChoice[];
  machines: MachineChoice[];
  meshLimits: MeshLimits | null;
  userId: string;
  tourDone: boolean;
  children: React.ReactNode;
}) {
  if (project.error !== undefined) {
    // Retrying can't fix a document this release can't read, so don't fall into error.tsx.
    return <UnreadableProject name={project.name} error={project.error} />;
  }
  return (
    <WebHost project={project} {...rest}>
      {children}
    </WebHost>
  );
}

function WebHost({
  project,
  tools,
  machines,
  meshLimits,
  userId,
  tourDone,
  children,
}: {
  project: Extract<WebProject, { error?: never }>;
  tools: ToolChoice[];
  machines: MachineChoice[];
  meshLimits: MeshLimits | null;
  userId: string;
  tourDone: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { id, name, document, updatedAt } = project;
  // Kept per project, so a refresh that brings the library again restarts nothing.
  const services = useMemo(
    () => ({
      meshes: {
        put: async (sha256: string, file: Blob) => {
          const upload = await uploadMesh(id, sha256, file);
          if (upload.error === undefined) await cacheMesh(sha256, file);
          return upload;
        },
        get: (sha256: string) => loadMesh(id, sha256),
        discard: (sha256: string) => discardUpload(id, sha256),
      },
      versions: {
        list: () => getVersions(id),
        create: (label: string, savedAt: Date) => createVersion(id, label, savedAt),
        rename: renameVersion,
        delete: deleteVersion,
        restore: async (versionId: string, savedAt: Date) => {
          const result = await restoreVersion(versionId, savedAt);
          if (result.error === undefined) {
            rememberSavedVersion(id, { document: result.document, updatedAt: result.updatedAt });
          }
          return result;
        },
        openAsProject: openVersionAsProject,
      },
    }),
    [id],
  );
  const host = useMemo<WorkspaceHost>(() => {
    // A newer copy saved from this tab wins over a payload the router cached before it.
    const saved = latestVersion(id, { document, updatedAt });
    return {
      project: {
        id,
        name,
        document: saved.document,
        savedAt: saved.updatedAt,
        autosaves: true,
        async save(next, savedAt) {
          const result = await saveProject(id, next, savedAt);
          if (result.error === undefined) {
            rememberSavedVersion(id, { document: next, updatedAt: result.updatedAt });
          }
          return result;
        },
      },
      ...services,
      library: {
        tools,
        machines,
        async saveTool(toolId, form) {
          const result = await saveTool(toolId, form);
          // Brings the library as the server has it, e.g. sorted or with a new default.
          if (!("errors" in result)) router.refresh();
          return result;
        },
      },
      settings: { account: userId, tourDone, finishTour },
      navigation: { Link: WebLink },
      limits: { meshes: meshLimits },
    };
  }, [
    id,
    name,
    document,
    updatedAt,
    services,
    tools,
    machines,
    router,
    userId,
    tourDone,
    meshLimits,
  ]);
  return <ProjectShell host={host}>{children}</ProjectShell>;
}

/** The web app's route for `to`, from the open project `projectId`. */
export function webRoute(to: WorkspaceDestination, projectId: string): string {
  switch (to) {
    case "projects":
      return "/projects";
    case "tools":
      return "/tools";
    case "new-machine":
      return "/machines/new";
    case "workspace":
      return `/projects/${projectId}`;
    case "simulator":
      return `/projects/${projectId}/simulate`;
  }
}

function WebLink({ to, ...props }: WorkspaceLinkProps) {
  const { project } = useWorkspaceHost();
  return <Link href={webRoute(to, project.id)} {...props} />;
}

/** A project this release can't read, with a way back to all projects. */
function UnreadableProject({ name, error }: { name: string; error: string }) {
  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon-compact" asChild>
          <Link href="/projects" aria-label="All projects" title="All projects">
            <ChevronLeftIcon />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-sm font-semibold" title={name}>
          {name}
        </h1>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle size="icon-compact" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl p-8">
        <FormError message={error} />
      </main>
    </>
  );
}
