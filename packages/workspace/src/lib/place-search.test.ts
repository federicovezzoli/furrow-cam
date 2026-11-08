import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areaName,
  fileNameFor,
  parsePlace,
  SearchUnavailableError,
  searchPlaces,
} from "./place-search";

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
    ["45,9219 9,3907", at(45.9219, 9.3907)],
    ["45,9219; 9,3907", at(45.9219, 9.3907)],
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

  it.each(["Grignetta", "St. Moritz", "Piz Bernina", "Monte Rosa 4634"])(
    "leaves %s to the search",
    (text) => {
      expect(parsePlace(text)).toBeNull();
    },
  );

  it.each([
    "45.92",
    "45,92",
    "45.9219,",
    "45.9219, 9.3",
    "46°12'",
    "46°12'N 9",
    "95, 10",
    "45.9, 200",
  ])("never searches coordinates being typed or out of range: %s", (text) => {
    const parsed = parsePlace(text);
    expect(parsed === "typing" || (parsed !== null && typeof parsed === "object")).toBe(true);
  });

  it.each([
    "https://www.google.com/maps/place/Grigna",
    "google.com/maps?q=Grignetta&utm_source=x",
    "https://www.openstreetmap.org/node/123",
    "https://www.openstreetmap.org/search?query=Grigna",
    "https://www.openstreetmap.org/?mlat=north&mlon=9",
    "https://example.com/@45.9,9.3,14z",
  ])("never searches a link it can't read: %s", (link) => {
    expect(parsePlace(link)).toBe("noCoordinates");
  });
});

describe("searchPlaces", () => {
  afterEach(() => vi.unstubAllGlobals());

  function answer(response: Response | Error) {
    const fetch = vi.fn(async () => {
      if (response instanceof Error) throw response;
      // A copy each time: a body can be read once.
      return response.clone();
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

  it("frames the point of a place whose extent crosses the 180° meridian", async () => {
    answer(
      Response.json({
        features: [
          {
            geometry: { coordinates: [178, -18] },
            properties: { name: "Fiji", extent: [177, -16, -178, -21] },
          },
        ],
      }),
    );
    expect((await searchPlaces("Fiji", "en"))[0]?.view).toEqual({ center: [178, -18], zoom: 12 });
  });

  it("says search is unavailable when the answer isn't a list of places", async () => {
    answer(Response.json({ features: "nope" }));
    await expect(searchPlaces("Grignetta", "en")).rejects.toBeInstanceOf(SearchUnavailableError);
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
    expect(fileNameFor("Monte\u0007 Rosa...  ")).toBe("Monte Rosa");
    expect(fileNameFor("x".repeat(150))).toHaveLength(100);
  });

  it("refuses names Windows reserves", () => {
    expect(fileNameFor("Nul")).toBe("");
    expect(fileNameFor("COM1")).toBe("");
    expect(fileNameFor("Console")).toBe("Console");
  });
});

describe("areaName", () => {
  const place = {
    name: "Grigna Meridionale",
    view: { center: [9.39, 45.92] as [number, number], zoom: 12 },
  };
  const square = (lon: number, lat: number): [number, number][] => [
    [lon, lat],
    [lon + 0.04, lat],
    [lon + 0.04, lat + 0.03],
    [lon, lat + 0.03],
  ];

  it("names an area drawn about the place picked, or beside it", () => {
    expect(areaName(place, square(9.37, 45.9))).toBe("Grigna Meridionale");
    expect(areaName(place, square(9.4, 45.9))).toBe("Grigna Meridionale");
  });

  it("doesn't name an area drawn elsewhere, nor one after coordinates", () => {
    expect(areaName(place, square(10.5, 46.3))).toBeNull();
    expect(areaName({ ...place, name: null }, square(9.37, 45.9))).toBeNull();
    expect(areaName(null, square(9.37, 45.9))).toBeNull();
  });
});
