// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../../lib/memory-host";
import { renderWorkspace } from "../../test-render";
import { SideButtons } from "./viewport";

describe("SideButtons: parting plane (#473)", () => {
  it("shows a toggle for the parting plane, on by default", () => {
    renderWorkspace(<SideButtons />, createMemoryHost({ document: fullDocument() }));
    const toggle = screen.getByRole("button", { name: "Show the parting plane" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.title).toBe("Hide the parting plane");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.title).toBe("Show the parting plane");
  });

  it("has no toggle in a one-sided project", () => {
    renderWorkspace(<SideButtons />, createMemoryHost({ document: createProjectDocument() }));
    expect(screen.queryByRole("button", { name: "Show the parting plane" })).toBeNull();
  });
});
