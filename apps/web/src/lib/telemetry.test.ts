import { describe, expect, it } from "vitest";
import {
  externalOrigin,
  maskReplayAttribute,
  type PageContext,
  routePattern,
  scrubElements,
  scrubProperties,
  sentWithoutConsent,
} from "./telemetry";

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

describe("sentWithoutConsent", () => {
  it("lets through page views, errors and the workspace's events", () => {
    expect(sentWithoutConsent("$pageview")).toBe(true);
    expect(sentWithoutConsent("$exception")).toBe(true);
    expect(sentWithoutConsent("operation_added")).toBe(true);
  });

  it("holds back autocapture, replay and anything else", () => {
    for (const event of ["$autocapture", "$rageclick", "$snapshot", "$opt_in", "$pageleave"]) {
      expect(sentWithoutConsent(event)).toBe(false);
    }
  });
});

describe("scrubElements", () => {
  it("keeps an element's tag, position and our anchors, never its text or other attributes", () => {
    const properties = scrubElements({
      $event_type: "click",
      $el_text: "My secret project",
      $elements_chain: 'button:attr__data-tour="rename"nth-child="2"nth-of-type="1"',
      $element_selectors: ['[title="My secret project"]'],
      $external_click_url: "https://example.com/?q=x",
      $elements: [
        {
          tag_name: "button",
          $el_text: "Rename",
          classes: ["inline-flex"],
          nth_child: 2,
          nth_of_type: 1,
          attr__class: "inline-flex",
          attr__title: "My secret project",
          "attr__aria-label": "Rename My secret project",
          "attr__data-tour": "rename",
          attr__type: "button",
        },
        { tag_name: "a", attr__href: "/projects/abc123", attr__id: "project-link" },
        "not an element",
      ],
    });
    expect(properties).toEqual({
      $event_type: "click",
      $elements_chain: 'button:attr__data-tour="rename"nth-child="2"nth-of-type="1"',
      $elements: [
        {
          tag_name: "button",
          nth_child: 2,
          nth_of_type: 1,
          "attr__data-tour": "rename",
          attr__type: "button",
        },
        { tag_name: "a", attr__id: "project-link" },
        {},
      ],
    });
  });

  it("keeps a chain sent without its elements, built without text or ignored attributes", () => {
    const chain = 'button:attr__data-tour="export"nth-child="1"nth-of-type="1"';
    expect(scrubElements({ $elements_chain: chain })).toEqual({ $elements_chain: chain });
  });
});

describe("maskReplayAttribute", () => {
  it("masks tooltips, labels and values, which may hold the user's names", () => {
    expect(maskReplayAttribute("title", "Lid pocket")).toBe("**********");
    expect(maskReplayAttribute("aria-label", "Delete Lid")).toBe("**********");
    expect(maskReplayAttribute("value", "12")).toBe("**");
  });

  it("keeps what the layout needs", () => {
    expect(maskReplayAttribute("class", "flex gap-2")).toBe("flex gap-2");
    expect(maskReplayAttribute("data-tour", "operations")).toBe("operations");
  });
});
