"use client";

import { MAX_FONT_BYTES } from "@furrow/document";
import { FormError } from "@furrow/ui/components/form-error";
import { LanguagePicker } from "@furrow/ui/components/language-picker";
import { ThemeToggle } from "@furrow/ui/components/theme-toggle";
import { Button } from "@furrow/ui/components/ui/button";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { ProjectShell } from "@furrow/workspace/components/project-shell";
import { useLeaveNavigate } from "@furrow/workspace/hooks/use-autosave";
import {
  type AssetStore,
  leavesProject,
  type WorkspaceDestination,
  type WorkspaceHost,
  type WorkspaceLinkProps,
} from "@furrow/workspace/lib/workspace-host";
import type { WorkspaceLayout } from "@furrow/workspace/lib/workspace-layout";
import { useWorkspaceHost } from "@furrow/workspace/providers/workspace-host";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useMemo, useRef } from "react";
import { useTranslations } from "use-intl";
import type { AssetKind } from "@/features/assets/actions";
import { cacheAsset, loadAsset } from "@/features/assets/lib/asset-cache";
import { discardUpload, uploadAsset } from "@/features/assets/lib/assets";
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
import packageJson from "../../../../package.json";
import { writeLayoutCookie } from "./layout-cookie";
import { LeaveGuard } from "./leave-guard";
import { latestVersion, rememberSavedVersion } from "./saved-versions";

type WebProject = NonNullable<Awaited<ReturnType<typeof getProject>>>;

/**
 * The open project in the web app (ADR-0045): the workspace, with a host that
 * saves through the server actions and links to the app's routes. `tools` and
 * `machines` are the user's library, `meshLimits` the STL files the server
 * stores (`null` when STL import is off), `tourDone` says the account
 * `userId` finished the workspace tour (PRD-0001 R22), and `layout` is the
 * workspace's panel sizes from its cookie.
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
  layout: WorkspaceLayout;
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
  layout,
  children,
}: {
  project: Extract<WebProject, { error?: never }>;
  tools: ToolChoice[];
  machines: MachineChoice[];
  meshLimits: MeshLimits | null;
  userId: string;
  tourDone: boolean;
  layout: WorkspaceLayout;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { id, name, document, updatedAt } = project;
  /**
   * The panel sizes as last saved: the project's route layout outlives the
   * workspace page, which reads them again when the user comes back from the simulator.
   */
  const savedLayout = useRef(layout);
  // Kept per project, so a refresh that brings the library again restarts nothing.
  const services = useMemo(
    () => ({
      meshes: projectAssets(id, "mesh"),
      fonts: projectAssets(id, "font"),
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
      app: { name: "web", version: packageJson.version },
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
      settings: {
        account: userId,
        tourDone,
        finishTour,
        get layout() {
          return savedLayout.current;
        },
        saveLayout(next) {
          savedLayout.current = next;
          writeLayoutCookie(next);
        },
      },
      navigation: { Link: WebLink },
      // Both need the asset storage, which `meshLimits` is `null` without.
      limits: { meshes: meshLimits, fonts: meshLimits && { maxBytes: MAX_FONT_BYTES } },
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
  return (
    <ProjectShell host={host}>
      <LeaveGuard path={webRoute("workspace", id)} />
      {children}
    </ProjectShell>
  );
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
  const router = useRouter();
  const href = webRoute(to, project.id);
  const onNavigate = useLeaveNavigate(() => router.push(href), leavesProject(to));
  return <Link href={href} {...props} onNavigate={onNavigate} />;
}

/** A project this release can't read, with a way back to all projects. */
function UnreadableProject({ name, error }: { name: string; error: Translatable }) {
  const t = useTranslations("Common");
  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon-compact" asChild>
          <Link href="/projects" aria-label={t("allProjects")} title={t("allProjects")}>
            <ChevronLeftIcon />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-sm font-semibold" title={name}>
          {name}
        </h1>
        <div className="ml-auto flex items-center gap-1">
          <LanguagePicker size="icon-compact" />
          <ThemeToggle size="icon-compact" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl p-8">
        <FormError message={error} />
      </main>
    </>
  );
}

/** Project `id`'s `kind` files in the asset storage, cached in the browser (ADR-0029, ADR-0062). */
function projectAssets(id: string, kind: AssetKind): AssetStore {
  return {
    put: async (sha256, file) => {
      const upload = await uploadAsset(id, sha256, file, kind);
      if (upload.error === undefined) await cacheAsset(sha256, file);
      return upload;
    },
    get: (sha256) => loadAsset(id, sha256),
    discard: (sha256) => discardUpload(id, sha256),
  };
}
