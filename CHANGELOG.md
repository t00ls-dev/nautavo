# Changelog

All notable user-visible changes to [Nautavo](https://nautavo.com/) are documented in this file, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). Internal changes (CI, dependencies, tests and repository documentation) are not listed.

The site is deployed from `main` after every merge, so entries under Unreleased are already live; a release gives them a version. The [What's new](https://nautavo.com/changelog) page (`changelog.html`) shows the same entries in English and Portuguese and must stay in sync with this file.

## [Unreleased]

### Added

- Downloaded GPX, TCX and FIT files include the elevation of every point when the page already has it: recorded in an imported file, or the profile loaded by opening Elevation. Nothing more is requested for it; a file saved without it says so, and how to include it.
- Download TCX with turns and Download FIT with turns, in the Export menu: a TCX or FIT course for GPS devices and watches that announce turns, with the complete track and a point at each turn and each route point. An imported track first gets its turns as the Itinerary does. Download GPX is unchanged.
- Drag the route line to add a stop: a handle appears on the line under the pointer, or where you tap it on a touch screen, and dragging or tapping it adds a stop between the two route points of that part of the route, so the route takes the road you choose without adding a stop and moving it in the list. With three points or more, a point leaves the route from the map too: drag it onto the trash that appears at the bottom of the map, or tap it (right click on a computer) and choose Remove; Undo brings it back.
- Turn directions name the route number and first destination on the road's sign where it is mapped, such as RJ-071 toward Ilha do Governador, in the Itinerary, the list of turns ahead and the navigation banner, so ramps and forks without a road name say where they lead. Spoken directions are unchanged.
- Recorded activities: importing a GPX, FIT or TCX file with recorded times, such as an activity from a bike computer, watch or app, opens it apart from the route you are planning, with its distance, moving and total time, average and maximum speed and the heart rate, cadence, power and temperature it carries. Charts of its altitude, speed, heart rate, cadence and power share one cursor that shows the point on the map, the map marks the top speed, the highest heart rate and the highest point, and Map layers colors the track by its speed, heart rate, power or grade, in five zones of the activity itself. Play activity replays it at its own pace (1× to 300× real time) with the recorded clock and the values you choose to show, including altitude, grade, climb so far and left/right power balance, noting the top speed and the highest heart rate, cadence, power and point as it passes them and skipping stops of a minute or more; Use as route imports it as a route as before. The activity is read on the device only and is not saved or sent.
- The list of turns ahead while navigating starts with the road you are on, highlighted, with its stage of the route (Step 2 of 6).
- When navigation starts on a road the route uses more than once, such as halfway along an out-and-back route, and cannot tell which way you are going, it asks, showing the next route point and the distance left for each way; once you move, your direction of travel answers on its own. Before, it took the first way, and its directions could be those of the other one.

### Changed

- The empty planner shows the ways to start a plan: choose the start on the map with the crosshair, import a GPX, FIT or TCX file, open a saved route or use or add a favorite place. Save route, Export and the other route actions appear once there is a route, and Add to home screen moves to Settings.
- Below the route summary, tabs show Points, Itinerary, Weather and Elevation one at a time, instead of a list of folded sections; each still loads its data only when you open it. On a computer, Elevation opens in a strip under the map, as wide as the map, from its button or from Show in Ascent. Travel the route is in More actions on a phone, and below the route's actions on a computer.
- The map credits button is smaller.
- On a phone, the route sheet moves by dragging the panel itself, not only its handle.
- Surface is shown on the map only, through its route coloring, whose legend now gives each surface's share of the route. Daylight has no section of its own either: when part of the trip falls in the dark, a notice below the trip line says how far and when to leave, and a tap shows the dark stretches on the map.
- Map layers shows the base maps side by side with a small preview, then the route coloring and the route marks as switches. On a phone held upright it opens from the bottom of the screen and fits without scrolling.
- The route's actions put planning first: Save route and Export are the main buttons, on phones and computers. Save route asks for the route's name in its own sheet, and Export opens a menu with Download GPX, the TCX and FIT courses with turns and Copy link, each saying what it is for. On a phone, Navigate moves to the route summary, beside the route's start and end; on a computer, Import is below Saved routes.
- The route summary is headed by the route's name, or its start and end, and shows Distance, Ascent and Arrival, with the time of the trip below the arrival. Ascent appears when you tap Show, which loads the elevation as opening Elevation does, and stays on for the next routes; a file with recorded elevation shows it at once.
- Once the route shows, Trip options folds into one line with the departure, the speed and Main roads; tap it to change them.
- Calculate route shows only where it does something: as Try again after a calculation fails, and on an imported track, which it matches to the roads again. The route is still calculated on its own after every change.
- With Prefer main roads, the summary counts the local roads left on the route with their length (15 local road sections · 6.2 km) in a neutral line instead of a warning, and a route point placed away from a road says how far it is and that the route uses the nearest road; it is a warning only beyond 500 m.
- Weather cards no longer raise a rain alert for light rain that is only likely: below 1 mm an hour, a high chance of rain is named Light rain likely, in the card's neutral color.
- Portuguese uses Elevação for elevation everywhere, as the Elevation section does.
- The language selector moves from the header to the top of Settings, and Settings lists Navigation after Backup, below the planning settings, with shorter labels for its switches.
- Saved routes, favorite places and backups use Nautavo's name now. Routes and places saved before this change, and backups exported before it, do not carry over: save them again.
- While navigating, traveling the route or playing an activity, your position is a green dot with a cone pointing the way, in Nautavo's colors, instead of a blue arrow.
- The Itinerary shows each step's instruction on its own line, with the road and its distance below it, so on a phone a long road name no longer hides the instruction or the distance.
- Zooming the map while navigating, traveling the route or playing an activity works as on the route planner: a pinch or a double tap zooms around your fingers, and a tap with two fingers zooms out. When you let go, the map slides back to your position and keeps following you.
- With a phone held sideways, navigation and Travel the route fill the screen with the map and show the guidance as two cards on its left, the next turns at the top and the time with End (or the replay controls) at the bottom, with the map in view between them; the bottom card's handle opens the list of turns ahead. The route planner's panel moves to the left of the map instead of covering its lower half, with the route's distance and time and Navigate always in view. Travel the route no longer keeps a phone's narrow shape on a wide window, and its Replay label no longer covers the map: the play button, slider and arrival show the replay.
- The name is written Nautavo, with a capital N, in page titles and every text; the logo is unchanged. A value that is not known shows a hyphen.
- When the connection returns, weather, elevation, surface and the Itinerary's directions that could not load without it load once on their own, saying so meanwhile, instead of showing an error with Try again.
- On a computer without a graphics processor, or one the browser does not use, the map draws at standard resolution so it stays responsive; screens with a graphics processor are unchanged.
- Downloaded GPX files no longer name a means of transport in their keywords, only Nautavo.

### Fixed

- The highest and lowest point labels of the elevation profile stay inside the map near its edges instead of being cut.
- On a computer, a click on the map no longer moves the start of a route whose points are all set: it sets the next empty point, or the point whose number you chose in the list, and the hint on the map shows only while a click would set one.
- In Chrome and Brave on iPhone and iPad, Nautavo's pages no longer say the connection is not secure. The connection always was secure; two things confused those browsers: a security header that isolates the page from other windows, now removed, and pages answered by the copy kept for offline use, which now answers only without a connection.
- While navigating, the way ahead always draws above the way travelled, so on a road the route uses both ways it no longer disappears under the gray; close up, the two passes draw side by side, as on the planning map, and with the whole route in view the lines are thinner and the way travelled lighter.
- A point menu opened on the map right after the page opens, with a right click or the keyboard, stays open; before, the map could still move to your approximate region and close it.
- While navigating, the distance to the next turn and the distance left no longer lag up to 30 m behind your position.
- A number and its unit, such as 1,308 m or 18 min, always stay together on the same line.
- When a second file failed to import while the first one was still being checked against the roads, the error now stays in view; before, the first file's message replaced it.
- On an iPhone, a tap followed by a touch and hold, such as zooming the map with one finger or dragging a point right after tapping it, no longer opens the browser's magnifier over the map, its points, the activity view or the navigation screen.
- On a phone, tapping an address suggestion sets that point only; before, the tap could also press the button that ended up under the finger as the list closed, such as Reverse, which moved the address to the other end of the route.
- On a phone, tapping the bottom sheet's handle only opens or closes it; before, the same tap could also open or close a section of the route panel, or tap the map, that ended up under the finger.
- In the list of turns ahead while navigating, right turns show a right arrow; they showed a left one.
- Map areas that failed to load while the connection was down, such as after moving the map offline, load when it returns, on the route planner and while navigating, instead of staying blank; a navigation started offline also gets its map when the connection returns.
- In Settings, a server address over plain HTTP is refused when you apply it on nautavo.com, which connects only to HTTPS servers, instead of being accepted and then failing on every request; Nautavo run on your own computer still accepts a server there.
- For part of November 18, Cloudflare, which hosts the site, added its visitor analytics script to nautavo.com's pages through a hosting setting, against the site's no-analytics promise; the setting was turned off the same day, and the site's security policy now blocks such scripts.

## [2.0.1] - 2026-11-18

### Changed

- nautavo.com sends security headers that let it connect only to HTTPS servers: a routing, search or weather server on your own computer over plain HTTP now works only when you run Nautavo there yourself.

### Fixed

- Locking the route disables opening saved routes at once, and unlocking enables it again; before, Saved routes could keep the state it was last drawn with.

## [2.0.0] - 2026-11-18

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
- Navigate, on phones: follow the route on screen with your live position, the next turn and its road, the turn after it, the remaining distance and time and the arrival time, on a map that turns with your direction of travel, or with the compass, corrected to true north, when you stop, and keeps the screen on. Pinch, double tap or double tap and drag to zoom, drag or turn the map with your fingers, and Re-center, at the bottom left, to follow you again; on a turned map, the compass puts north up. The next turn shows on a card floating over the map. A short safety notice shows when navigation starts and can be turned off, also in Settings. Your location is watched only until End, pauses while the page is hidden and is never stored; it is sent only for a recalculation of the way back to the route; without map tiles the route and your position still show.
- Add to home screen, in More actions on phones, shows your browser's steps to open Nautavo from an icon on the home screen; there is nothing to install. Help explains it for each platform.
- After one visit with a connection, the app opens without one in the same browser: saved routes open, show their summary and directions and download as GPX, with a notice that you are offline; map tiles, routing, search, weather, elevation and surface still need a connection.
- Surface in the route summary: how much of the route is paved or unpaved, the unpaved stretches to check, each shown on the map when selected, and a Surface route coloring in Map layers; the route's road attributes are requested from Valhalla only on these choices.
- Elevation marks the highest and lowest points of the route on the map with their altitude while it is open, and Elevation here in the map point menu shows the approximate altitude of any point, requested only on that choice.
- Grade route coloring, in Map layers: descents in blue, flat stretches in gray and climbs in orange and red, with a color scale marking −8%, −3%, +3% and +8% in the legend; it requests the route's elevation only when chosen, and none for files with recorded elevation.
- Weather on the map, in Map layers › Route marks, hides or shows the weather icons and wind arrows on the map, remembered on the device; the weather cards stay in the panel.
- On roads the route uses both ways, weather cards say Outbound or Return, and the return markers sit beside the outbound ones instead of on top of them.

### Changed

- route-gpx is now Nautavo, at nautavo.com, with a new compass logo and a sea-green interface; Help and What's new are at nautavo.com/help and nautavo.com/changelog.
- The approximate region for the first map view now comes from the site's own server instead of ipwho.is, so no other service sees your IP address for it; the region service address is no longer a setting.
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
- Route editing: move and reorder points, reverse the route, add a return trip, undo changes and lock the route against accidental edits. ([#57](https://github.com/t00ls-dev/nautavo/pull/57))
- Routing along real roads with OSRM and a Valhalla fallback, with a Prefer main roads option.
- A route summary with distance, time and arrival from your own average speed, kept on this device, in kilometers or miles. ([#60](https://github.com/t00ls-dev/nautavo/pull/60), [#67](https://github.com/t00ls-dev/nautavo/pull/67))
- An automatic departure at the next half hour, or a departure you choose. ([#78](https://github.com/t00ls-dev/nautavo/pull/78))
- An itinerary with turn directions, also for imported tracks and earlier saved routes, requested only when it is opened. ([#77](https://github.com/t00ls-dev/nautavo/pull/77), [#81](https://github.com/t00ls-dev/nautavo/pull/81))
- Weather along the route for the departure: conditions, wind relative to the route, UV index and risk alerts, on routes with any number of points. ([#68](https://github.com/t00ls-dev/nautavo/pull/68), [#76](https://github.com/t00ls-dev/nautavo/pull/76))
- An elevation profile with gain, loss and the climbs along the route. ([#72](https://github.com/t00ls-dev/nautavo/pull/72), [#79](https://github.com/t00ls-dev/nautavo/pull/79))
- Daylight along the route: sunrise, sunset and the distance travelled in the dark, also shown as a route coloring. ([#59](https://github.com/t00ls-dev/nautavo/pull/59), [#70](https://github.com/t00ls-dev/nautavo/pull/70))
- Travel the route: a cursor that plays along the track with distance and passage time. ([#69](https://github.com/t00ls-dev/nautavo/pull/69))
- Map layers: standard, topographic and satellite maps, with direction arrows, out-and-back lines and the halfway point on the route. ([#71](https://github.com/t00ls-dev/nautavo/pull/71))
- GPX, FIT and TCX import; editing a point of an imported track recalculates only the changed legs. ([#17](https://github.com/t00ls-dev/nautavo/pull/17), [#75](https://github.com/t00ls-dev/nautavo/pull/75))
- GPX 1.1 export with the complete track and named waypoints.
- Short share links; a link that suggests other routing or search servers opens with the default servers until you choose to use them. ([#10](https://github.com/t00ls-dev/nautavo/pull/10), [#13](https://github.com/t00ls-dev/nautavo/pull/13))
- Named routes saved in this browser, with backup export and import.
- A side panel on wide screens and a bottom sheet on phones, with one-finger zoom on touch screens. ([#82](https://github.com/t00ls-dev/nautavo/pull/82), [#63](https://github.com/t00ls-dev/nautavo/pull/63))
- English and Portuguese interface, a help page and a What's new page. ([#83](https://github.com/t00ls-dev/nautavo/issues/83))

[Unreleased]: https://github.com/t00ls-dev/nautavo/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/t00ls-dev/nautavo/releases/tag/v2.0.1
[2.0.0]: https://github.com/t00ls-dev/nautavo/releases/tag/v2.0.0
[1.0.0]: https://github.com/t00ls-dev/nautavo/releases/tag/v1.0.0
