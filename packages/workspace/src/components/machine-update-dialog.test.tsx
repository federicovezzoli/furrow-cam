// @vitest-environment jsdom
import { createProjectDocument, type Machine, type ProjectDocument } from "@furrow/document";
import { machine } from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import type { MachineChoice } from "../lib/workspace-host";
import { useDocumentStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { renderWorkspace } from "../test-render";
import { MachineUpdateDialog } from "./machine-update-dialog";
import { StockProperties } from "./stock-properties";

const edited: Machine = { ...machine, safeZ: 12, programEnd: "M30" };

function Probe({ seen }: { seen: { store: DocumentStore | null } }) {
  seen.store = useDocumentStoreApi();
  return null;
}

let projects = 0;

/** Opens a project with `fields` and the library `machines`, as a new project each time. */
function open(fields: Partial<ProjectDocument>, machines: MachineChoice[], id = `p${++projects}`) {
  const seen: { store: DocumentStore | null } = { store: null };
  const view = renderWorkspace(
    <>
      <MachineUpdateDialog machines={machines} />
      <StockProperties machines={machines} />
      <Probe seen={seen} />
    </>,
    createMemoryHost({ id, document: { ...createProjectDocument(), ...fields } }),
  );
  return { ...view, store: () => seen.store as DocumentStore };
}

describe("MachineUpdateDialog (ADR-0079)", () => {
  it("lists what changed, and Update replaces the snapshot as one undo step", () => {
    const { store } = open({ machine, machineId: "a" }, [{ id: "a", machine: edited }]);
    screen.getByRole("alertdialog", {
      name: `${machine.name} has changed since this project used it.`,
    });
    screen.getByText(/: 5 mm → 12 mm/);
    screen.getByText("Program end");
    fireEvent.click(screen.getByRole("button", { name: "Update project" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store().getState().document.machine).toEqual(edited);
    expect(store().getState().past).toHaveLength(1);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Machine" }).value).toBe("a");
  });

  it("keeps the project's copy unchanged and doesn't ask again in the session", () => {
    const machines = [{ id: "a", machine: edited }];
    const first = open({ machine, machineId: "a" }, machines, "kept");
    fireEvent.click(screen.getByRole("button", { name: "Keep project's copy" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(first.store().getState().past).toHaveLength(0);
    // The Update link still offers it.
    screen.getByRole("button", { name: "Update project" });
    first.unmount();

    open({ machine, machineId: "a" }, machines, "kept");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("doesn't ask for an unchanged or deleted machine, or no machine", () => {
    open({ machine, machineId: "a" }, [{ id: "a", machine }]).unmount();
    open({ machine, machineId: "a" }, [{ id: "b", machine: edited }]).unmount();
    open({ machine: null, machineId: null }, [{ id: "a", machine: edited }]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("links a project without an id by its machine's unique name", () => {
    open({ machine, machineId: null }, [{ id: "a", machine: edited }]);
    screen.getByRole("alertdialog");
  });
});
