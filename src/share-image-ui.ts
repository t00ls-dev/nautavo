import { activityZones } from './activity-colorings';
import { zoneShares, ZONES, type Activity } from './activity';
import markUrl from './brand/icon.svg?url';
import wordmarkUrl from './brand/wordmark.svg?url';
import { detectClimbs } from './climbs';
import { filename, type Coord, type Route, type State } from './core';
import { departureOf } from './departure';
import { byId as $, classVariable } from './dom';
import {
  elevationStats,
  type ElevationSource,
  type ProfilePoint,
} from './elevation';
import { t } from './i18n';
import { iconControl } from './icons';
import { coloringColor } from './route-overlays';
import {
  shareClimbs,
  stripIndices,
  trimEnds,
  weatherSummary,
  HIDDEN_ENDS,
  type ShareWeather,
} from './share-data';
import { exportFile, PNG_DOWNLOAD, PNG_TYPES } from './share-file';
import {
  drawActivity,
  drawInvite,
  loadImage,
  MAP_SCALE,
  SHARE_SIZE,
  token,
  type ActivityImage,
  type Brand,
  type InviteImage,
  type ShareFormat,
} from './share-image';
import { mapShot, type MapShot } from './share-map';
import { travelTimeSeconds } from './travel-time';
import { distanceUnits, temperatureUnits } from './unit-preferences';
import {
  distanceLabel,
  durationLabel,
  elevationLabel,
  speedLabel,
  temperatureLabel,
  withUnit,
} from './units';

/**
 * The share image sheet (#45): Route image in the Export menu (the route
 * as a boarding pass) and Share image in a recorded activity. The image is
 * drawn on the device from what the page already has (the weather Weather
 * shows, the profile Elevation loaded, the activity in page memory); nothing
 * is requested for it except the map tiles of its own view, and nothing is
 * kept. Share sends it, with the route's link for a route, through the
 * system share sheet; Download saves it.
 */

const CREDIT = '© OpenStreetMap © OpenMapTiles';
const SITE_HOST = new URL(import.meta.env.SITE_URL).host;

type Mode = 'route' | 'activity';

/** A date or sentence with its first letter in capitals ("Friday, ..."). */
const capitalize = (text: string, locale: string) =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

/** The options of the sheet, as the checkboxes set them. */
interface Options {
  format: ShareFormat;
  day: boolean;
  places: boolean;
  weather: boolean;
  climbs: boolean;
  /** The activity's values, each chosen on its own (#45). */
  speed: boolean;
  hr: boolean;
  cadence: boolean;
  power: boolean;
}

