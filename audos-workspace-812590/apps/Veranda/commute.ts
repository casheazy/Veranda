/**
 * Veranda — Commute Intelligence data layer.
 *
 * Live Google Routes measurements remain the preferred source. When that
 * provider is unavailable, this module returns a clearly labelled, area-level
 * Lagos public-transit advisory so renters still get useful boarding,
 * transfer and alighting guidance instead of an empty card.
 *
 * PIPELINE (runs PLATFORM-SIDE, not in the browser bundle):
 *   1. HOOK (server function): `veranda-measure-commutes`
 *      - id: 31690a4c-3347-480b-9e39-c25de9156839
 *      - Calls the Google Routes API v2 through the BYOK secrets proxy
 *        (`{{secrets.GOOGLE_MAPS_API_KEY}}`, allowed host
 *        routes.googleapis.com). The founder owns the key; app code and the
 *        browser never see it.
 *      - Mode `measure-areas` (scheduled): seeds + measures the baseline
 *        matrix in the `area_commutes` table — 23 covered areas × 4 common
 *        work hubs (Lagos Island/Marina, Victoria Island, Ikeja, Lekki
 *        Phase 1), transit first plus driving fallback, departing next
 *        weekday 07:30 Africa/Lagos for rush-hour realism. Rows refresh after
 *        7 days.
 *      - Modes `measure-listing` and `measure-address` calculate exact routes
 *        from catalog listings or typed property addresses respectively. The
 *        latter caches in `address_commute_routes`. Deduped per
 *        (listing, destination), max 6 destinations per listing, global cap
 *        of 150 measurements/24h — a public caller cannot burn the
 *        founder's Google quota.
 *      - NO KEY, NO NUMBERS: while GOOGLE_MAPS_API_KEY is missing the hook
 *        reports blocked: 'unknown_secret', rows stay 'pending' and every
 *        card stays gray.
 *      - STILL UNMEASURED as of 2026-08-05. The secret exists and the proxy
 *        does forward it to routes.googleapis.com, but Google refuses the
 *        call with PERMISSION_DENIED / API_KEY_SERVICE_BLOCKED, so all 102
 *        rows across commute_routes, area_commutes and address_commute_routes
 *        are 'pending' and no card has ever shown a measured number. The fix
 *        is founder-side: add Routes API to the key's API restrictions in
 *        Google Cloud Console (project 23743393754). No app change helps.
 *   2. SCHEDULES (task-scheduler), all daily Africa/Lagos, payload
 *      { mode: 'measure-areas', limit: 20 }:
 *      - "Veranda commute baseline measurement (morning)"
 *        id: f78ff040-97ae-4e80-a756-72ee1472e06c — 05:40
 *      - "Veranda commute baseline measurement (midday)"
 *        id: a9c56b95-69dc-4ed1-b0cf-a310bb335629 — 11:40
 *      - "Veranda commute baseline measurement (evening)"
 *        id: 3fabe0eb-038e-40cf-924c-f843d544883f — 17:40
 *      Three runs/day × 20 routes fills the 92-row matrix in ~2 days once
 *      the key lands, then most runs are cheap no-ops (weekly refresh).
 *
 * DESTINATION CAPTURE (renter_destinations snapshots — see account.ts):
 *   - A destination is ANY place the renter commutes to (office, school,
 *     market, church, family), saved with a short renter-chosen label
 *     ("Work", "School", "Mum's place"). Up to MAX_COMMUTE_DESTINATIONS per
 *     account; the ACTIVE one is what the report card routes to, switchable
 *     right on the card.
 *   - Account page "Commute destinations" card (AccountPage.tsx) — add,
 *     edit, remove or switch destinations any time while signed in.
 *   - The gray commute card on any unlocked report (ReportView.tsx) —
 *     first-time capture in context.
 *   All persist via saveDestinationState() in account.ts — insert-only
 *   snapshots (row UPDATES are session-scoped and silently miss rows created
 *   on another device; that was the old "could not save your workplace" bug).
 *   The legacy renter_accounts.work_destination column is kept mirrored to
 *   the active destination, best-effort, for anything still reading it.
 *
 * CLIENT RESOLUTION ORDER (resolveCommute below):
 *   1. Exact measured route for THIS listing + the renter's saved work
 *      destination (commute_routes).
 *   2. Area baseline: the renter's destination matched to one of the four
 *      hubs → the measured area→hub route (area_commutes), clearly labelled
 *      as measured from a central point of the area.
 *   3. Nothing measured → area-level Lagos transit advisory, while the caller
 *      fires requestListingMeasurement() in the background so a live route can
 *      replace the advisory once the provider is healthy.
 */

