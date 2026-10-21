"use client";

import { createProjectDocument } from "@furrow/document";
import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import { ProjectShell } from "@furrow/workspace/components/project-shell";
import { useLeaveNavigate } from "@furrow/workspace/hooks/use-autosave";
import { track } from "@furrow/workspace/lib/telemetry";
import {
  type AccountReason,
  leavesProject,
  type WorkspaceHost,
  type WorkspaceLinkProps,
} from "@furrow/workspace/lib/workspace-host";
import { useWorkspaceHost } from "@furrow/workspace/providers/workspace-host";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Loading } from "@/components/loading";
import { clientTranslator } from "@/lib/client-translator";
import { LeaveGuard } from "../host/leave-guard";
import { webRoute } from "../host/web-project-shell";
import { AccountDialog } from "./account-dialog";
import { type GuestSettings, type GuestTools, guestHost } from "./guest-host";
import { GuestProjectList } from "./guest-project-list";
import {
  createGuestProject,
  type GuestProject,
  getGuestProject,
  listGuestProjects,
  readGuestSettings,
  readGuestTools,
  readLastGuestProjectId,
  saveLastGuestProjectId,
} from "./storage";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : clientTranslator()("Guest.somethingWrong");
}

/** Shown where the browser won't let the app keep projects at all. */
function StorageUnavailable({ error }: { error: string }) {
  const t = useTranslations("Guest");
  return (
    <main className="mx-auto grid w-full max-w-xl gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Furrow CAM</h1>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/sign-up">{t("createFreeAccount")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/sign-in">{t("signIn")}</Link>
        </Button>
      </div>
    </main>
  );
}

/**
 * `/` for visitors without an account (PRD-0008 G1): opens the project they
 * last had open, or a new one on the first visit, at the address an
 * account's project has (`/projects/<id>`). With `fresh` (`/new`, linked
 * from the website), always a new project.
 */
export function GuestEntry({ fresh = false }: { fresh?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once, even when React runs effects twice in development: a second run would create a second project.
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        let id: string | undefined;
        if (!fresh) {
          const last = await readLastGuestProjectId();
          const projects = await listGuestProjects();
          id = projects.some((project) => project.id === last)
            ? (last ?? undefined)
            : projects[0]?.id;
        }
        if (!id) {
          id = (
            await createGuestProject(
              clientTranslator()("Guest.untitledProject"),
              createProjectDocument(),
            )
          ).id;
          track({ event: "project_created" });
        }
        router.replace(webRoute("workspace", id));
      } catch (error) {
        setError(messageOf(error));
      }
    })();
  }, [router, fresh]);

  if (error) return <StorageUnavailable error={error} />;
  return <Loading className="m-auto text-ui text-muted-foreground" project />;
}

/** `/projects` without an account: the projects kept in this browser (PRD-0008 G3). */
export function GuestProjects() {
  const router = useRouter();
  return (
    <GuestProjectList
      onCreate={async (name) => {
        const project = await createGuestProject(name, createProjectDocument());
        track({ event: "project_created" });
        router.push(webRoute("workspace", project.id));
      }}
      onOpen={async (id) => router.push(webRoute("workspace", id))}
    />
  );
}

const PromptContext = createContext<(reason: AccountReason) => void>(() => {});

/** The workspace's links, to the routes an account's project has; a new machine asks for an account. */
function GuestLink({ to, onClick, ...props }: WorkspaceLinkProps) {
  const { project } = useWorkspaceHost();
  const prompt = useContext(PromptContext);
  const onNavigate = useLeaveNavigate(leavesProject(to));
  if (to === "new-machine") {
    return (
      <a
        href={webRoute(to, project.id)}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          event.preventDefault();
          prompt("machine");
        }}
      />
    );
  }
  return (
    <Link href={webRoute(to, project.id)} onClick={onClick} {...props} onNavigate={onNavigate} />
  );
}

/** Sign in, at the end of the workspace's top bar (PRD-0008 G9). */
function SignInButton() {
  const t = useTranslations("Guest");
  const onNavigate = useLeaveNavigate();
  return (
    <Button size="compact" variant="outline" asChild>
      <Link href="/sign-in" onNavigate={onNavigate}>
        {t("signIn")}
      </Link>
    </Button>
  );
}

const NAVIGATION: WorkspaceHost["navigation"] = { Link: GuestLink, TopBarActions: SignInButton };

type Loaded =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; error: string }
  | { state: "ready"; project: GuestProject; settings: GuestSettings; tools: GuestTools };

/**
 * Guest project `id` (ADR-0050), loaded from the browser, around its
 * workspace and simulator pages (`children`) at `/projects/<id>`, so its
 * stores and undo history live while the guest moves between them, as an
 * account's project does (ADR-0042).
 */
export function GuestProjectShell({ id, children }: { id: string; children: React.ReactNode }) {
  const t = useTranslations("Guest");
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [accountReason, setAccountReason] = useState<AccountReason | null>(null);
  const account = useMemo(() => ({ prompt: setAccountReason }), []);

  useEffect(() => {
    let current = true;
    setLoaded({ state: "loading" });
    (async () => {
      try {
        const [project, stored, tools] = await Promise.all([
          getGuestProject(id),
          readGuestSettings(),
          readGuestTools(),
        ]);
        if (!current) return;
        if (!project) return setLoaded({ state: "missing" });
        setLoaded({
          state: "ready",
          project,
          settings: { current: stored },
          tools: { current: tools },
        });
        await saveLastGuestProjectId(id).catch(() => {});
      } catch (error) {
        if (current) setLoaded({ state: "error", error: messageOf(error) });
      }
    })();
    return () => {
      current = false;
    };
  }, [id]);

  const host = useMemo(
    () =>
      loaded.state === "ready"
        ? guestHost(loaded.project, loaded.settings, loaded.tools, NAVIGATION, account)
        : null,
    [loaded, account],
  );

  if (loaded.state === "loading") {
    return <Loading className="m-auto text-ui text-muted-foreground" project />;
  }
  if (loaded.state === "missing" || loaded.state === "error") {
    return (
      <main className="mx-auto grid w-full max-w-xl gap-4 p-8">
        <FormError message={loaded.state === "error" ? loaded.error : t("doesntExist")} />
        <p>
          <Link href="/projects" className="underline underline-offset-4">
            {t("yourProjects")}
          </Link>
        </p>
      </main>
    );
  }
  return (
    <PromptContext value={setAccountReason}>
      {host && (
        <ProjectShell host={host}>
          <LeaveGuard path={webRoute("workspace", id)} />
          {children}
          <AccountDialog reason={accountReason} onClose={() => setAccountReason(null)} />
        </ProjectShell>
      )}
    </PromptContext>
  );
}
