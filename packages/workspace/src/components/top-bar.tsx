"use client";

import { ThemeToggle } from "@furrow/ui/components/theme-toggle";
import { Button } from "@furrow/ui/components/ui/button";
import { ChevronLeftIcon, CircleHelpIcon } from "lucide-react";
import type { WorkspaceDestination } from "../lib/workspace-host";
import { useWorkspaceHost } from "../providers/workspace-host";
import type { AutosaveStatus } from "../stores/autosave";
import { SaveStatus } from "./save-status";

/**
 * The top bar of an open project's pages, with a way `back` (to all
 * projects unless given). `machineName` is `null` for a project without a
 * machine; `onTakeTour` replays the workspace tour.
 */
export function TopBar({
  saveStatus,
  machineName,
  onTakeTour,
  back = { to: "projects", label: "All projects" },
}: {
  back?: { to: WorkspaceDestination; label: string };
  saveStatus: AutosaveStatus;
  machineName: string | null;
  onTakeTour?: (from: HTMLElement) => void;
}) {
  const { project, navigation } = useWorkspaceHost();
  const { Link } = navigation;
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      <Button variant="ghost" size="icon-compact" asChild>
        <Link to={back.to} aria-label={back.label} title={back.label}>
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
        {machineName ?? "No machine set"}
      </span>
      {project.autosaves && <SaveStatus status={saveStatus} />}
      <div className="ml-auto flex items-center gap-1">
        {onTakeTour && (
          <Button
            variant="ghost"
            size="icon-compact"
            onClick={(event) => onTakeTour(event.currentTarget)}
            aria-label="Take the tour"
            title="Take the tour"
          >
            <CircleHelpIcon />
          </Button>
        )}
        <ThemeToggle size="icon-compact" />
      </div>
    </header>
  );
}
