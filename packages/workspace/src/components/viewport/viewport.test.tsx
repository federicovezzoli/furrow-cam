// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../../lib/memory-host";
import { useWorkspaceStore } from "../../providers/workspace-stores";
import { renderWorkspace } from "../../test-render";
import { PartingButton } from "./viewport";

type Seen = { view: string | null };

function Probe({ seen }: { seen: Seen }) {
  seen.view = useWorkspaceStore((s) => s.view);
  return null;
}

describe("PartingButton (#473)", () => {
  it("shows the parting plane in the 3D view, from the top view too", () => {
    const seen: Seen = { view: null };
    renderWorkspace(
      <>
        <PartingButton />
        <Probe seen={seen} />
      </>,
      createMemoryHost({ document: fullDocument() }),
    );
    const toggle = screen.getByRole("button", { name: "Show the parting plane" });
    expect(seen.view).toBe("top");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.title).toBe("Show the parting plane in the 3D view");

    fireEvent.click(toggle);
    expect(seen.view).toBe("orbit");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.title).toBe("Hide the parting plane");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.title).toBe("Show the parting plane");
  });

  it("is not there in a one-sided project", () => {
    renderWorkspace(<PartingButton />, createMemoryHost({ document: createProjectDocument() }));
    expect(screen.queryByRole("button", { name: "Show the parting plane" })).toBeNull();
  });
});
