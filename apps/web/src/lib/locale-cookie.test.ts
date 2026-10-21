import { describe, expect, it } from "vitest";
import { requestLocale } from "./locale-cookie";

const request = (headers: Record<string, string>) => requestLocale(new Headers(headers));

describe("requestLocale", () => {
  it("prefers the picked language over the browser's", () => {
    expect(request({ cookie: "a=1; furrow-locale=fr", "accept-language": "it" })).toBe("fr");
  });

  it("ignores an unknown or look-alike cookie", () => {
    expect(request({ cookie: "furrow-locale=xx", "accept-language": "de" })).toBe("de");
    expect(request({ cookie: "my-furrow-locale=fr", "accept-language": "de" })).toBe("de");
  });

  it("falls back to English", () => {
    expect(request({})).toBe("en");
  });
});
