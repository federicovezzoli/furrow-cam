"use client";

import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import {
  PROJECT_ARCHIVE_EXTENSION,
  PROJECT_DESKTOP_EXTENSION,
  PROJECT_FILE_EXTENSION,
  type ProjectArchive,
} from "@furrow/document";
import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { UploadIcon } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { useTranslations } from "use-intl";
import type { MeshLimits } from "@/features/assets/server";
import type { MachineOption } from "@/features/machines/server";
import { importProject } from "@/features/projects/actions";
import { importArchive, readArchive } from "@/features/projects/lib/archive-import";

// `serverActions.bodySizeLimit` in next.config.ts is 4 MiB; the file is sent as is (multipart),
// so this leaves room for the rest of the request.
const MAX_FILE_SIZE = 4_000_000;

/**
 * A picked file: a `.furrow.json` file, or a `.furrow.zip` export or desktop
 * `.furrow` project read in the browser. Versions in a `.furrow` file are
 * left out (ADR-0047).
 */
type Picked = { file: File; archive: ProjectArchive | null };

function isArchive(file: File) {
  return /\.(zip|furrow)$/i.test(file.name) || file.type === "application/zip";
}

/**
 * Whether the document `contents` has 3D models or uploaded fonts, files only
 * the asset storage keeps; anything it can't read is left to the server.
 */
function hasAssets(contents: string): boolean {
  try {
    const json: unknown = JSON.parse(contents);
    if (typeof json !== "object" || json === null) return false;
    return ["models", "fonts"].some((list) => {
      const entries = (json as Record<string, unknown>)[list];
      return Array.isArray(entries) && entries.length > 0;
    });
  } catch {
    return false;
  }
}

/**
 * Picks an exported project file (`.furrow.json`, or `.furrow.zip` for a
 * project with 3D models) or a desktop `.furrow` project and creates a
 * project from it. A file without a
 * machine gets the user's only one of `machines`, or stays without one, to be
 * chosen in the project (PRD-0008 G13). `meshLimits` are those of STL import,
 * `null` when this server can't store models.
 */
export function ImportProjectButton({
  machines,
  meshLimits,
}: {
  machines: MachineOption[];
  meshLimits: MeshLimits | null;
}) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<Translatable | null>(null);
  const [pending, startTransition] = useTransition();
  const machineId = machines.length === 1 ? (machines[0]?.id ?? null) : null;

  function upload({ file, archive }: Picked) {
    startTransition(async () => {
      try {
        // A `.furrow.json` file opens the new project on success, so only errors come back.
        // An archive without models or fonts imports as its document where they can't be stored.
        const result =
          archive && meshLimits
            ? await importArchive(archive, file.name, machineId, meshLimits)
            : await importProject(
                archive ? new File([archive.contents], file.name) : file,
                machineId,
              );
        if (result && "projectId" in result) {
          router.push(`/projects/${result.projectId}`);
          return;
        }
        setError(result?.error ?? null);
      } catch (error) {
        // The redirect to the new project rejects the call too; let Next.js handle it.
        unstable_rethrow(error);
        setError(t("importFailedConnection"));
      }
    });
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (!file) return;
    if (!isArchive(file) && file.size > MAX_FILE_SIZE) {
      setError(t("fileTooLarge"));
      return;
    }
    startTransition(async () => {
      let picked: Picked = { file, archive: null };
      if (isArchive(file)) {
        try {
          picked = { file, archive: await readArchive(file, meshLimits ?? DEFAULT_STL_LIMITS) };
        } catch (error) {
          setError(error instanceof Error ? error.message : t("fileUnreadable"));
          return;
        }
        if (!meshLimits && hasAssets(picked.archive?.contents ?? "")) {
          setError(t("noModelStorage"));
          return;
        }
      }
      upload(picked);
    });
  }

  return (
    <div className="grid gap-2">
      <FormError message={error} />
      <div>
        <input
          ref={input}
          type="file"
          accept={`${PROJECT_FILE_EXTENSION},${PROJECT_ARCHIVE_EXTENSION},${PROJECT_DESKTOP_EXTENSION},.json,.zip,application/json,application/zip`}
          onChange={onChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <Button variant="outline" onClick={() => input.current?.click()} disabled={pending}>
          <UploadIcon />
          {t("importFile")}
        </Button>
      </div>
    </div>
  );
}
