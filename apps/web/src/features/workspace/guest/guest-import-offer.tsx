"use client";

import type { StlLimits } from "@furrow/cam-core";
import { FormError } from "@furrow/ui/components/form-error";
import { LocalDate } from "@furrow/ui/components/local-date";
import { Button } from "@furrow/ui/components/ui/button";
import { track } from "@furrow/workspace/lib/telemetry";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "use-intl";
import { type ImportToAccountResult, importToAccount } from "./import-to-account";
import {
  deleteGuestProject,
  type GuestProjectRow,
  listGuestProjects,
  readLastGuestProjectId,
} from "./storage";

/** Set for the rest of the browser session once the guest chose Not now. */
const DISMISSED = "furrow-guest-import-dismissed";

function dismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED) !== null;
  } catch {
    return false;
  }
}

/**
 * Offers to bring the projects made in this browser without an account into
 * the signed-in one (PRD-0008 G7): the user picks which, or puts it off for
 * this session, or discards them. Once imported, the project the guest last
 * had open opens (G8). `meshLimits` are the account's, `null` when this
 * server can't store 3D models. Renders nothing without guest projects.
 */
export function GuestImportOffer({ meshLimits }: { meshLimits: StlLimits | null }) {
  const t = useTranslations("Guest");
  const router = useRouter();
  const [projects, setProjects] = useState<GuestProjectRow[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<ImportToAccountResult | null>(null);
  // The imported copy of the project the guest last had open, to open from here.
  const [lastCopy, setLastCopy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (dismissed()) return;
    listGuestProjects()
      .then((rows) => {
        setProjects(rows);
        setChosen(new Set(rows.map((row) => row.id)));
      })
      // Storage this browser blocks holds no guest projects to offer.
      .catch(() => {});
  }, []);

  if (projects.length === 0) return null;
  const notes = outcome ? outcome.failed.length + outcome.changed.length : 0;

  function toggle(id: string, checked: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onImport() {
    startTransition(async () => {
      const last = await readLastGuestProjectId().catch(() => null);
      const ids = projects.filter((project) => chosen.has(project.id)).map(({ id }) => id);
      const result = await importToAccount(ids, meshLimits);
      if (result.imported.length > 0) {
        track({ event: "guest_imported", projects: result.imported.length });
      }
      const left = await listGuestProjects().catch(() => []);
      // Projects imported but changed meanwhile stay, unchecked: the account has a copy.
      const changed = new Set(result.changed.map(({ id }) => id));
      setProjects(left);
      setChosen(new Set(left.filter((row) => !changed.has(row.id)).map((row) => row.id)));
      setOutcome(result);
      setError(null);
      const opened = result.imported.find(({ id }) => id === last)?.projectId ?? null;
      setLastCopy(opened);
      // Opened at once only when there is nothing to read here first.
      if (opened && result.failed.length === 0 && result.changed.length === 0) {
        router.push(`/projects/${opened}`);
      } else router.refresh();
    });
  }

  function onNotNow() {
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      // Asked again on the next visit to the page instead.
    }
    setProjects([]);
  }

  function onDiscard() {
    const count = projects.length;
    if (!window.confirm(t("discardConfirm", { count }))) return;
    startTransition(async () => {
      try {
        for (const { id } of projects) await deleteGuestProject(id);
        setProjects([]);
      } catch (error) {
        setError(error instanceof Error ? error.message : t("cantDelete"));
      }
    });
  }

  const failures = new Map(outcome?.failed.map((failure) => [failure.id, failure.error]));
  const changed = new Set(outcome?.changed.map(({ id }) => id));
  return (
    <section
      aria-labelledby="guest-import-heading"
      className="grid gap-3 rounded-lg border bg-muted/40 p-4"
    >
      <div className="grid gap-1">
        <h2 id="guest-import-heading" className="font-semibold">
          {t("importHeading")}
        </h2>
        <p className="text-muted-foreground">{t("importIntro")}</p>
      </div>
      <ul className="grid gap-1.5">
        {projects.map((project) => (
          <li key={project.id} className="grid gap-0.5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={chosen.has(project.id)}
                onChange={(event) => toggle(project.id, event.currentTarget.checked)}
                disabled={pending}
              />
              <span className="font-medium">{project.name}</span>
              <span className="text-muted-foreground tabular-nums">
                <LocalDate date={project.savedAt} />
              </span>
            </label>
            {failures.has(project.id) && (
              <p role="alert" className="pl-6 text-destructive">
                {t("notImported", { error: failures.get(project.id) ?? "" })}
              </p>
            )}
            {changed.has(project.id) && (
              <p role="status" className="pl-6 text-muted-foreground">
                {t("changedMeanwhile")}
              </p>
            )}
          </li>
        ))}
      </ul>
      {lastCopy && notes > 0 && (
        <p>
          <Link href={`/projects/${lastCopy}`} className="underline underline-offset-4">
            {t("openLast")}
          </Link>
        </p>
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={onImport} disabled={pending || chosen.size === 0}>
          {pending ? t("importing") : t("import")}
        </Button>
        <Button variant="outline" onClick={onNotNow} disabled={pending}>
          {t("notNow")}
        </Button>
        <Button variant="ghost" onClick={onDiscard} disabled={pending}>
          {t("discard")}
        </Button>
      </div>
    </section>
  );
}
