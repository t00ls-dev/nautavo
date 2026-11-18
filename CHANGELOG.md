# Changelog

All notable user-visible changes to [route-gpx](https://route-gpx.t00ls.dev/) are documented in this file, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). Internal changes (CI, dependencies, tests and repository documentation) are not listed.

The site is deployed from `main` after every merge, so entries under Unreleased are already live; a release gives them a version. The [What's new](https://route-gpx.t00ls.dev/changelog.html) page (`changelog.html`) shows the same entries in English and Portuguese and must stay in sync with this file.

## [Unreleased]

### Added

- While navigating, a chip says when the sun sets or rises before the arrival, within the hour (Sunset in 40 min), worked out on the device with no request; with the voice on, the sunset is said once, 30 minutes before.
- Favorite places: choose Save as favorite in a point's field menu, or Add favorite in Favorite places, name it and pick its icon (Home, Work or Favorite), then pick the place in any point's menu, with its address and distance, no search and offline; edit or delete them in Favorite places. Backups now include favorites (format version 2); older backups still import.
- While navigating, tap or drag up the bottom bar, a sheet with a handle like the route panel, to list the turns and route points ahead, with their distances and arrival times; navigation goes on underneath.
- Spoken directions while navigating, off by default: turn them on in the start notice, in Settings or with the speaker button on the navigation screen, and the phone's own voice says each turn ahead, the arrival, leaving the route and a recalculated route, in the interface language, with no request.
- If the page reloads during navigation (a phone discarding the tab, an accidental refresh), it offers to continue on the same route with one tap, even without a connection; this tab keeps the route and the distance travelled for that, never your position, until you end the navigation, arrive or after 30 minutes.
- Imported tracks follow the road actually taken: after an import, the track is aligned to the roads wherever they match it closely, without GPS noise and glitches, with Keep the recorded track to undo it, and stretches no road follows are listed and highlighted on the map as places where the route cannot be followed exactly.
- Turn the planner map with two fingers, as the navigation map already turns (a pinch with a small twist only zooms), or on a computer with a right or Ctrl drag. A compass below the map tools shows on a turned map and puts north up again; labels and markers stay upright, and Fit route keeps the turn.
- A point's field opens a menu with My location (your exact position) and Choose on map (move the map under a fixed marker and Confirm); place suggestions show their name, the rest of the address and the distance from the point before or after.
- Moving a point on the map is precise on touch screens: while you drag a marker, a magnifier above your finger shows the exact spot under it. In Settings, Moving points on the map can instead be Tap, then move the map: tap a marker, move the map under a fixed marker and Confirm.
- Speed while navigating: a round badge shows your current speed (0 when stopped), and the time left and the arrival start from your average speed and move to the trip's own average, stops included, over the first 10 minutes. Simulate navigation shows the trip's clock next to Replay.
- Weather while navigating: a chip at the top left shows the weather here, with an icon, the temperature and the chance of rain (amber with an alert); tap it for the next samples ahead with their distance, passage time and alerts. It reads the forecast already fetched for the route, makes no request and never sends your position; it also follows Simulate navigation.
- Navigate, on phones: follow the route on screen with your live position, the next turn and its road, the turn after it, the remaining distance and time and the arrival time, on a map that turns with your direction of travel, or with the compass, corrected to true north, when you stop, and keeps the screen on. Pinch, double tap or double tap and drag to zoom, drag or turn the map with your fingers, and Re-center, at the bottom left, to follow you again; on a turned map, the compass puts north up. The next turn shows on a card floating over the map. A short safety notice shows when navigation starts and can be turned off, also in Settings. Your location is watched only until End, pauses while the page is hidden and is never stored or sent; without map tiles the route and your position still show.
- Add to home screen, in More actions on phones, shows your browser's steps to open nautavo from an icon on the home screen; there is nothing to install. Help explains it for each platform.
- After one visit with a connection, the app opens without one in the same browser: saved routes open, show their summary and directions and download as GPX, with a notice that you are offline; map tiles, routing, search, weather, elevation and surface still need a connection.
- Surface in the route summary: how much of the route is paved or unpaved, the unpaved stretches to check, each shown on the map when selected, and a Surface route coloring in Map layers; the route's road attributes are requested from Valhalla only on these choices.
- Elevation marks the highest and lowest points of the route on the map with their altitude while it is open, and Elevation here in the map point menu shows the approximate altitude of any point, requested only on that choice.
- Grade route coloring, in Map layers: descents in blue, flat stretches in gray and climbs in orange and red, with a color scale marking −8%, −3%, +3% and +8% in the legend; it requests the route's elevation only when chosen, and none for files with recorded elevation.
- Weather on the map, in Map layers › Route marks, hides or shows the weather icons and wind arrows on the map, remembered on the device; the weather cards stay in the panel.
- On roads the route uses both ways, weather cards say Outbound or Return, and the return markers sit beside the outbound ones instead of on top of them.

### Changed

- route-gpx is now nautavo, at nautavo.com, with a new compass logo and a sea-green interface; Help and What's new are at nautavo.com/help and nautavo.com/changelog.
- Weather cards are compact: the time and place, then the sky, temperature and rain, then the wind and UV, with other risks on one more line only when there are any; the date shows only when the day changes, and the tab on the card names the main risk (Heavy rain) instead of a level number.
- Settings come in sections: Units, Map and points, Navigation and Backup apply at once, and Advanced, folded, holds the servers, satellite imagery, the IP region and the JSON editor, with Apply servers.
- The automatic stops of an imported track are named by their place on the route (Stop · km 1.2) instead of coordinates cut short on phones.
- Without WebGL, the map's tools (layers, location, full screen, fit and lock) are hidden with the map; Undo and the notice stay.
- Error messages say what failed in plain words, without server names or HTTP codes: when a route cannot be calculated, Calculate route becomes Try again, and the Itinerary no longer shows the routing service and point count.
- Results of an Enter search look like the suggestions shown while typing, with the name, the rest of the address and the distance.
- While navigating, reaching an intermediate stop shows and says its name instead of Arrive.
- In Portuguese, each concept has one name: Partida for the departure time (Saída is only a roundabout exit), Início for the first point and Clima for the weather.
- On the navigation screen, the bottom bar keeps to the time, the distance and End; a chip on the map says when the GPS is awaited, as it already did for a weak signal.
- Saved routes and Favorite places share one row: tap the name to open the route or see the place on the map, with icon buttons for download, edit and delete; long names take two lines. A deleted saved route or favorite can be brought back with Undo for 8 seconds. With no point set, both lists come right below the points. The GPX name field is now Route name.
- On phones, the route's distance, time and arrival come first in the panel, on one row even at 320 px; tapping a point's field raises the panel to full height with the field and its menu in view, and lowers it again when you leave the field.
- Prefer main roads now changes the route, not only the review: with it on (the default), routes come from the Valhalla router favoring highways, where OSRM sometimes cut through local roads, with OSRM if Valhalla fails. Turn it off for OSRM's route. In Settings, Valhalla fallback is now Valhalla server.
- Export backup and Import backup moved from Saved routes to Settings, where one file keeps your saved routes and favorite places.
- On an imported track, Calculate route keeps that track and adds directions from its roads, instead of recalculating the whole route through its points; editing a point recalculates only about 1 km on each side of it; and Copy link says that the link recalculates the route, so share the GPX for the exact track.
- Satellite always shows the map's labels: the Labels switch and the note about non-commercial imagery left the Map layers menu (the imagery license stays in the map credits, and Settings still offers the EOX 2016 edition).
- The planner map is drawn by MapLibre GL JS alone, like the navigation map, instead of inside Leaflet: one map engine, with the route, colorings and arrows drawn by the map itself. A double tap and drag zooms with one finger as before. A browser without WebGL now shows a notice instead of the map, and the panel still plans, calculates and exports the route.
- Once location is allowed for the site, a blue dot shows your position on the map whenever the page is open, with a circle for its margin of error and a grey dot when the position stops updating; the first press of Use my location asks for permission. The button centers the map on the dot and follows it until you move the map; it no longer turns location off (block location for the site in the browser to stop it). With location already allowed, the map opens on your position at street zoom as soon as the GPS finds it, however long that takes, instead of falling back to the IP region. When the browser cannot tell whether location is allowed, as iPhone browsers other than Safari, the map opens where you last left it (kept in this browser only); the app never asks for location when it opens. The card with Set as start and Add as stop was removed: My location in a point's field sets a route point.
- Add stop, Reverse and Round trip are tiles of the same size below the points. On wide screens, Copy link and Import are icon buttons beside Download GPX, so no label wraps in the sidebar.
- The route points list is more compact: each point is a numbered circle joined by dots to the next, with its field and ×, and an empty field names its role (Starting point, Add a stop, Destination); hold the ≡ grip at the end of a field and drag to reorder (or focus it and use the arrow keys), the numbers following as you drag. The up and down buttons and the Set on map button below the selected point were removed; tap a point's number to show it on the map.
- The average speed starts at 20 km/h (13 mph in miles) instead of 60 km/h, goes up to 120 km/h or 75 mph, and its slider moves 1 by 1 up to 40 km/h (25 mph). A speed you already chose is kept, and one above the new top becomes the top.
- Travel the route replays the route on the navigation screen, in place of the cursor on the planner map: the next turn and the one after it, the distance and time left and the arrival, at 1×, 2×, 5× or 10× or by dragging a slider, always from the start. A Replay label stays at the top; on a wide window it keeps a phone's 9:16 shape, and it uses no location and sends no request besides the map.
- The planner draws the same map as navigation, OpenFreeMap vector map data from OpenStreetMap, with names as on the street signs. Topographic adds relief shading and contour lines to it, and Satellite shows that map's labels on top of the imagery. No map source needs an account.
- Online, after 15 seconds off the route, navigation recalculates a way back to the planned route, at most once a minute, and Recalculate route asks right away within the same limit; only your current position is sent, and the planned route does not change. Automatic recalculation can be turned off in the start notice, in Settings or from the reminder shown when navigation starts, to follow the planned track exactly, as in an event; Recalculate route still works.
- Off the route while navigating, the card turns amber and says Back to route, with an arrow and the straight-line distance to a point on the route ahead, and the map shows a dashed line to it; it needs no connection and does not know the roads.
- On the navigation map, street names stay upright whatever your direction: the map is now drawn by your browser from OpenFreeMap vector map data, with wider streets that hold their names, in the local language, and its credits sit behind an i button, as on the planner map.
- On phones, only the map zooms: a double tap or a stray pinch no longer enlarges the planner page, and buttons respond without the double-tap delay. Help and What's new still zoom with a pinch, and the browser's text size and zoom settings keep working.
- In Portuguese, the address of the app, Help and What's new ends in ?lang=pt, so a shared address opens in that language.
- Help moved from the header to the bottom of the route panel, beside What's new and GitHub, each with its icon; Settings has a gear icon, and the line about public servers left the panel (Help describes them).

- Editing route points keeps the map where it is instead of zooming out to the whole route after each change; Fit route frames the whole route, and opening a link, file or saved route still frames it.
- Weather is also sampled just past sharp bends of the route, using points left free under the maximum of 20, so the headwind, tailwind or crosswind follows the new direction.
- Consecutive weather samples with the same conditions share one card and one map marker, with time, distance and value ranges; the start, stops and destination keep their own cards.
- Distance units (km or mi) and the new temperature units (°C or °F, with rain in mm or in) are chosen in Settings, start as Automatic from the device's time zone or, when it names no place, the browser's language region, and are remembered on the device; route links and saved routes no longer carry units.
- On phones, the status message shows only at the top of the route panel, up to two lines, and Calculate route takes the full width of its row.
- The Departure label sits above its field, and the automatic option is labeled Automatic departure.

### Removed

- Weather on the navigation screen: it stays in the planner, where it is current, since a forecast from when the route was planned may be hours old on the way.
- The map point menu no longer sets route points: Set as start, Add as stop and Set as destination were removed, and it keeps Elevation here. Type points, click the map on desktop or move a marker.
- The Halfway point route mark, the ½ badge at the middle of the route.

### Fixed

- The status names the point still to set (Set your destination., Set point 2.) instead of always asking for the start and destination.
- On the navigation screen, the speed badge no longer covers Recalculate route, the upcoming list opens above the map's buttons and badges instead of under them, the whole bottom bar opens it, and on small phones Start navigation shows at once in the shorter start notice.
- Favorite messages show in Favorite places instead of Saved routes, saving a route says so once, and deleting the saved route on screen no longer leaves its status saying it is saved.
- Accessibility on touch screens: the language selector of Help and What's new no longer zooms the page on iPhone, disabled buttons keep enough contrast, the point number and remove buttons answer across 44 px, and Navigate is announced by the name it shows.
- A fitted route (a new, opened or imported route, and Fit route) now stays clear of the map tools, the header and the route panel with its markers and weather icons whole, and is fitted again when the panel opens, closes or changes height, unless you have moved the map since.
- Navigation on a route that ends where it starts no longer says you have arrived as it begins: the first position counts from the start of the route.
- On iPhones with a notch or Dynamic Island, the route panel at full height stops below the header instead of covering the logo, language and Settings when the page is drawn under the status bar, as in a home-screen web app or an app's web view.
- On a phone or tablet whose browser can share files, Download GPX becomes Share GPX: it opens the share sheet with the file named after the route, so Firefox on iPhone no longer saves it under a random name without .gpx. Saved routes share their GPX the same way and Export backup becomes Share backup; cancelling does nothing, and if sharing fails the file downloads. Sharing sends only the file, so Save to Files no longer adds a text file with its name. Share GPX left More actions on these devices.
- On phones, the map opens on your location (when already allowed) or region above the route panel instead of under it, and the Daylight legend keeps Day, Twilight and Dark on one line on 320 px screens.
- On narrow phones, the top of Help and What's new fits the screen: the language shows as EN or PT, Back to map no longer runs off the edge and long addresses in the text wrap, so the page no longer scrolls sideways.
- After an update, the app no longer opens with plain text and no icons; opened again from the home screen, it switches to the new version by itself, without removing and adding the icon.
- Opened from an icon on the iPhone home screen, the map no longer shows faded behind the clock and battery: they sit on a white strip and the controls, dialogs, navigation, Help and What's new start below it; the buttons at the bottom sit right above the home indicator. Add the icon again to get it.
- On touch screens, tapping Download GPX before the route is ready no longer makes it look available.
- Screen readers announce each point's search results as a named group, and on phones the route panel no longer jumps down while the page loads.
- Weather icons no longer pile up when the map is zoomed out: icons that would cover each other show as one (the worst alert among them, otherwise a start, stop or destination, otherwise the worst weather) with a +N count of the others, bordered in red when they include alerts; tapping the count or zooming in shows them all.
- The wind badge on map weather markers shows the whole speed beside its unit, for example 99.9 km/h; longer speeds overlapped the unit.
- Weather samples are spaced evenly between route points, so a sample no longer lands a few hundred metres from a stop or the destination and repeats its card; a weather card keeps its date and time on one line, even on the narrowest phones (a range ending the next day shows +1), with the distance on the next line and the alert level as a tab on its top border.
- The weather note "Weather sampled at N of M stops" no longer appears when every route point has a card; it counted the samples between stops as stops.
- On phones, selecting a weather marker on the map no longer scrolls the whole planner up, hiding the top of the map under the address bar and leaving a blank band at the bottom.
- On phones, the arrival shows the time on one line, with the date below it when it is on another day, and Add stop, Reverse and Round trip stay on one row.
- On the narrowest phones, Set on map shows only its pin instead of a cut-off label.
- Zooming with one finger (tap, then touch again and drag) no longer makes the map disappear for a moment.
- On phones, the map credits button stays visible above the route panel; only the full-height panel hides it.
- The English map hint reads as a sentence, for example Set the start on the map.
- Weather card temperature and precipitation use the language's number format (24,1 °C in Portuguese), and the card shows conditions, temperature and rain on separate lines, with rain labeled (for example Rain 13% · 0.2 mm).
- A UV alert on a weather card shows on its UV line as a range up to the worst hour around the passage, for example UV 7–8 · Very high, instead of a separate warning next to a lower value.

## [1.0.0] - 2026-11-11

### Added

- Route planning with start, destination and stops from addresses, coordinates, a map click or long press, or your location, with place suggestions while typing and search with Enter.
- Route editing: move and reorder points, reverse the route, add a return trip, undo changes and lock the route against accidental edits. ([#57](https://github.com/t00ls-dev/route-gpx/pull/57))
- Routing along real roads with OSRM and a Valhalla fallback, with a Prefer main roads option.
- A route summary with distance, time and arrival from your own average speed, kept on this device, in kilometers or miles. ([#60](https://github.com/t00ls-dev/route-gpx/pull/60), [#67](https://github.com/t00ls-dev/route-gpx/pull/67))
- An automatic departure at the next half hour, or a departure you choose. ([#78](https://github.com/t00ls-dev/route-gpx/pull/78))
- An itinerary with turn directions, also for imported tracks and earlier saved routes, requested only when it is opened. ([#77](https://github.com/t00ls-dev/route-gpx/pull/77), [#81](https://github.com/t00ls-dev/route-gpx/pull/81))
- Weather along the route for the departure: conditions, wind relative to the route, UV index and risk alerts, on routes with any number of points. ([#68](https://github.com/t00ls-dev/route-gpx/pull/68), [#76](https://github.com/t00ls-dev/route-gpx/pull/76))
- An elevation profile with gain, loss and the climbs along the route. ([#72](https://github.com/t00ls-dev/route-gpx/pull/72), [#79](https://github.com/t00ls-dev/route-gpx/pull/79))
- Daylight along the route: sunrise, sunset and the distance travelled in the dark, also shown as a route coloring. ([#59](https://github.com/t00ls-dev/route-gpx/pull/59), [#70](https://github.com/t00ls-dev/route-gpx/pull/70))
- Travel the route: a cursor that plays along the track with distance and passage time. ([#69](https://github.com/t00ls-dev/route-gpx/pull/69))
- Map layers: standard, topographic and satellite maps, with direction arrows, out-and-back lines and the halfway point on the route. ([#71](https://github.com/t00ls-dev/route-gpx/pull/71))
- GPX, FIT and TCX import; editing a point of an imported track recalculates only the changed legs. ([#17](https://github.com/t00ls-dev/route-gpx/pull/17), [#75](https://github.com/t00ls-dev/route-gpx/pull/75))
- GPX 1.1 export with the complete track and named waypoints.
- Short share links; a link that suggests other routing or search servers opens with the default servers until you choose to use them. ([#10](https://github.com/t00ls-dev/route-gpx/pull/10), [#13](https://github.com/t00ls-dev/route-gpx/pull/13))
- Named routes saved in this browser, with backup export and import.
- A side panel on wide screens and a bottom sheet on phones, with one-finger zoom on touch screens. ([#82](https://github.com/t00ls-dev/route-gpx/pull/82), [#63](https://github.com/t00ls-dev/route-gpx/pull/63))
- English and Portuguese interface, a help page and a What's new page. ([#83](https://github.com/t00ls-dev/route-gpx/issues/83))

[Unreleased]: https://github.com/t00ls-dev/route-gpx/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/t00ls-dev/route-gpx/releases/tag/v1.0.0
