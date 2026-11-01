// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FONTS } from "../lib/font-files";
import { OCCT_LICENCES, OCCT_VERSION } from "../lib/occt-licences";
import { renderWorkspace } from "../test-render";
import { ThirdPartyLicences } from "./third-party-licences";

afterEach(() => vi.unstubAllGlobals());

describe("ThirdPartyLicences", () => {
  it("lists OpenCascade and every bundled font with each licence text shipped", () => {
    renderWorkspace(<ThirdPartyLicences />);
    expect(screen.getByText("OpenCascade (occt-import-js)")).toBeTruthy();
    expect(screen.getByText("LGPL-2.1", { exact: false })).toBeTruthy();
    expect(screen.getByText(OCCT_VERSION, { exact: false })).toBeTruthy();
    for (const font of FONTS) expect(screen.getByText(font.name)).toBeTruthy();
    const shown = screen.getAllByText(/licence text$/).map((summary) => summary.textContent);
    const shipped = [...OCCT_LICENCES, ...FONTS].map(({ name }) => `${name} licence text`);
    expect(shown).toEqual(shipped);
  });

  it("reads a licence text when opened, once, and retries after a failure", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(new Response("SIL OPEN FONT LICENSE"));
    vi.stubGlobal("fetch", fetch);
    renderWorkspace(<ThirdPartyLicences />);
    const details = screen.getByText("Arvo licence text").closest("details") as HTMLDetailsElement;
    const toggle = (open: boolean) => {
      details.open = open;
      fireEvent(details, new Event("toggle"));
    };

    toggle(true);
    expect(await screen.findByText("This licence text couldn't be loaded.")).toBeTruthy();
    toggle(false);
    toggle(true);
    expect(await screen.findByText("SIL OPEN FONT LICENSE")).toBeTruthy();
    toggle(false);
    toggle(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
