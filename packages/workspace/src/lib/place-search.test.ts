import { afterEach, describe, expect, it, vi } from "vitest";
import { fileNameFor, parsePlace, SearchUnavailableError, searchPlaces } from "./place-search";

const at = (lat: number, lon: number, zoom = 12) => ({ center: [lon, lat], zoom });

describe("parsePlace", () => {
  it.each([
    ["45.9219, 9.3907", at(45.9219, 9.3907)],
    ["45.9219 9.3907", at(45.9219, 9.3907)],
    ["-33.86;151.21", at(-33.86, 151.21)],
    [`45°55'19"N 9°23'27"E`, at(45 + 55 / 60 + 19 / 3600, 9 + 23 / 60 + 27 / 3600)],
    ["46°12'N, 9°30'E", at(46.2, 9.5)],
    ["9°30′E 46°12′N", at(46.2, 9.5)],
    ["33°52'S 151°13'E", at(-(33 + 52 / 60), 151 + 13 / 60)],
  ])("reads coordinates %s", (text, view) => {
    const parsed = parsePlace(text) as { center: [number, number]; zoom: number };
    expect(parsed.zoom).toBe(view.zoom);
    expect(parsed.center[0]).toBeCloseTo(view.center[0] as number, 6);
    expect(parsed.center[1]).toBeCloseTo(view.center[1] as number, 6);
  });

  it.each([
    [
      "https://www.google.com/maps/place/Grignetta/@45.9219,9.3907,14z/data=!3m1",
      at(45.9219, 9.3907, 14),
    ],
    ["https://www.google.it/maps/@45.9219,9.3907,15.5z", at(45.9219, 9.3907, 15.5)],
    ["https://maps.google.com/?q=45.9219,9.3907", at(45.9219, 9.3907)],
    ["google.com/maps?q=45.9219, 9.3907", at(45.9219, 9.3907)],
    ["https://www.openstreetmap.org/#map=13/45.9219/9.3907", at(45.9219, 9.3907, 13)],
    [
      "https://www.openstreetmap.org/?mlat=45.9219&mlon=9.3907#map=15/45.9/9.4",
      at(45.9219, 9.3907, 15),
    ],
  ])("reads the map link %s", (link, view) => {
    expect(parsePlace(link)).toEqual(view);
  });

  it("recognises short links, which hold no coordinates", () => {
    expect(parsePlace("https://maps.app.goo.gl/AbCdEf123")).toBe("shortLink");
    expect(parsePlace("goo.gl/maps/AbCdEf")).toBe("shortLink");
  });

  it.each([
    "Grignetta",
    "Monte Rosa 4634",
    "95, 10",
    "45.9, 200",
    "https://example.com/@45.9,9.3,14z",
  ])("leaves %s to the search", (text) => {
    expect(parsePlace(text)).toBeNull();
  });
});

describe("searchPlaces", () => {
  afterEach(() => vi.unstubAllGlobals());

  function answer(response: Response | Error) {
    const fetch = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("asks for 5 places, in the interface language only where Photon has it", async () => {
    const fetch = answer(Response.json({ features: [] }));
    await searchPlaces("Grignetta", "de");
    await searchPlaces("Grignetta", "it");
    const [german, italian] = fetch.mock.calls.map(
      (call) => new URL(String((call as unknown[])[0])),
    );
    expect(german?.searchParams.get("lang")).toBe("de");
    expect(german?.searchParams.get("limit")).toBe("5");
    expect(italian?.searchParams.has("lang")).toBe(false);
  });

  it("names and places the results, framing an extent when there is one", async () => {
    answer(
      Response.json({
        features: [
          {
            geometry: { coordinates: [9.39, 45.92] },
            properties: {
              name: "Grigna Meridionale",
              city: "Mandello del Lario",
              country: "Italy",
            },
          },
          {
            geometry: { coordinates: [9.1, 45.8] },
            properties: { name: "Lecco", country: "Italy", extent: [9.3, 45.9, 9.5, 45.8] },
          },
          { geometry: { coordinates: [1, 2] }, properties: {} },
        ],
      }),
    );
    expect(await searchPlaces("Gri", "en")).toEqual([
      {
        name: "Grigna Meridionale",
        label: "Mandello del Lario, Italy",
        view: { center: [9.39, 45.92], zoom: 12 },
      },
      {
        name: "Lecco",
        label: "Italy",
        view: {
          bounds: [
            [9.3, 45.8],
            [9.5, 45.9],
          ],
        },
      },
    ]);
  });

  it.each([
    new Response("busy", { status: 503 }),
    new Response("slow down", { status: 429 }),
    new TypeError("offline"),
  ])("says search is unavailable on %s", async (response) => {
    answer(response);
    await expect(searchPlaces("Grignetta", "en")).rejects.toBeInstanceOf(SearchUnavailableError);
  });
});

describe("fileNameFor", () => {
  it("drops the characters file systems refuse", () => {
    expect(fileNameFor('Piz Bernina / "Biancograt"')).toBe("Piz Bernina Biancograt");
    expect(fileNameFor("??")).toBe("");
  });
});
