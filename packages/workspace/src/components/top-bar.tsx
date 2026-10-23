"use client";

import { LanguagePicker } from "@furrow/ui/components/language-picker";
import { ThemeToggle } from "@furrow/ui/components/theme-toggle";
import { Button } from "@furrow/ui/components/ui/button";
import { ChevronLeftIcon, CircleHelpIcon } from "lucide-react";
import type * as React from "react";
import { useTranslations } from "use-intl";
import type { WorkspaceDestination } from "../lib/workspace-host";
import { useWorkspaceHost } from "../providers/workspace-host";
import type { AutosaveStatus } from "../stores/autosave";
import { ReportBugButton } from "./report-bug-button";
import { SaveStatus } from "./save-status";

/**
 * The top bar of an open project's pages, with a way `back` (to all
 * projects unless given). `machineName` is `null` for a project without a
 * machine; `onTakeTour` replays the workspace tour. `children` go after the
 * save status.
 */
export function TopBar({
  saveStatus,
  machineName,
  onTakeTour,
  back,
  children,
}: {
  back?: { to: WorkspaceDestination; label: string };
  saveStatus: AutosaveStatus;
  machineName: string | null;
  onTakeTour?: (from: HTMLElement) => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations("TopBar");
  const shell = useTranslations("Shell");
  const backTo = back ?? { to: "projects", label: shell("allProjects") };
  const { project, navigation } = useWorkspaceHost();
  const { Link, TopBarActions } = navigation;
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      <Button variant="ghost" size="icon-compact" asChild>
        <Link to={backTo.to} aria-label={backTo.label} title={backTo.label}>
          <ChevronLeftIcon />
        </Link>
      </Button>
      <h1 className="min-w-0 truncate text-sm font-semibold" title={project.name}>
        {project.name}
      </h1>
      <span
        className="min-w-0 truncate text-ui text-muted-foreground"
        title={machineName ?? undefined}
      >
        {machineName ?? t("noMachine")}
      </span>
      {project.autosaves && <SaveStatus status={saveStatus} />}
      {children}
      <div className="ml-auto flex items-center gap-1">
        {onTakeTour && (
          <Button
            variant="ghost"
            size="icon-compact"
            onClick={(event) => onTakeTour(event.currentTarget)}
            aria-label={t("takeTour")}
            title={t("takeTour")}
          >
            <CircleHelpIcon />
          </Button>
        )}
        <ReportBugButton />
        <LanguagePicker size="icon-compact" />
        <ThemeToggle size="icon-compact" />
        {TopBarActions && <TopBarActions />}
      </div>
    </header>
  );
}
