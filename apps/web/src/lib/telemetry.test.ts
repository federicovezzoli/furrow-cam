import { describe, expect, it } from "vitest";
import { externalOrigin, type PageContext, routePattern, scrubProperties } from "./telemetry";

const page: PageContext = {
  origin: "https://furrow.cam",
  pathname: "/reset-password",
  pattern: "/reset-password",
  referrer: "https://example.com",
};

describe("scrubProperties", () => {
  it("replaces every location property with the route pattern", () => {
    const properties = scrubProperties(
      "$pageview",
      {
        $current_url: "https://furrow.cam/reset-password?token=secret",
        $host: "furrow.cam",
        $pathname: "/reset-password",
        $referrer: "https://furrow.cam/projects/abc?x=1",
        $referring_domain: "furrow.cam",
        $initial_current_url: "https://furrow.cam/reset-password?token=secret",
        title: "Reset password",
        utm_source: "mail",
        $browser: "Firefox",
        $screen_width: 1440,
      },
      page,
      "/reset-password",
    );
    expect(properties).toEqual({
      $current_url: "https://furrow.cam/reset-password",
      $pathname: "/reset-password",
      $referrer: "https://example.com",
      $browser: "Firefox",
      $screen_width: 1440,
    });
  });

  it("keeps the referrer to page views, and only the origin on a page it hasn't seen", () => {
    const properties = scrubProperties(
      "file_imported",
      { format: "svg", $current_url: "https://furrow.cam/projects/abc" },
      { ...page, pathname: "/projects", pattern: "/projects" },
      "/projects/abc",
    );
    expect(properties).toEqual({ format: "svg", $current_url: "https://furrow.cam" });
  });
});

describe("routePattern", () => {
  it("names the segments that hold params", () => {
    expect(routePattern("/projects/abc123", { id: "abc123" })).toBe("/projects/[id]");
    expect(routePattern("/projects/a%20b", { id: "a b" })).toBe("/projects/[id]");
    expect(routePattern("/tools", {})).toBe("/tools");
  });
});

describe("externalOrigin", () => {
  it("keeps only other sites' origins", () => {
    expect(externalOrigin("https://example.com/page?q=1", "https://furrow.cam")).toBe(
      "https://example.com",
    );
    expect(externalOrigin("https://furrow.cam/projects/abc", "https://furrow.cam")).toBeNull();
    expect(externalOrigin("", "https://furrow.cam")).toBeNull();
  });
});