export function setupShareImage(deps: {
  state: () => State;
  route: () => Route | null;
  /** The device's average speed, km/h. */
  speedKmh: () => number;
  weather: () => ShareWeather[] | null;
  profile: () => { profile: ProfilePoint[]; source: ElevationSource } | null;
  activity: () => Activity | null;
  /** The route's title: its name, else its ends' names, else Route. */
  title: () => string;
  /** A point's own name, or null for a name the app gave it. */
  placeName: (index: number) => string | null;
  /** The route's link, brought up to date. */
  link: () => string;
  fileName: (extension: 'png') => string;
  locale: () => string;
  status: (message: string) => void;
}) {
  const sheet = $<HTMLDialogElement>('share-image-dialog'),
    preview = $<HTMLImageElement>('share-image-preview'),
    busy = $('share-image-status'),
    message = $<HTMLTextAreaElement>('share-image-message'),
    shareButton = $<HTMLButtonElement>('share-image-share'),
    downloadButton = $<HTMLButtonElement>('share-image-download');
  iconControl($('share-image-close'), 'close', 'Close', true);
  const check = (id: string) => $<HTMLInputElement>(`share-image-${id}`);
  let mode: Mode = 'route',
    version = 0,
    blob: Blob | null = null,
    previewUrl = '',
    brand: Promise<Brand> | null = null;
  /** Map pictures of this opening, by view: toggles do not redraw tiles. */
  let shots = new Map<string, Promise<MapShot>>();

  const options = (): Options => ({
    format:
      document.querySelector<HTMLInputElement>(
        'input[name="share-image-format"]:checked',
      )?.value === 'story'
        ? 'story'
        : 'feed',
    day: check('day').checked,
    places: check('places').checked,
    weather: check('weather').checked && !check('weather').disabled,
    climbs: check('climbs').checked && !check('climbs').disabled,
    speed: check('speed').checked,
    hr: check('hr').checked,
    cadence: check('cadence').checked,
    power: check('power').checked,
  });

  const climbsOf = () => {
    const loaded = deps.profile();
    return loaded
      ? shareClimbs(detectClimbs(loaded.profile, loaded.source))
      : [];
  };

  /** Shows the options of the mode, enabled when their data is loaded. */
  function setMode(next: Mode) {
    mode = next;
    const route = next === 'route';
    for (const id of ['day', 'weather', 'climbs'])
      check(id).closest('label')!.hidden = !route;
    // Each recorded value of the activity has its own option.
    const channels = deps.activity()?.channels ?? {};
    const recorded = {
      speed: true,
      hr: !!channels.hr,
      cadence: !!channels.cadence,
      power: !!channels.power,
    };
    for (const [id, has] of Object.entries(recorded))
      check(id).closest('label')!.hidden = route || !has;
    message.closest('label')!.hidden = !route;
    $('share-image-places-text').textContent = route
      ? 'Start and destination'
      : 'Start and end';
    $('share-image-places-hint').textContent = route
      ? 'The meeting point and where the route ends'
      : `Hide them to keep the first and last ${HIDDEN_ENDS} m private`;
    available();
  }

  /**
   * Weather and Climbs can be shown once their data is loaded: a forecast
   * that arrives while the sheet is open turns its option on.
   */
  function available() {
    const offer = (id: string, ready: boolean) => {
      const box = check(id);
      if (box.disabled === !ready) return;
      box.disabled = !ready;
      box.checked = ready;
    };
    const weather = !!deps.weather();
    offer('weather', weather);
    $('share-image-weather-hint').textContent = weather
      ? 'The forecast Weather shows for this departure'
      : 'Open Weather with a departure to include it';
    const climbs = climbsOf().length > 0;
    offer('climbs', climbs);
    $('share-image-climbs-hint').textContent = climbs
      ? 'From the elevation profile'
      : deps.profile()
        ? 'This route has no climbs to show'
        : 'Open Elevation to include them';
  }

  function inviteData(o: Options): InviteImage | null {
    const route = deps.route();
    if (!route) return null;
    const state = deps.state();
    const locale = deps.locale(),
      units = distanceUnits();
    const departure = departureOf(state);
    const start = departure ? Date.parse(departure) : NaN;
    const clock = (time: number) =>
      new Date(time).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      });
    const loaded = deps.profile();
    const stats = loaded && elevationStats(loaded.profile, loaded.source);
    let depart: InviteImage['depart'] = null,
      arrive: InviteImage['arrive'] = null,
      date: string | null = null;
    const last = state.points.length - 1;
    if (o.day && Number.isFinite(start)) {
      const end =
        start + travelTimeSeconds(route.distance, deps.speedKmh()) * 1000;
      const days = Math.round(
        (new Date(end).setHours(0, 0, 0, 0) -
          new Date(start).setHours(0, 0, 0, 0)) /
          86_400_000,
      );
      const day = new Date(start).toLocaleDateString(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      date = capitalize(day, locale);
      depart = {
        label: t('Departure'),
        time: clock(start),
        place: o.places ? deps.placeName(0) : null,
      };
      arrive = {
        label: t('Expected arrival'),
        time: days > 0 ? `${clock(end)} (+${days})` : clock(end),
        place: o.places ? deps.placeName(last) : null,
      };
    }
    let weather: InviteImage['weather'] = null;
    const samples = o.weather ? deps.weather() : null;
    if (samples?.length) {
      const temperature = (c: number | null) =>
        temperatureLabel(c, temperatureUnits(), locale);
      const parts = weatherSummary(samples, temperature, clock).map(t);
      const summary = parts.join(', ');
      weather = {
        title: t('On the way'),
        summary: capitalize(summary, locale),
        strip: stripIndices(samples.map((s) => s.time)).map((i) => ({
          time: clock(samples[i].time),
          icon: samples[i].icon,
          temperature: temperature(samples[i].temperature),
        })),
      };
    }
    let climbs: InviteImage['climbs'] = null;
    const picked = o.climbs ? climbsOf() : [];
    if (loaded && picked.length)
      climbs = {
        title: t('Climbs'),
        profile: loaded.profile,
        marks: picked.map((c) => ({
          start: c.start,
          end: c.end,
          text: `${distanceLabel(c.length, units, locale)} · ${Math.round(c.grade).toLocaleString(locale)}%`,
        })),
      };
    const track = o.places
      ? route.segments
      : (trimEnds(route.segments) ?? route.segments);
    return {
      kicker: t('Invitation'),
      title: deps.title(),
      date,
      depart,
      arrive,
      stats: [
        {
          icon: 'route',
          label: t('Distance'),
          value: distanceLabel(route.distance, units, locale),
        },
        ...(stats
          ? [
              {
                icon: 'up' as const,
                label: t('Ascent'),
                value: elevationLabel(stats.ascent, units, locale),
              },
            ]
          : []),
        {
          icon: 'clock',
          label: t('Time'),
          value: durationLabel(
            travelTimeSeconds(route.distance, deps.speedKmh()),
          ),
        },
      ],
      weather,
      climbs,
      footer: SITE_HOST,
      track,
      points: o.places
        ? state.points.map((p) => p.coord).filter((c): c is Coord => !!c)
        : [],
      credit: CREDIT,
    };
  }

  function activityData(o: Options): ActivityImage | null {
    const activity = deps.activity();
    if (!activity) return null;
    const locale = deps.locale(),
      units = distanceUnits();
    const round = (n: number) => Math.round(n).toLocaleString(locale);
    const values: ActivityImage['values'] = [];
    const { hr, power, cadence, temperature } = activity.channels;
    if (activity.climb)
      values.push({
        icon: 'up',
        label: t('Climb'),
        value: elevationLabel(activity.climb.ascent, units, locale),
      });
    if (o.hr && hr)
      values.push({
        icon: 'heart',
        label: t('Avg. heart rate'),
        value: withUnit(round(hr.average), 'bpm'),
      });
    if (o.power && power)
      values.push({
        icon: 'power',
        label: t('Avg. power'),
        value: withUnit(round(power.average), 'W'),
      });
    if (o.cadence && cadence)
      values.push({
        icon: 'cadence',
        label: t('Avg. cadence'),
        value: withUnit(round(cadence.average), 'rpm'),
      });
    if (temperature)
      values.push({
        icon: 'thermometer',
        label: t('Avg. temperature'),
        value: temperatureLabel(
          temperature.average,
          temperatureUnits(),
          locale,
        ),
      });
    // The track and its peaks, without the hidden ends.
    const flat = activity.segments.flat();
    const total = activity.distance;
    const shown = (i: number) =>
      o.places ||
      (activity.distances[i] >= HIDDEN_ENDS &&
        activity.distances[i] <= total - HIDDEN_ENDS);
    // The track in its speed zones while Speed is shown, else in one color.
    const zones = o.speed ? activityZones(activity, 'activity-speed') : null;
    const colors = ZONES.map((kind) => coloringColor(kind));
    const plain = token('--color-primary');
    const pieces: ActivityImage['pieces'] = [];
    let index = 0;
    for (const segment of activity.segments) {
      let piece = null as { coords: Coord[]; color: string } | null;
      for (let k = 0; k < segment.length; k++, index++) {
        if (!shown(index)) {
          piece = null;
          continue;
        }
        const v = zones?.series[index] ?? null;
        const color =
          zones?.limits && v !== null
            ? colors[zones.limits.filter((limit) => v >= limit).length]
            : plain;
        if (!piece || piece.color !== color) {
          const previous: Coord | undefined = piece?.coords.at(-1);
          piece = { coords: previous ? [previous] : [], color };
          pieces.push(piece);
        }
        piece.coords.push(segment[k]);
      }
    }
    const peakColor = (kind: string) =>
      classVariable(`activity-peak-${kind}`, '--extreme');
    const peaks: ActivityImage['peaks'] = [];
    for (const peak of activity.peaks) {
      if (
        peak.kind === 'speed'
          ? !o.speed
          : peak.kind === 'hr'
            ? !o.hr
            : peak.kind !== 'altitude'
      )
        continue;
      const i = activity.times.indexOf(peak.time);
      if (i < 0 || !shown(i)) continue;
      peaks.push({
        coord: flat[i],
        icon:
          peak.kind === 'speed'
            ? 'speed'
            : peak.kind === 'hr'
              ? 'heart'
              : 'summit',
        text:
          peak.kind === 'speed'
            ? speedLabel(peak.value, units, locale)
            : peak.kind === 'hr'
              ? withUnit(round(peak.value), 'bpm')
              : elevationLabel(peak.value, units, locale),
        color: peakColor(peak.kind),
      });
    }
    const number = (v: number) => v.toLocaleString(locale);
    // Time in each zone of every value chosen: speed, heart rate, cadence
    // and power, in that order.
    const bars: ActivityImage['zones'] = [];
    const ids = [
      ...(o.speed ? (['activity-speed'] as const) : []),
      ...(o.hr ? (['activity-hr'] as const) : []),
      ...(o.cadence ? (['activity-cadence'] as const) : []),
      ...(o.power ? (['activity-power'] as const) : []),
    ];
    for (const id of ids) {
      const found = activityZones(activity, id);
      const limits = found?.limits;
      const shares = limits && zoneShares(activity, found.series, limits);
      if (!found || !limits || !shares) continue;
      bars.push({
        title: t(found.label),
        note: `${t('time in each band')}, ${found.unit}`,
        colors,
        shares,
        labels: ZONES.map((_, i) =>
          i === 0
            ? `< ${number(limits[0])}`
            : i === 4
              ? `> ${number(limits[3])}`
              : `${number(limits[i - 1])}–${number(limits[i])}`,
        ),
      });
    }
    const start = new Date(activity.start).toLocaleString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return {
      title: activity.name || t('Recorded activity'),
      date: capitalize(start, locale),
      stats: [
        {
          icon: 'route',
          label: t('Distance'),
          value: distanceLabel(activity.distance, units, locale),
        },
        {
          icon: 'clock',
          label: t('Moving time'),
          value: durationLabel(activity.moving / 1000),
        },
        {
          icon: 'speed',
          label: t('Average speed'),
          value: speedLabel(activity.averageSpeed, units, locale),
        },
      ],
      values: values.slice(0, 3),
      zones: bars,
      pieces,
      peaks,
      footer: SITE_HOST,
      credit: CREDIT,
    };
  }

  /** The base map for a view, drawn once per opening of the sheet. */
  function shot(
    coords: Coord[],
    width: number,
    height: number,
    pad: { top: number; side: number; bottom: number },
  ): Promise<MapShot> {
    const key = [
      mode,
      coords.length,
      coords[0],
      coords.at(-1),
      width,
      height,
      pad.top,
    ].join();
    let found = shots.get(key);
    if (!found) {
      found = mapShot(coords, width, height, MAP_SCALE, pad);
      shots.set(key, found);
    }
    return found;
  }

  async function draw(o: Options): Promise<Blob | null> {
    brand ??= Promise.all([loadImage(markUrl), loadImage(wordmarkUrl)]).then(
      ([mark, wordmark]) => ({ mark, wordmark }),
    );
    const [W, H] = SHARE_SIZE[o.format];
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (mode === 'route') {
      const data = inviteData(o);
      if (!data) return null;
      const coords = data.track.flat();
      const side = 30;
      await drawInvite(
        ctx,
        data,
        o.format,
        (w, h) => shot(coords, w, h, { top: side, side, bottom: side }),
        await brand,
      );
    } else {
      const data = activityData(o);
      if (!data) return null;
      const coords = data.pieces.flatMap((p) => p.coords);
      if (!coords.length) return null;
      await drawActivity(
        ctx,
        data,
        o.format,
        (w, h, pad) => shot(coords, w, h, pad),
        await brand,
      );
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  /** Draws the image again for the current options; the latest one wins. */
  async function render() {
    const mine = ++version;
    if (mode === 'route') available();
    blob = null;
    shareButton.disabled = downloadButton.disabled = true;
    busy.textContent = t('Making the image…');
    const made = await draw(options()).catch(() => null);
    if (mine !== version) return;
    blob = made;
    busy.textContent = made ? '' : t('The image could not be made.');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = made ? URL.createObjectURL(made) : '';
    preview.hidden = !made;
    if (made) preview.src = previewUrl;
    shareButton.disabled = downloadButton.disabled = !made;
  }

  function defaultMessage(): string {
    const state = deps.state(),
      route = deps.route();
    const locale = deps.locale();
    const lines = [deps.title()];
    const departure = departureOf(state);
    if (departure)
      lines.push(
        new Date(Date.parse(departure)).toLocaleString(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    if (route)
      lines.push(distanceLabel(route.distance, distanceUnits(), locale));
    lines.push(deps.link());
    return lines.join('\n');
  }

  async function send(share: boolean) {
    if (!blob) return;
    const name =
      mode === 'route'
        ? deps.fileName('png')
        : filename([], deps.activity()?.name || 'activity', 'png');
    const text = mode === 'route' ? message.value.trim() : '';
    const result = await exportFile(blob, name, {
      share,
      types: PNG_TYPES,
      downloadType: PNG_DOWNLOAD,
      ...(text ? { text } : {}),
    });
    if (result === 'downloaded') deps.status(t('Image downloaded.'));
    if (result !== 'cancelled') sheet.close();
  }

  sheet.addEventListener('change', (event) => {
    if ((event.target as HTMLElement).id !== 'share-image-message')
      void render();
  });
  shareButton.onclick = () => void send(true);
  downloadButton.onclick = () => void send(false);
  $('share-image-close').onclick = () => sheet.close();
  sheet.addEventListener('close', () => {
    version++;
    shots = new Map();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    preview.removeAttribute('src');
  });

  return {
    /** Opens the sheet for the route shown or the open activity. */
    open(next: Mode) {
      setMode(next);
      if (next === 'route') message.value = defaultMessage();
      preview.hidden = true;
      sheet.showModal();
      void render();
    },
  };
}
