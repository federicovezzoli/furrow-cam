import { describe, expect, it } from "vitest";
import { parseLayoutCookie } from "./layout-cookie";

describe("parseLayoutCookie", () => {
  it("reads both groups and ignores a missing or unreadable cookie", () => {
    const layout = {
      columns: { sidebar: 30, viewport: 70 },
      sidebar: { operations: 40, properties: 60 },
    };
    expect(parseLayoutCookie(JSON.stringify(layout))).toEqual(layout);
    expect(parseLayoutCookie("{")).toEqual({});
    expect(parseLayoutCookie(undefined)).toEqual({});
  });
});
