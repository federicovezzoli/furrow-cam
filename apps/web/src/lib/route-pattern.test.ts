import { describe, expect, it } from "vitest";
import { routePattern } from "./route-pattern";

describe("routePattern", () => {
  it("leaves static routes unchanged", () => {
    expect(routePattern("/", {})).toBe("/");
    expect(routePattern("/projects", {})).toBe("/projects");
    expect(routePattern("/tools/new", {})).toBe("/tools/new");
  });

  it("replaces a dynamic segment with the param name", () => {
    expect(routePattern("/projects/cmg1abc", { id: "cmg1abc" })).toBe("/projects/[id]");
    expect(routePattern("/machines/42", { id: "42" })).toBe("/machines/[id]");
  });

  it("matches percent-encoded segments against decoded and encoded values", () => {
    expect(routePattern("/tools/a%20b", { id: "a b" })).toBe("/tools/[id]");
    expect(routePattern("/tools/a%20b", { id: "a%20b" })).toBe("/tools/[id]");
  });

  it("collapses catch-all values into one placeholder", () => {
    expect(routePattern("/docs/a/b/c", { slug: ["a", "b", "c"] })).toBe("/docs/[...slug]");
  });

  it("ignores missing and empty params", () => {
    expect(routePattern("/docs", { slug: undefined })).toBe("/docs");
    expect(routePattern("/docs", { slug: [] })).toBe("/docs");
  });

  it("does not replace a static segment that precedes an equal param value", () => {
    expect(routePattern("/projects/projects", { id: "projects" })).toBe("/projects/[id]");
  });

  it("names several params with equal values by route order", () => {
    expect(routePattern("/a/x/b/x", { first: "x", second: "x" })).toBe("/a/[first]/b/[second]");
  });
});
