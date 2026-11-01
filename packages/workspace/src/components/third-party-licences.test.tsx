// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FONTS } from "../lib/fonts";
import { OCCT_LICENCES } from "../lib/step";
import { renderWorkspace } from "../test-render";
import { ThirdPartyLicences } from "./third-party-licences";

describe("ThirdPartyLicences", () => {
  it("lists OpenCascade and every bundled font with each licence text shipped", () => {
    renderWorkspace(<ThirdPartyLicences />);
    expect(screen.getByText("OpenCascade (occt-import-js)")).toBeTruthy();
    expect(screen.getByText("LGPL-2.1", { exact: false })).toBeTruthy();
    for (const font of FONTS) expect(screen.getByText(font.name)).toBeTruthy();
    const shown = screen.getAllByText(/licence text$/).map((summary) => summary.textContent);
    const shipped = [...OCCT_LICENCES, ...FONTS].map(({ name }) => `${name} licence text`);
    expect(shown).toEqual(shipped);
  });
});
