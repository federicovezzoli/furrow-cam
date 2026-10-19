import type { Tool } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import {
  deleteMachine,
  deleteTool,
  messageOf,
  saveMachine,
  saveTool,
  setDefaultTool,
} from "@furrow/workspace/lib/local-library";
import type { MachineChoice } from "@furrow/workspace/lib/workspace-host";
import { MachineForm } from "@furrow/workspace/machines/components/machine-form";
import { NewMachine } from "@furrow/workspace/machines/components/new-machine";
import { POST_PROCESSOR_LABELS } from "@furrow/workspace/machines/lib/labels";
import { BitTypeIcon } from "@furrow/workspace/tools/components/bit-type-icon";
import { ToolDialog } from "@furrow/workspace/tools/components/tool-dialog";
import { ToolForm } from "@furrow/workspace/tools/components/tool-form";
import { nextToolColor } from "@furrow/workspace/tools/lib/colors";
import { TOOL_TYPE_LABELS } from "@furrow/workspace/tools/lib/labels";
import { ChevronLeftIcon, PencilIcon, StarIcon, Trash2Icon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import type { LibraryState } from "./app";
import type { Page } from "./desktop-host";

/** Says why a library change failed; the library stays as it was. */
function alertFailure(error: unknown) {
  window.alert(messageOf(error));
}

type LibraryProps = {
  library: LibraryState;
  updateLibrary: (change: (state: LibraryState) => LibraryState) => Promise<void>;
  navigate: (page: Page) => void;
};

/**
 * The bits library and the machines (PRD-0007 D9), kept on this computer.
 * With a project open, `back` returns to it.
 */
export function LibraryPage({ page, back, ...props }: LibraryProps & { page: Page; back: Page }) {
  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-8">
      {back.name === "workspace" && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          onClick={() => props.navigate(back)}
        >
          <ChevronLeftIcon />
          Back to the project
        </Button>
      )}
      {page.name === "tools" && <Tools {...props} />}
      {page.name === "machines" && <Machines {...props} />}
      {page.name === "machine" && <MachinePage id={page.id} {...props} />}
    </main>
  );
}

function Header({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}

function Tools({ library, updateLibrary }: LibraryProps) {
  const { tools } = library;
  /** The bit in the dialog: `id` `null` for a new one. */
  const [editing, setEditing] = useState<{ id: string | null; values: Partial<Tool> } | null>(null);

  return (
    <>
      <Header
        title="Bits library"
        action={
          <Button
            onClick={() =>
              setEditing({ id: null, values: { color: nextToolColor(tools.map((c) => c.tool)) } })
            }
          >
            New bit
          </Button>
        }
      />
      {tools.length === 0 ? (
        <p className="text-muted-foreground">No bits yet. Add the bits you cut with.</p>
      ) : (
        <ul className="grid divide-y rounded-md border">
          {tools.map(({ id, isDefault, tool }) => (
            <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <BitTypeIcon type={tool.type} className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{tool.name}</span>
                <span className="text-muted-foreground">
                  {TOOL_TYPE_LABELS[tool.type]}, ⌀ {tool.diameter} mm
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-pressed={isDefault}
                aria-label={isDefault ? "Default bit" : `Make ${tool.name} the default bit`}
                title={isDefault ? "Default bit for new operations" : "Make default"}
                onClick={() =>
                  updateLibrary((state) => ({
                    ...state,
                    tools: setDefaultTool(state.tools, id),
                  })).catch(alertFailure)
                }
              >
                <StarIcon className={isDefault ? "fill-current" : undefined} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${tool.name}`}
                title="Edit"
                onClick={() => setEditing({ id, values: tool })}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${tool.name}`}
                title="Delete"
                onClick={() => {
                  if (!window.confirm(`Delete the bit "${tool.name}"? Projects keep their copy.`))
                    return;
                  updateLibrary((state) => ({
                    ...state,
                    tools: deleteTool(state.tools, id),
                  })).catch(alertFailure);
                }}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ToolDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit bit" : "New bit"}
        description="Projects keep their own copy of a bit; editing it here changes new operations."
      >
        {editing && (
          <ToolForm
            id={editing.id}
            values={editing.values}
            save={async (id, form) => {
              const result = saveTool(library.tools, id, form);
              if ("errors" in result) return result;
              try {
                await updateLibrary((state) => ({ ...state, tools: result.tools }));
              } catch (error) {
                return { errors: { form: messageOf(error) } };
              }
              return result.saved;
            }}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </ToolDialog>
    </>
  );
}

function Machines({ library, updateLibrary, navigate }: LibraryProps) {
  const { machines } = library;
  return (
    <>
      <Header
        title="Machines"
        action={
          <Button onClick={() => navigate({ name: "machine", id: null })}>New machine</Button>
        }
      />
      {machines.length === 0 ? (
        <p className="text-muted-foreground">No machines yet. Add the machine you cut on.</p>
      ) : (
        <ul className="grid divide-y rounded-md border">
          {machines.map(({ id, machine }) => (
            <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{machine.name}</span>
                <span className="text-muted-foreground">
                  {machine.workAreaX} × {machine.workAreaY} × {machine.workAreaZ} mm,{" "}
                  {POST_PROCESSOR_LABELS[machine.postProcessor]}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${machine.name}`}
                title="Edit"
                onClick={() => navigate({ name: "machine", id })}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${machine.name}`}
                title="Delete"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete the machine "${machine.name}"? Projects keep their copy.`,
                    )
                  )
                    return;
                  updateLibrary((state) => ({
                    ...state,
                    machines: deleteMachine(state.machines, id),
                  })).catch(alertFailure);
                }}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A new machine, from a preset or from scratch, or the machine `id`'s form. */
function MachinePage({
  id,
  library,
  updateLibrary,
  navigate,
}: LibraryProps & { id: string | null }) {
  const toList = () => navigate({ name: "machines" });
  const save = async (machineId: string | null, form: FormData) => {
    const result = saveMachine(library.machines, machineId, form);
    if ("errors" in result) return result.errors;
    try {
      await updateLibrary((state) => ({ ...state, machines: result.machines }));
    } catch (error) {
      return { form: messageOf(error) };
    }
    toList();
    return {};
  };
  const cancel = (
    <button type="button" onClick={toList}>
      Cancel
    </button>
  );
  if (id === null) {
    return (
      <>
        <Header title="New machine" />
        <NewMachine save={save} cancel={cancel} />
      </>
    );
  }
  const choice: MachineChoice | undefined = library.machines.find((m) => m.id === id);
  if (!choice) return <p className="text-muted-foreground">This machine no longer exists.</p>;
  return (
    <>
      <Header title={choice.machine.name} />
      <MachineForm id={id} values={choice.machine} save={save} cancel={cancel} />
    </>
  );
}
