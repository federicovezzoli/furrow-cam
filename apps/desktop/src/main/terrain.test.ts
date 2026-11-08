import { describe, expect, it } from "vitest";
import { isTerrainRequest } from "./terrain";

describe("isTerrainRequest", () => {
  it.each([
    "https://tiles.openfreemap.org/styles/liberty",
    "https://tiles.mapterhorn.com/12/2154/1460.webp",
    "https://photon.komoot.io/api?q=Grignetta&limit=5",
  ])("lets through GET %s", (url) => {
    expect(isTerrainRequest(url, "GET")).toBe(true);
  });

  it.each([
    ["https://tiles.mapterhorn.com/12/1/1.webp", "POST"],
    ["http://tiles.mapterhorn.com/12/1/1.webp", "GET"],
    ["https://tiles.mapterhorn.com:8443/12/1/1.webp", "GET"],
    ["https://evil.tiles.mapterhorn.com/x", "GET"],
    ["https://tiles.mapterhorn.com.evil.com/x", "GET"],
    ["https://example.com/?u=https://photon.komoot.io/api", "GET"],
    ["wss://photon.komoot.io/api", "GET"],
    ["not a url", "GET"],
  ])("refuses %s (%s)", (url, method) => {
    expect(isTerrainRequest(url, method)).toBe(false);
  });
});
