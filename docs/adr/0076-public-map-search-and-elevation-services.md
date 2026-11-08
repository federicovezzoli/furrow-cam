# ADR-0076: Maps, place search and elevation come from public services the browser calls directly

- **Status:** Proposed
- **Date:** 2026-11-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0014, PRD-0007 (D2), ADR-0004, ADR-0013, ADR-0044, ADR-0052, ADR-0077

## Context

PRD-0014 turns an area picked on a map into a relief model. That needs three things Furrow CAM doesn't have: a base map to find and frame the area, a place search, and elevation data. Furrow CAM is open source and self-hostable, needs no account to try (PRD-0008), and collects no personal data beyond the email address (ADR-0013). The desktop app makes no network requests except the update check and the telemetry the user agreed to (PRD-0007 D2, enforced in `apps/desktop/src/main/index.ts` by a CSP and a request filter). The commercial providers (Google Maps, Mapbox, MapTiler) all need an API key, which an open source app can't ship and a guest can't be asked for.

Checked on 2026-11-08:

- **OpenFreeMap** (`tiles.openfreemap.org`) serves OpenStreetMap vector tiles and MapLibre styles: no key, no registration, no request limits, commercial use allowed, attribution required. Its access logs keep no IP address; error logs may, for at most 7 days. It may sit behind Cloudflare.
- **Mapterhorn** (`tiles.mapterhorn.com`) serves open elevation tiles: Terrarium-encoded 512 px WebP, from Copernicus GLO-30 (30 m) worldwide with 150 regional sources on top (for Italy TINITALY at 10 m and regional lidar at 2 to 5 m; swissALTI3D at 0.5 m). The licences are open, almost all requiring attribution (CC BY 4.0, Licence Ouverte, Datenlizenz Deutschland) or none (public domain, CC0). It is served through Cloudflare with a 7-day cache. No usage limits are published. High zoom levels exist only where regional data exist: a z15 tile in the Alps returned 404 where z14 returned data.
- **Photon** (`photon.komoot.io`), komoot's search over OpenStreetMap data, suggests places as the user types: no key; "please be fair, extensive usage will be throttled", and no availability guarantee. It names places in English, German or French (`lang=en|de|fr`) and refuses any other language with a 400; without `lang` it gives local names. One of a handful of requests made while writing this ADR got a 503. Nominatim, the other OpenStreetMap search, forbids search-as-you-type on its public instance and allows one request per second.
- All three answer with `Access-Control-Allow-Origin: *`, so a page can call them directly.

## Options considered

1. **The browser calls the public services directly.** Pros: no key, no cost, no server code, works for guests and in the desktop app the same way. Cons: the services receive the user's IP address and what they look at, and we depend on community services with no guarantee.
2. **Our server proxies them.** Pros: the services see only our server. Cons: every tile and keystroke goes through Vercel (cost and latency), our server then sees every place searched, and the desktop app would need furrow.cam to be up as well.
3. **We host tiles and search ourselves.** Pros: no third parties. Cons: a planet-wide elevation archive and a Photon index are tens to hundreds of gigabytes to store, update and serve; out of proportion for one feature.
4. **A commercial provider with a key.** Rejected: it needs a key per instance, often a billing account, and closed terms.

## Decision

We will use option 1:

- **Services:** OpenFreeMap's `liberty` style for the map, Mapterhorn's `{z}/{x}/{y}.webp` tiles for elevation, and Photon's `/api` for search. Their URLs live in one module in `@furrow/workspace`, so a self-hoster or a fork can point them at its own instances (shortcut: build-time constants; make them instance settings if anyone asks). The desktop main process builds its request filter and CSP from the same module, so the two never disagree.
- **Map and drawing:** `maplibre-gl` (BSD-3-Clause) shows the map, and `terra-draw` with its MapLibre adapter (MIT) draws the rectangle, circle, ellipse and freehand shapes. Both are dependencies of `@furrow/workspace`, loaded as a separate chunk only when the terrain dialog opens, never on page load.
- **Search:** sent only after the user stops typing for 300 ms and has typed at least 3 characters, with at most one request in flight and 5 results. `lang` is the interface language when it is English, German or French and is left out otherwise. When Photon answers 429 or 503, the dialog says search is unavailable for now and points to coordinates and links; the map and drawing keep working. Coordinates and full Google Maps or OpenStreetMap links are recognised and parsed locally, and never sent. Short links (`maps.app.goo.gl`) are not followed, since that means asking Google: the dialog asks for the address shown after opening them.
- **When requests happen:** only while the terrain dialog is open. Elevation tiles are fetched only for the selected area, at the zoom PRD-0014's detail needs (ADR-0077), and the browser caches them.
- **Privacy:** these services are not our processors: the user's browser contacts them directly, and they receive its IP address and user agent, the map area viewed and, for Photon, what is typed in the search field. Furrow CAM stores none of it; the project keeps only the generated mesh and its name (ADR-0077). The privacy policy gets a section naming komoot (Photon), OpenFreeMap and Mapterhorn with their policies, and its paragraph on the desktop app, which lists the only requests the app makes, adds these. The dialog names them in a line beside the map from the moment it opens, without a click first (PRD-0014 T9). The telemetry event for an import (ADR-0052) records the format `terrain`, never a place, coordinates or search text.
- **Attribution:** the map shows OpenStreetMap's, OpenFreeMap's and Mapterhorn's attribution, as their terms require.
- **Desktop app:** PRD-0007 D2 gains one exception. While the terrain dialog is open, the main window's request filter lets through `GET` requests to exactly these three hosts and nothing else, and the CSP adds them to `connect-src` (MapLibre and the mesh worker load everything with `fetch`). Opening the dialog is the user's choice to use them, so there is no separate prompt. Offline, the dialog says the map couldn't be loaded and nothing else changes.

## Consequences

- No key, account or server change for any instance, and guests and the desktop app get the feature too.
- The feature depends on three services run by a company and by volunteers, with no guarantee: if one goes down, that part stops working until it comes back or its URL is changed. The rest of the app never depends on them.
- If Furrow CAM grows enough to be throttled by Photon, the options are our own Photon instance or Nominatim with search on Enter; option 3 stays open.
- Users' IP addresses reach third parties we don't control, only when they use the feature; this is in the privacy policy and stated in the dialog.
- Models carved from the terrain derive from CC BY data: the attribution is in the dialog, but crediting the data on a piece someone sells is up to them.
- `maplibre-gl` is a large dependency (about 1 MB minified); it costs nothing to users who never open the dialog.
