"use client";

import { createProjectDocument } from "@furrow/document";
import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import { ProjectShell } from "@furrow/workspace/components/project-shell";
import { SimulatorShell } from "@furrow/workspace/components/simulator-shell";
import { WorkspaceShell } from "@furrow/workspace/components/workspace-shell";
import { parseSettings } from "@furrow/workspace/lib/local-library";
import type {
  WorkspaceDestination,
  WorkspaceHost,
  WorkspaceLinkProps,
} from "@furrow/workspace/lib/workspace-host";
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type GuestSettings, guestHost } from "./guest-host";
import { GuestProjectList } from "./guest-project-list";
import {
  createGuestProject,
  type GuestProject,
  getGuestProject,
  listGuestProjects,
  readGuestSettings,
  readLastGuestProjectId,
  saveLastGuestProjectId,
} from "./storage";

/** What the page shows: navigation is view state, as in the desktop app (ADR-0045). */
type View =
  | { name: "loading" }
  /** Storage can't be used at all. */
  | { name: "unavailable"; error: string }
  | { name: "projects"; error: string | null }
  | { name: "project"; project: GuestProject; page: "workspace" | "simulator" };

const NavigateContext = createContext<(to: WorkspaceDestination) => void>(() => {});

/** Where a destination that needs an account goes, until the account dialog asks instead (#223). */
const ACCOUNT_DESTINATIONS: Partial<Record<WorkspaceDestination, string>> = {
  tools: "/sign-up",
  "new-machine": "/sign-up",
};

/** The workspace's links: within the guest app, or to sign-up for what needs an account. */
function GuestLink({ to, onClick, ...props }: WorkspaceLinkProps) {
  const navigate = useContext(NavigateContext);
  const href = ACCOUNT_DESTINATIONS[to];
  if (href) return <Link href={href} onClick={onClick} {...props} />;
  return (
    <a
      href={`#${to}`}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}

/** Sign in, at the end of the workspace's top bar (PRD-0008 G9). */
function SignInButton() {
  return (
    <Button size="compact" variant="outline" asChild>
      <Link href="/sign-in">Sign in</Link>
    </Button>
  );
}

const NAVIGATION: WorkspaceHost["navigation"] = { Link: GuestLink, TopBarActions: SignInButton };

const NEW_PROJECT = "Untitled project";

/**
 * The workspace for visitors without an account (PRD-0008 G1–G3, ADR-0050):
 * it opens the last project, or a new one on the first visit, and keeps
 * every project in this browser.
 */
export function GuestApp() {
  const [view, setView] = useState<View>({ name: "loading" });
  const settings = useRef<GuestSettings>({ current: parseSettings(undefined) }).current;
  const started = useRef(false);

  async function open(id: string) {
    const project = await getGuestProject(id);
    if (!project) throw new Error("This project no longer exists in this browser.");
    await saveLastGuestProjectId(project.id).catch(() => {});
    setView({ name: "project", project, page: "workspace" });
  }

  async function create(name: string) {
    const project = await createGuestProject(name, createProjectDocument());
    await saveLastGuestProjectId(project.id).catch(() => {});
    setView({ name: "project", project, page: "workspace" });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on load; `open` and `create` only set state
  useEffect(() => {
    // Once, even when React runs effects twice in development: a second run would create a second project.
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        settings.current = await readGuestSettings();
        const last = await readLastGuestProjectId();
        const projects = await listGuestProjects();
        const id = projects.some((project) => project.id === last) ? last : projects[0]?.id;
        if (id) {
          await open(id).catch((error: unknown) =>
            setView({ name: "projects", error: (error as Error).message }),
          );
        } else await create(NEW_PROJECT);
      } catch (error) {
        setView({ name: "unavailable", error: (error as Error).message });
      }
    })();
  }, []);

  const navigate = (to: WorkspaceDestination) => {
    setView((current) => {
      if (to === "projects") return { name: "projects", error: null };
      if (current.name !== "project") return current;
      if (to === "workspace" || to === "simulator") return { ...current, page: to };
      return current;
    });
  };

  const project = view.name === "project" ? view.project : null;
  const host = useMemo(
    () => (project ? guestHost(project, settings, NAVIGATION) : null),
    [project, settings],
  );

  switch (view.name) {
    case "loading":
      return <p className="m-auto text-ui text-muted-foreground">Loading project…</p>;
    case "unavailable":
      return (
        <main className="mx-auto grid w-full max-w-xl gap-4 p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Furrow CAM</h1>
          <FormError message={view.error} />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/sign-up">Create a free account</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </main>
      );
    case "projects":
      return (
        <div className="overflow-auto">
          <GuestProjectList error={view.error} onCreate={create} onOpen={open} />
        </div>
      );
    case "project":
      return (
        <NavigateContext value={navigate}>
          {host && (
            <ProjectShell host={host}>
              {view.page === "simulator" ? <SimulatorShell /> : <WorkspaceShell />}
            </ProjectShell>
          )}
        </NavigateContext>
      );
  }
}
