# <img src="src/brand/icon.svg" width="48" height="48" alt="" align="absmiddle" /> Nautavo

Plan routes and export the complete track as GPX.

A static web tool that turns addresses, coordinates and map points into a GPX 1.1 file with the complete track and named waypoints, with no account or API key.

## Features

- **Plan** with addresses, coordinates, map points or your location, on a map that turns.
- **Edit:** move and reorder points, reverse, add a return trip, undo and lock the route.
- **Review** distance, time from your own average speed, an itinerary with turn directions, elevation and climbs, road surface and daylight.
- **Weather** along the route for the departure time, with wind relative to the route and risk alerts.
- **Import** GPX, FIT and TCX tracks, aligned to the roads actually taken, and **export** GPX 1.1 with the complete track and named waypoints.
- **Navigate** on a phone with turn directions, a heading-up map, a way back to the route and optional spoken directions.
- **Replay** recorded activities at their own pace, with moving time, speeds, heart rate, cadence, power and temperature, apart from the route you are planning.
- **Map layers:** standard, topographic and satellite, with route coloring by daylight, grade or surface.
- **Save and share:** route links, saved routes and favorite places in this browser, and backups.
- Works offline after the first visit, in English and Portuguese.

## Quick start

1. Open [nautavo.com](https://nautavo.com/).
2. Enter addresses or `latitude, longitude` in **Start** and **Destination**, or pick points on the map.
3. Add stops, adjust the points and review the calculated route.
4. Optionally enter a **route name**, then press **Download GPX** (**Share GPX** on a phone or tablet that can share files, which keeps the file name in browsers such as Firefox on iPhone).

Gestures, shortcuts and every control are explained on the [Help page](https://nautavo.com/help). Recent changes are listed on [What's new](https://nautavo.com/changelog) and in the [changelog](CHANGELOG.md).

## Good to know

- Nothing is saved automatically: **Save route** keeps the route in this browser; export backups, since clearing browser data removes saved routes and favorite places.
- Routing uses a car profile; **Prefer main roads** favors highways but does not guarantee it, and estimates exclude stops and traffic.
- Share links store points and options, not an imported track's geometry: share the GPX for the exact track.
- Offline, saved routes open and download, but map tiles, routing, search, weather, elevation and surface need a connection; what could not load is fetched once when it returns.
- Navigation needs the tab open and the screen on (iOS Safari is the strictest). Weather risks are a review aid, not an official warning.

Every control, gesture and limit is explained on the [Help page](https://nautavo.com/help).

## Privacy

- No cookies, analytics or account. The site's own server stores nothing; besides the files, it only answers the approximate region by IP, which can be turned off.
- Routing, search, map, weather, elevation and surface providers receive the locations each request needs and your IP address. Weather is asked for the route's departure (by default the next half hour, which can be turned off); elevation and surface only when you open them or choose their route coloring. A track imported as a route goes to the Valhalla server once, to align it to the roads; a recorded activity is opened on the device only.
- Your location is used only after the browser allows it and stays on the device, except when you add it as a route point or a navigation recalculation sends the current position.
- Saved routes, favorite places and preferences stay in this browser; every service URL is configurable in **Settings**.
- A recorded activity's times, heart rate and other sensor values are read on the device, kept only while the page is open and never saved or sent.

The [Help page](https://nautavo.com/help) and [services and privacy](docs/SERVICES.md) detail each request, provider, limit and term.

## Local development

```sh
npm ci            # install with Node.js 22.23.4+ (.nvmrc; Node 24.15+ and 26+ also supported)
npm run dev       # serve at http://localhost:5173/
npm run build     # type-check and build the production version
npm run preview   # preview the production build
```

## Validation

```sh
npx playwright install chromium   # once, for browser tests
npm run lint                      # ESLint
npm run format:check              # Prettier
npm run knip                      # unused files, exports and dependencies
npm test                          # Vitest unit tests (public services mocked)
npm run test:browser              # Playwright browser workflows
npm run build                     # TypeScript check and production build
```

While working on a change, run the browser specs that cover it (`npx playwright test tests/<name>.spec.ts`); the complete suite runs in every pull request's CI. Opt-in checks that use real services or local files (`npm run test:integration`, `npm run test:tracks`, `npm run lighthouse`, `node scripts/browser-check.mjs`) are described in [AGENTS.md](AGENTS.md#local-validation).

## Deployment

GitHub Actions runs checks on pull requests and pushes to `main`, and successful builds of the current `main` commit deploy to Cloudflare Workers, as static assets, at `https://dev.nautavo.com/`; each published release deploys to `https://nautavo.com/`. A weekly Lighthouse workflow, also run on demand, audits the live site. Changes reach `main` only through pull requests that pass CI. Vite uses `/` as its base path; see the [brand and hosting notes](docs/BRAND.md) before changing the hosting path. To publish your own copy at another domain, see [self-hosting](docs/SELF-HOSTING.md).

## Contributing

See the [contributing guide](CONTRIBUTING.md) before opening a pull request. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md), and security vulnerabilities are reported privately as described in the [security policy](SECURITY.md).

## Credits and license

Built with [MapLibre GL JS](https://maplibre.org/), [maplibre-contour](https://github.com/onthegomap/maplibre-contour), [OSRM](https://project-osrm.org/), [Valhalla](https://valhalla.github.io/valhalla/), [Nominatim](https://nominatim.org/), [Photon](https://github.com/komoot/photon), [Vite](https://vite.dev/) and [Vitest](https://vitest.dev/). The map by [OpenFreeMap](https://openfreemap.org/), © [OpenMapTiles](https://www.openmaptiles.org/); relief from [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen, AWS Open Data); satellite imagery by [EOxCloudless](https://cloudless.eox.at/). Weather data by [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with passage times and risk summaries calculated here; elevation from the [Copernicus DEM GLO-90](https://doi.org/10.5270/ESA-c5d3d65) via Open-Meteo. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The Nautavo wordmark is drawn from the [Sora](https://github.com/sora-xor/sora-font) typeface ([SIL Open Font License 1.1](https://openfontlicense.org/)). Compass headings are corrected to true north with the [World Magnetic Model](https://www.ncei.noaa.gov/products/world-magnetic-model) (NOAA NCEI and BGS, public domain).

The bundled MapLibre GL JS and maplibre-contour libraries use the BSD 3-Clause license and [fflate](https://github.com/101arrowz/fflate) (route-link compression) the MIT license; their complete notices are included in [third-party notices](public/THIRD_PARTY_NOTICES.txt) and copied into the production build.

Application code is licensed under [MIT](LICENSE). Data and dependencies retain their own licenses. No affiliation with the public service operators.

[Report a bug or contact the maintainer](https://github.com/t00ls-dev/nautavo/issues/new/choose) · [Report a security vulnerability privately](https://github.com/t00ls-dev/nautavo/security/advisories/new) · [Report a map issue](https://www.openstreetmap.org/fixthemap)