import { asArray, areaName, detectAreaKey } from './types';
import type { Listing } from './types';
import { WORKSPACE_ID } from './account';

export type LagosTransitMode =
  | 'walk'
  | 'brt'
  | 'bus'
  | 'danfo'
  | 'keke'
  | 'ferry'
  | 'rail'
  | 'drive'
  | 'transit';

export interface CommuteStep {
  instruction: string;
  line?: string | null;
  distance?: string | null;
  duration?: string | null;
  /** Local mode emitted by the routing hook for compact Lagos mode badges. */
  mode?: LagosTransitMode | null;
}

export interface CommutePayload {
  driveMinutes: number;
  destination: string | null;
  /** Door-to-door distance of the primary transit route, or drive fallback. */
  distanceKm?: number | null;
  routes: Array<{
    mode: 'driving' | 'transit';
    minutes: number;
    distanceKm?: number | null;
    steps: CommuteStep[];
  }>;
  /** e.g. 'typical weekday 7:30am Lagos conditions'. */
  trafficLabel?: string;
  /** Honest provenance line rendered under the headline. */
  measuredNote?: string;
  /** True for area-level Lagos guidance used while the live provider is down. */
  isFallback?: boolean;
}

/** Row shape of the `commute_routes` table (exact per-listing measurements). */
export interface CommuteRouteRow {
  id: number;
  listing_id: number;
  origin_address?: string | null;
  destination?: string | null;
  drive_minutes?: number | null;
  driving_steps?: CommuteStep[] | string | null;
  transit_minutes?: number | null;
  transit_steps?: CommuteStep[] | string | null;
  traffic_observed_at?: string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Row shape of the `area_commutes` table (area→hub baselines). */
export interface AreaCommuteRow {
  id: number;
  area_key?: string | null;
  hub_key?: string | null;
  origin_label?: string | null;
  destination?: string | null;
  drive_minutes?: number | null;
  driving_steps?: CommuteStep[] | string | null;
  transit_minutes?: number | null;
  transit_steps?: CommuteStep[] | string | null;
  status?: string | null;
  measured_at?: string | null;
}

const TRAFFIC_LABEL = 'typical weekday 7:30am Lagos conditions';

// ---------------------------------------------------------------------------
// Work-hub matching — maps a free-typed work destination to a measured hub
// ---------------------------------------------------------------------------

export interface WorkHub {
  key: 'lagos-island' | 'victoria-island' | 'ikeja' | 'lekki';
  label: string;
}

/** Order matters: 'victoria island' must win before the generic 'island'. */
const HUB_MATCHERS: Array<WorkHub & { re: RegExp }> = [
  {
    key: 'victoria-island',
    label: 'Victoria Island',
    re: /victoria\s*island|\bv\.?\s*i\.?\b|oniru|adeola\s+odeku|ahmadu\s+bello|eko\s+atlantic|kofo\s+abayomi|ozumba/i,
  },
  {
    key: 'lagos-island',
    label: 'Lagos Island / Marina',
    re: /lagos\s*island|marina|broad\s+st|\bcms\b|obalende|idumota|balogun|tinubu|onikan|\btbs\b/i,
  },
  {
    key: 'lekki',
    label: 'Lekki Phase 1',
    re: /lekki|admiralty|freedom\s+way|\bikate\b/i,
  },
  {
    key: 'ikeja',
    label: 'Ikeja',
    re: /ikeja|alausa|\ballen\b|opebi|oregun|\bogba\b|computer\s+village|agidingbi|airport|\bmm2\b/i,
  },
];

export function matchWorkHub(destination?: string | null): WorkHub | null {
  const text = (destination || '').trim();
  if (!text) return null;
  const found = HUB_MATCHERS.find((h) => h.re.test(text));
  return found ? { key: found.key, label: found.label } : null;
}

// ---------------------------------------------------------------------------
// Lagos public-transit fallback
// ---------------------------------------------------------------------------

interface TransitAreaGuide {
  label: string;
  boarding: string;
  interchange: string;
  trunkMode: 'brt' | 'danfo' | 'bus' | 'rail' | 'ferry';
  baseMinutes: number;
}

/**
 * Area-level knowledge used only when live Google Routes cannot answer. These
 * are established Lagos boarding/interchange landmarks, not live schedules or
 * guaranteed vehicle lines. The card labels the result accordingly and tells
 * renters to confirm the final stop and fare locally.
 */
const TRANSIT_AREA_GUIDES: Record<string, TransitAreaGuide> = {
  'victoria-island': { label: 'Victoria Island', boarding: 'Bonny Camp bus stop', interchange: 'Obalende', trunkMode: 'danfo', baseMinutes: 25 },
  ikoyi: { label: 'Ikoyi', boarding: 'Falomo bus stop', interchange: 'Obalende', trunkMode: 'danfo', baseMinutes: 25 },
  lekki: { label: 'Lekki Phase 1', boarding: 'Marwa bus stop', interchange: 'Obalende', trunkMode: 'brt', baseMinutes: 35 },
  chevron: { label: 'Chevron / Lekki corridor', boarding: 'Chevron Drive junction', interchange: 'Lekki Phase 1 / Marwa', trunkMode: 'danfo', baseMinutes: 45 },
  ajah: { label: 'Ajah', boarding: 'Ajah Under Bridge', interchange: 'Lekki Phase 1 / Marwa', trunkMode: 'brt', baseMinutes: 55 },
  sangotedo: { label: 'Sangotedo', boarding: 'Sangotedo bus stop by Novare Mall', interchange: 'Ajah Under Bridge', trunkMode: 'danfo', baseMinutes: 70 },
  epe: { label: 'Epe', boarding: 'Epe T-junction motor park', interchange: 'Ajah Under Bridge', trunkMode: 'bus', baseMinutes: 105 },
  surulere: { label: 'Surulere', boarding: 'Ojuelegba Under Bridge', interchange: 'CMS / Marina', trunkMode: 'danfo', baseMinutes: 45 },
  yaba: { label: 'Yaba', boarding: 'Yaba Bus Terminal', interchange: 'Oyingbo / CMS', trunkMode: 'brt', baseMinutes: 40 },
  gbagada: { label: 'Gbagada', boarding: 'Gbagada / Ifako bus stop', interchange: 'Ketu / Mile 12', trunkMode: 'danfo', baseMinutes: 45 },
  shomolu: { label: 'Shomolu', boarding: 'Palmgrove bus stop', interchange: 'Yaba Bus Terminal', trunkMode: 'danfo', baseMinutes: 40 },
  maryland: { label: 'Maryland', boarding: 'Maryland Mall bus stop', interchange: 'Oshodi Transport Interchange', trunkMode: 'brt', baseMinutes: 40 },
  mushin: { label: 'Mushin', boarding: 'Ojuwoye Market bus stop', interchange: 'Oshodi Transport Interchange', trunkMode: 'danfo', baseMinutes: 45 },
  oshodi: { label: 'Oshodi', boarding: 'Oshodi Transport Interchange', interchange: 'Oshodi Transport Interchange', trunkMode: 'brt', baseMinutes: 30 },
  isolo: { label: 'Isolo', boarding: 'Cele Express bus stop', interchange: 'Oshodi Transport Interchange', trunkMode: 'danfo', baseMinutes: 45 },
  festac: { label: 'Festac', boarding: 'Mile 2 BRT terminal', interchange: 'CMS / Marina', trunkMode: 'brt', baseMinutes: 60 },
  ikeja: { label: 'Ikeja', boarding: 'Ikeja Under Bridge', interchange: 'Oshodi Transport Interchange', trunkMode: 'brt', baseMinutes: 35 },
  magodo: { label: 'Magodo', boarding: 'CMD Road / Shangisha bus stop', interchange: 'Ketu / Mile 12', trunkMode: 'danfo', baseMinutes: 45 },
  ojodu: { label: 'Ojodu Berger', boarding: 'Berger bus terminal', interchange: 'Ikeja Along', trunkMode: 'brt', baseMinutes: 50 },
  ketu: { label: 'Ketu', boarding: 'Mile 12 BRT terminal', interchange: 'Oshodi / CMS corridor', trunkMode: 'brt', baseMinutes: 45 },
  agege: { label: 'Agege', boarding: 'Pen Cinema transport hub', interchange: 'Ikeja Along', trunkMode: 'danfo', baseMinutes: 50 },
  alimosho: { label: 'Alimosho', boarding: 'Egbeda bus stop', interchange: 'Ikeja / Oshodi corridor', trunkMode: 'danfo', baseMinutes: 65 },
  ikorodu: { label: 'Ikorodu', boarding: 'Ikorodu Garage', interchange: 'Mile 12 BRT terminal', trunkMode: 'brt', baseMinutes: 80 },
};

const HUB_TRANSIT_TARGETS: Record<WorkHub['key'], { gateway: string; alighting: string; mode: 'brt' | 'danfo' | 'bus' }> = {
  'lagos-island': { gateway: 'CMS BRT terminal', alighting: 'CMS / Marina', mode: 'brt' },
  'victoria-island': { gateway: 'Obalende', alighting: 'Bonny Camp or the closest named VI bus stop', mode: 'danfo' },
  ikeja: { gateway: 'Oshodi Transport Interchange', alighting: 'Ikeja Under Bridge', mode: 'brt' },
  lekki: { gateway: 'Obalende', alighting: 'Marwa bus stop, Lekki Phase 1', mode: 'brt' },
};

function modeName(mode: LagosTransitMode): string {
  if (mode === 'brt') return 'BRT';
  if (mode === 'danfo') return 'Danfo';
  if (mode === 'keke') return 'Keke';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function fallbackTarget(destination: string): {
  label: string;
  gateway: string;
  alighting: string;
  mode: 'brt' | 'danfo' | 'bus';
  areaGuide?: TransitAreaGuide;
} {
  const key = detectAreaKey(destination);
  const guide = key ? TRANSIT_AREA_GUIDES[key] : null;
  if (guide) {
    return {
      label: destination,
      gateway: guide.interchange,
      alighting: guide.boarding,
      mode: guide.trunkMode === 'brt' ? 'brt' : guide.trunkMode === 'bus' ? 'bus' : 'danfo',
      areaGuide: guide,
    };
  }
  const hub = matchWorkHub(destination);
  if (hub) return { label: destination, ...HUB_TRANSIT_TARGETS[hub.key] };
  return {
    label: destination,
    gateway: 'the nearest major bus interchange serving the destination',
    alighting: 'the closest named bus stop to the saved destination',
    mode: 'danfo',
  };
}

function buildLagosTransitFallback(
  originAreaKey: string | null | undefined,
  originAddress: string | null | undefined,
  destination: string
): CommutePayload {
  const detectedOrigin = originAreaKey || detectAreaKey(originAddress || '') || '';
  const origin = TRANSIT_AREA_GUIDES[detectedOrigin] || {
    label: areaName(detectedOrigin) || 'the property area',
    boarding: 'the nearest signed bus stop on the main road',
    interchange: 'the nearest major Lagos transport interchange',
    trunkMode: 'danfo' as const,
    baseMinutes: 55,
  };
  const target = fallbackTarget(destination);
  const sameArea = Boolean(target.areaGuide && target.areaGuide.label === origin.label);
  const minutes = sameArea
    ? Math.max(25, Math.round(origin.baseMinutes * 0.6))
    : Math.min(150, origin.baseMinutes + (target.areaGuide?.baseMinutes || 30));
  const transferMode: 'brt' | 'danfo' | 'bus' = target.mode;
  const finalStop = sameArea ? 'the closest named bus stop to the saved destination' : target.alighting;
  const steps: CommuteStep[] = [
    {
      instruction: `From ${originAddress || origin.label}, take a short Keke or walk to ${origin.boarding}. Ask for the correct loading point before joining a queue.`,
      line: `First mile to ${origin.boarding}`,
      duration: 'Allow 5–15 min',
      mode: 'keke',
    },
  ];
  if (sameArea) {
    steps.push({
      instruction: `Board a local Danfo or Keke at ${origin.boarding} heading toward ${destination}. Ask the driver for the closest named stop and agree the fare before moving.`,
      line: `${origin.boarding} → ${destination}`,
      duration: 'Traffic-dependent',
      mode: 'danfo',
    });
  } else {
    steps.push({
      instruction: `Board a ${modeName(origin.trunkMode)} at ${origin.boarding} and tell the conductor you are alighting at ${origin.interchange}. Confirm the stop and fare before boarding.`,
      line: `${origin.boarding} → ${origin.interchange}`,
      duration: 'Traffic-dependent',
      mode: origin.trunkMode,
    });
    if (origin.interchange !== target.gateway) {
      steps.push({
        instruction: `At ${origin.interchange}, transfer to a ${modeName(transferMode)} serving ${target.gateway}. Ask for ${target.alighting} as your alighting stop.`,
        line: `${origin.interchange} → ${target.gateway}`,
        duration: 'Allow time for loading and traffic',
        mode: transferMode,
      });
    }
  }
  steps.push(
    {
      instruction: `Alight at ${finalStop}. Do not stay aboard past this stop; confirm with the conductor as you approach.`,
      line: `Alighting point for ${target.label}`,
      duration: null,
      mode: 'transit',
    },
    {
      instruction: `Finish by Keke or on foot from ${finalStop} to ${destination}. Show the saved address to the rider and agree the fare before moving.`,
      line: `Last mile to ${destination}`,
      duration: 'Allow 5–15 min',
      mode: 'keke',
    }
  );
  return {
    driveMinutes: minutes,
    destination,
    distanceKm: null,
    routes: [{ mode: 'transit', minutes, distanceKm: null, steps }],
    trafficLabel: 'Lagos transit advisory · estimated weekday journey, not live traffic',
    measuredNote:
      'Live route data is unavailable, so this is an area-level Lagos transit advisory using established boarding points and interchanges. Routes, fares and stops can change — confirm with the conductor before boarding.',
    isFallback: true,
  };
}

const fallbackByListingId = new Map<number, CommutePayload>();

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function distanceFromSteps(steps: CommuteStep[]): number | null {
  let metres = 0;
  let found = false;
  for (const step of steps) {
    const match = (step.distance || '').replace(/,/g, '').match(/([\d.]+)\s*(km|m)\b/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    metres += match[2].toLowerCase() === 'km' ? value * 1000 : value;
    found = true;
  }
  return found ? Math.round((metres / 1000) * 10) / 10 : null;
}

function buildRoutes(row: {
  drive_minutes?: number | null;
  driving_steps?: CommuteStep[] | string | null;
  transit_minutes?: number | null;
  transit_steps?: CommuteStep[] | string | null;
}): CommutePayload['routes'] {
  const drivingSteps = asArray<CommuteStep>(row.driving_steps);
  const transitSteps = asArray<CommuteStep>(row.transit_steps);
  const routes: CommutePayload['routes'] = [];
  // Public transit is the primary experience. Driving remains a useful Lagos
  // coverage fallback and comparison, but never leads when transit exists.
  if (row.transit_minutes != null) {
    routes.push({
      mode: 'transit',
      minutes: row.transit_minutes,
      distanceKm: distanceFromSteps(transitSteps),
      steps: transitSteps,
    });
  }
  routes.push({
    mode: 'driving',
    minutes: row.drive_minutes as number,
    distanceKm: distanceFromSteps(drivingSteps),
    steps: drivingSteps,
  });
  return routes;
}

function fromListingRoute(row: CommuteRouteRow): CommutePayload {
  const when = shortDate(row.traffic_observed_at);
  const routes = buildRoutes(row);
  return {
    driveMinutes: row.drive_minutes as number,
    destination: row.destination || null,
    distanceKm:
      routes.find((route) => route.mode === 'transit')?.distanceKm ??
      routes.find((route) => route.mode === 'driving')?.distanceKm ??
      null,
    routes,
    trafficLabel: TRAFFIC_LABEL,
    measuredNote: `Door-to-door route from this home's address to ${row.destination}, departing at 7:30am on a typical Lagos weekday${when ? ` · updated ${when}` : ''}.`,
  };
}

function fromAreaRoute(row: AreaCommuteRow): CommutePayload {
  const when = shortDate(row.measured_at);
  const origin = row.origin_label || `the centre of ${areaName(row.area_key)}`;
  const routes = buildRoutes(row);
  return {
    driveMinutes: row.drive_minutes as number,
    destination: row.destination || null,
    distanceKm:
      routes.find((route) => route.mode === 'transit')?.distanceKm ??
      routes.find((route) => route.mode === 'driving')?.distanceKm ??
      null,
    routes,
    trafficLabel: TRAFFIC_LABEL,
    measuredNote:
      `7:30am weekday route from ${origin} to ${row.destination} — ` +
      `door-to-door time from this exact address may vary within the area` +
      `${when ? `. Updated ${when}` : ''}.`,
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function normDest(s?: string | null): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface CommuteResolution {
  payload: CommutePayload | null;
  /**
   * True when no exact measurement for this destination exists yet. The card
   * may still be backed by an area-level Lagos advisory while this request runs.
   */
  shouldRequestExact: boolean;
}

export function resolveCommute(
  listing: Listing,
  workDestination: string | null | undefined,
  listingRoutes: CommuteRouteRow[] | undefined,
  areaRoutes: AreaCommuteRow[] | undefined
): CommuteResolution {
  const dest = normDest(workDestination);
  if (!dest) return { payload: null, shouldRequestExact: false };

  // 1 · exact measured route for this listing + this destination
  const exact = (listingRoutes || []).find(
    (r) => r.status === 'measured' && r.drive_minutes != null && normDest(r.destination) === dest
  );
  if (exact) return { payload: fromListingRoute(exact), shouldRequestExact: false };

  // 2 · area baseline for the hub this destination maps to
  const hub = matchWorkHub(workDestination);
  if (hub) {
    const row = (areaRoutes || []).find(
      (r) => r.hub_key === hub.key && r.status === 'measured' && r.drive_minutes != null
    );
    if (row) return { payload: fromAreaRoute(row), shouldRequestExact: false };
  }

  // 3 · nothing measured. Keep requesting an exact route in the background,
  // but render useful Lagos transit guidance immediately. This avoids making
  // provider configuration a customer-facing dead end.
  const fallback = buildLagosTransitFallback(
    listing.area_key,
    listing.address || listing.neighborhood || listing.title,
    workDestination as string
  );
  fallbackByListingId.set(listing.id, fallback);
  return { payload: fallback, shouldRequestExact: true };
}

// ---------------------------------------------------------------------------
// On-demand measurement trigger (fire-and-forget)
// ---------------------------------------------------------------------------

const requestedThisSession = new Set<string>();

/**
 * Ask the platform hook to measure one listing→destination route. Safe to
 * call optimistically: the hook dedupes, rate-caps, and leaves the row
 * pending (card stays gray) if the routing key is missing.
 */
export interface CommuteMeasurementRequestResult {
  ok: boolean;
  status: number;
  result?: string;
  commute?: CommutePayload | null;
  code?: string;
  message?: string;
}

async function requestMeasurement(
  key: string,
  body: Record<string, unknown>,
  force = false
): Promise<CommuteMeasurementRequestResult> {
  if (!force && requestedThisSession.has(key)) {
    return { ok: true, status: 202, result: 'already-requested' };
  }
  requestedThisSession.add(key);
  try {
    const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/hooks/veranda-measure-commutes/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    const ok = response.ok && data?.result !== 'blocked' && data?.result !== 'error';
    if (!ok || data?.result === 'unavailable') requestedThisSession.delete(key);
    if (!ok || data?.result === 'unavailable') {
      console.error('[Veranda Commute Intelligence] live route request failed', {
        status: response.status,
        result: data?.result,
        code: data?.blocked || data?.code,
        message: data?.error || data?.message,
        providerLogs: data?._meta?.logs,
      });
    }
    return {
      ok,
      status: response.status,
      result: data?.result,
      commute: data?.commute || null,
      code: data?.blocked || data?.code,
      message: data?.error || data?.message,
    };
  } catch (error) {
    requestedThisSession.delete(key);
    console.error('[Veranda Commute Intelligence] route request network error', error);
    return {
      ok: false,
      status: 0,
      result: 'network-error',
      message: error instanceof Error ? error.message : 'Commute route request failed',
    };
  }
}

export async function requestListingMeasurement(
  listingId: number,
  destination: string,
  force = false
): Promise<CommuteMeasurementRequestResult> {
  const key = `listing:${listingId}::${normDest(destination)}`;
  const result = await requestMeasurement(
    key,
    { mode: 'measure-listing', listingId, destination },
    force
  );
  const fallback = fallbackByListingId.get(listingId);
  if (result.commute || !fallback) return result;
  return {
    ...result,
    ok: true,
    result: 'lagos-transit-fallback',
    commute: fallback,
  };
}

/** Exact route for a typed-address report (which has no listings-table id). */
export async function requestAddressMeasurement(
  origin: string,
  destination: string,
  force = false
): Promise<CommuteMeasurementRequestResult> {
  const key = `address:${normDest(origin)}::${normDest(destination)}`;
  const result = await requestMeasurement(
    key,
    { mode: 'measure-address', origin, destination },
    force
  );
  if (result.commute) return result;
  return {
    ...result,
    ok: true,
    result: 'lagos-transit-fallback',
    commute: buildLagosTransitFallback(detectAreaKey(origin), origin, destination),
  };
}

// ---------------------------------------------------------------------------
// Destination address autocomplete (DestinationEditor in ReportView.tsx,
// reused by the Account page's "Commute destinations" card)
//
// As the renter types a destination address the editor offers real Lagos
// address suggestions to tap — no full manual typing, no typos. PROVIDERS,
// in order:
//   1. Google Places Autocomplete (New) through the platform secrets proxy
//      using the founder's GOOGLE_MAPS_API_KEY (the same BYOK key the commute
//      hook uses for routes.googleapis.com). TWO independent settings gate
//      it, and both were still unmet when last checked (2026-08-05): the
//      Audos secret must allow-list places.googleapis.com (today it lists
//      only routes.googleapis.com, so the proxy answers `host_not_allowed`),
//      AND the key's API restrictions in Google Cloud Console must include
//      Places API (New). The request and response shapes below already match
//      Google's documented Autocomplete (New) contract, so suggestions
//      upgrade automatically once both land — no code change. One refusal
//      disables the probe for the rest of the session.
//   2. OpenStreetMap Nominatim — no key needed, CORS-open, restricted to
//      Nigeria and bounded to the Lagos box (lat 6.3–6.7, lng 3.1–3.6).
//      This is the provider actually serving suggestions today (verified
//      2026-08-05: real results for e.g. "Adeola Odeku").
// The caller debounces (~300ms, min 3 chars); this module never fires a
// request per keystroke on its own. Suggestions are an accelerator, never a
// gate: free-typed area names keep working exactly as before.
// ---------------------------------------------------------------------------

const LAGOS_CENTER = { latitude: 6.5244, longitude: 3.3792 };
/** Nominatim viewbox — left,top,right,bottom of the Lagos bounding box. */
const LAGOS_VIEWBOX = '3.1,6.7,3.6,6.3';
const MAX_SUGGESTIONS = 6;
/** Matches the address length limit in account.ts's validateDestinationState. */
const MAX_SUGGESTION_LENGTH = 160;

/** Set after the secrets proxy refuses (host not allow-listed / key missing)
 * so a session probes Google Places at most once, not on every lookup. */
let googlePlacesUnavailable = false;

/** Keep a suggestion under the saveable length by dropping trailing segments. */
function clampSuggestion(text: string): string {
  let out = text.trim();
  while (out.length > MAX_SUGGESTION_LENGTH && out.includes(',')) {
    out = out.slice(0, out.lastIndexOf(',')).trim();
  }
  return out.length > MAX_SUGGESTION_LENGTH ? '' : out;
}

function dedupeSuggestions(list: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = clampSuggestion(item || '');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Google Places (New) autocomplete via the secrets proxy. Returns null when
 * the provider is unavailable so the caller can fall back to Nominatim. */
async function googlePlacesSuggestions(
  input: string,
  signal?: AbortSignal
): Promise<string[] | null> {
  if (googlePlacesUnavailable) return null;
  const token = (window as any).__workspaceDb?.token;
  if (!token) return null;
  try {
    const res = await fetch(`/api/workspaces/${WORKSPACE_ID}/secrets/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      signal,
      body: JSON.stringify({
        method: 'POST',
        url: 'https://places.googleapis.com/v1/places:autocomplete',
        headers: { 'X-Goog-Api-Key': '{{secrets.GOOGLE_MAPS_API_KEY}}' },
        json: {
          input,
          includedRegionCodes: ['NG'],
          locationBias: { circle: { center: LAGOS_CENTER, radius: 50000 } },
        },
      }),
    });
    const data = await res.json().catch(() => null);
    // Proxy refusal (host_not_allowed / unknown secret) or an upstream
    // auth/quota failure — stop probing Google for the rest of the session.
    if (!res.ok || !data || data.status !== 200) {
      googlePlacesUnavailable = true;
      return null;
    }
    const suggestions = Array.isArray(data.body?.suggestions) ? data.body.suggestions : [];
    return dedupeSuggestions(
      suggestions.map((s: any) => s?.placePrediction?.text?.text as string | undefined)
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null; // network hiccup — let Nominatim answer
  }
}

/** OpenStreetMap Nominatim, Lagos-bounded. The no-key fallback that works today. */
async function nominatimSuggestions(input: string, signal?: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: input,
    countrycodes: 'ng',
    viewbox: LAGOS_VIEWBOX,
    bounded: '1',
    limit: String(MAX_SUGGESTIONS),
    addressdetails: '0',
  });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows)) return [];
    return dedupeSuggestions(
      rows.map((row: any) => {
        const name = (row?.display_name || '') as string;
        // Drop the trailing postcode + country ("…, 101241, Nigeria") — noise
        // in a Lagos-only picker, and it keeps suggestions comfortably inside
        // the 160-character save limit.
        return name
          .split(',')
          .map((part: string) => part.trim())
          .filter((part: string) => part && part !== 'Nigeria' && !/^\d{5,6}$/.test(part))
          .join(', ');
      })
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    return [];
  }
}

/**
 * Lagos-biased address suggestions for the destination editor. Tries Google
 * Places (founder's key via the secrets proxy) first and falls back to
 * OpenStreetMap Nominatim. Returns [] when neither has a match. Rethrows
 * AbortError so a superseded lookup never paints stale suggestions.
 */
export async function fetchDestinationSuggestions(
  input: string,
  signal?: AbortSignal
): Promise<string[]> {
  const query = input.trim();
  if (query.length < 3) return [];
  const google = await googlePlacesSuggestions(query, signal);
  if (google && google.length > 0) return google;
  return nominatimSuggestions(query, signal);
}
