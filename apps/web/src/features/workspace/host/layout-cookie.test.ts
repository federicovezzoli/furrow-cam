import { describe, expect, it } from "vitest";
import { parseLayoutCookie } from "./layout-cookie";

describe("parseLayoutCookie", () => {
  it("reads the columns and ignores a missing or unreadable cookie", () => {
    const layout = { columns: { sidebar: 30, viewport: 70 } };
    expect(parseLayoutCookie(JSON.stringify(layout))).toEqual(layout);
    expect(parseLayoutCookie("{")).toEqual({});
    expect(parseLayoutCookie(undefined)).toEqual({});
  });
});
