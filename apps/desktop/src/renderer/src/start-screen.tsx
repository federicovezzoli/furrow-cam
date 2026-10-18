import type { Machine } from "@furrow/document";
import { FormError } from "@furrow/ui/components/form-error";
import { Button } from "@furrow/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@furrow/ui/components/ui/dialog";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import type { MachineChoice } from "@furrow/workspace/lib/workspace-host";
import { FileIcon, FolderOpenIcon, HistoryIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { RecentFile, Recovery } from "../../shared/api";
import { api } from "./api";
import type { Page } from "./desktop-host";

/**
 * The start screen (PRD-0007 D4), inside the app's navbar and footer: New
 * project, Open and the recent files, with any unsaved changes left by a
 * crash offered for restoring first (D7).
 */
export function StartScreen({
  machines,
  recoveries,
  error,
  newProject,
  onNewProject,
  onCreate,
  onOpen,
  onOpenPath,
  onRestore,
  onDiscardRecovery,
  navigate,
}: {
  machines: MachineChoice[];
  recoveries: Recovery[];
  error: string | null;
  newProject: boolean;
  onNewProject: (open: boolean) => void;
  onCreate: (machine: Machine) => void;
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  onRestore: (recovery: Recovery) => void;
  onDiscardRecovery: (recovery: Recovery) => void;
  navigate: (page: Page) => void;
}) {
  const [recent, setRecent] = useState<RecentFile[]>([]);

  useEffect(() => {
    void api.recentFiles().then(setRecent);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>

      {recoveries.length > 0 && (
        <section aria-labelledby="recover" className="grid gap-2 rounded-md border p-4">
          <h2 id="recover" className="flex items-center gap-2 font-medium">
            <HistoryIcon className="size-4" aria-hidden />
            Unsaved changes
          </h2>
          <p className="text-sm text-muted-foreground">
            Furrow CAM closed before these projects were saved.
          </p>
          <ul className="grid gap-2">
            {recoveries.map((recovery) => (
              <li key={recovery.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={recovery.path ?? undefined}>
                  {recovery.name}{" "}
                  <span className="text-muted-foreground">
                    ({new Date(recovery.savedAt).toLocaleString()})
                  </span>
                </span>
                <Button size="sm" onClick={() => onRestore(recovery)}>
                  Restore
                </Button>
                <Button size="sm" variant="outline" onClick={() => onDiscardRecovery(recovery)}>
                  Discard
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FormError message={error} />

      <div className="flex gap-2">
        <Button onClick={() => onNewProject(true)}>
          <PlusIcon />
          New project
        </Button>
        <Button variant="outline" onClick={onOpen}>
          <FolderOpenIcon />
          Open…
        </Button>
      </div>

      <section aria-labelledby="recent" className="grid gap-2">
        <h2 id="recent" className="text-sm font-medium text-muted-foreground">
          Recent
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Projects you open or save appear here.</p>
        ) : (
          <ul className="grid">
            {recent.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onOpenPath(file.path)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  title={file.path}
                >
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{file.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {file.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewProjectDialog
        open={newProject}
        machines={machines}
        onClose={() => onNewProject(false)}
        onCreate={onCreate}
        onAddMachine={() => {
          onNewProject(false);
          navigate({ name: "machine", id: null });
        }}
      />
    </main>
  );
}

/** Asks which of `machines` a new project is for; a machine is needed to export G-code. */
function NewProjectDialog({
  open,
  machines,
  onClose,
  onCreate,
  onAddMachine,
}: {
  open: boolean;
  machines: MachineChoice[];
  onClose: () => void;
  onCreate: (machine: Machine) => void;
  onAddMachine: () => void;
}) {
  const [machineId, setMachineId] = useState("");
  const chosen = machines.find((choice) => choice.id === machineId) ?? machines[0];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chosen) onCreate(chosen.machine);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Choose the machine this project is for.</DialogDescription>
        </DialogHeader>
        {machines.length === 0 ? (
          <>
            <p className="text-sm">Add your machine first: its size and G-code come from it.</p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={onAddMachine}>Add a machine</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="machine">Machine</Label>
              <NativeSelect
                id="machine"
                value={chosen?.id ?? ""}
                onChange={(event) => setMachineId(event.target.value)}
              >
                {machines.map((choice) => (
                  <NativeSelectOption key={choice.id} value={choice.id}>
                    {choice.machine.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
