"use client";

import { Input } from "@furrow/ui/components/ui/input";
import { SearchIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import {
  type Place,
  type PlaceView,
  parsePlace,
  SearchUnavailableError,
  searchPlaces,
} from "../lib/place-search";

/** Photon is asked only once typing pauses this long, and only for this many characters (ADR-0076). */
const SEARCH_DELAY = 300;
const MIN_QUERY = 3;

type Status = "idle" | "searching" | "none" | "unavailable" | "shortLink";

/**
 * The terrain dialog's place search (PRD-0014 T2): names are suggested by
 * Photon as the user types; coordinates and map links are read locally and
 * offered as a place to go to. `onPick` hears the place picked, `name` `null`
 * for coordinates.
 */
export function TerrainSearch({
  onPick,
}: {
  onPick: (place: { name: string | null; view: PlaceView }) => void;
}) {
  const t = useTranslations("Terrain");
  const locale = useLocale();
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [point, setPoint] = useState<PlaceView | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    setResults([]);
    setPoint(null);
    const parsed = parsePlace(query);
    if (parsed === "shortLink") return setStatus("shortLink");
    if (parsed) {
      setPoint(parsed);
      return setStatus("idle");
    }
    if (query.trim().length < MIN_QUERY) return setStatus("idle");
    // Aborting the last search keeps at most one request in flight.
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setStatus("searching");
      searchPlaces(query.trim(), locale, abort.signal).then(
        (found) => {
          setResults(found);
          setStatus(found.length > 0 ? "idle" : "none");
        },
        (error) => {
          if (error instanceof SearchUnavailableError) setStatus("unavailable");
        },
      );
    }, SEARCH_DELAY);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, locale]);

  function pick(place: { name: string | null; view: PlaceView }) {
    onPick(place);
    setResults([]);
    setPoint(null);
  }

  const centre = point && "center" in point ? point.center : null;
  return (
    <div className="grid gap-1.5" data-demo="terrain-search">
      <label htmlFor={id} className="font-medium">
        {t("search")}
      </label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="search"
          value={query}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          className="pl-8"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const first = results[0];
            if (point) pick({ name: null, view: point });
            else if (first) pick(first);
          }}
        />
      </div>
      {(centre || results.length > 0) && (
        <ul className="grid gap-0.5" aria-label={t("search")}>
          {centre && (
            <li>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1 text-left hover:bg-accent focus-visible:bg-accent"
                onClick={() => pick({ name: null, view: point as PlaceView })}
              >
                {t("goTo", { lat: centre[1], lon: centre[0] })}
              </button>
            </li>
          )}
          {results.map((place) => (
            <li key={`${place.name}|${place.label}|${JSON.stringify(place.view)}`}>
              <button
                type="button"
                className="grid w-full rounded-sm px-2 py-1 text-left hover:bg-accent focus-visible:bg-accent"
                onClick={() => pick(place)}
              >
                <span>{place.name}</span>
                {place.label && <span className="text-muted-foreground">{place.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground" aria-live="polite">
        {status === "searching"
          ? t("searching")
          : status === "none"
            ? t("noResults")
            : status === "unavailable"
              ? t("searchUnavailable")
              : status === "shortLink"
                ? t("shortLink")
                : null}
      </p>
    </div>
  );
}
