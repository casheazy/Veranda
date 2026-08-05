/**
 * Veranda — commute ("Distance to work") data layer.
 *
 * The report card in ReportView.tsx only ever renders REAL measured routes;
 * this module decides which measurement (if any) backs the card for a given
 * listing + renter. Nothing here invents a drive time — when no measurement
 * exists the card keeps its honest gray "Improving" state.
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
 * DESTINATION CAPTURE (renter_accounts.work_destination):
 *   - Account page "Commute destination" card (AccountPage.tsx) — set or
 *     change it any time while signed in.
 *   - The gray "Distance to work" card on any unlocked report
 *     (ReportView.tsx) — first-time capture in context.
 *   Both persist via saveWorkDestination() in account.ts.
 *
 * CLIENT RESOLUTION ORDER (resolveCommute below):
 *   1. Exact measured route for THIS listing + the renter's saved work
 *      destination (commute_routes).
 *   2. Area baseline: the renter's destination matched to one of the four
 *      hubs → the measured area→hub route (area_commutes), clearly labelled
 *      as measured from a central point of the area.
 *   3. Nothing measured → null (gray card). If the renter has a saved
 *      destination and no exact row exists yet, the caller may fire
 *      requestListingMeasurement() so the route appears once measured.
 */

import { asArray, areaName } from './types';
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
   * True when the renter has a saved destination, nothing measured backs the
   * card, and no exact measurement for that destination exists yet — i.e. an
   * on-demand measure request would actually add something.
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

  // 3 · nothing measured. Pending rows are retryable: the previous version
  // treated their mere existence as success, so one provider/config failure
  // left the card dead forever. The request helper dedupes healthy retries per
  // session and the hook rate-caps provider usage.
  return { payload: null, shouldRequestExact: true };
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
    return {
      ok,
      status: response.status,
      result: data?.result,
      commute: data?.commute || null,
      code: data?.blocked || data?.code,
      message: data?.error || data?.message,
    };
  } catch {
    requestedThisSession.delete(key);
    return {
      ok: false,
      status: 0,
      result: 'network-error',
      message: 'Commute info temporarily unavailable',
    };
  }
}

export async function requestListingMeasurement(
  listingId: number,
  destination: string,
  force = false
): Promise<CommuteMeasurementRequestResult> {
  const key = `listing:${listingId}::${normDest(destination)}`;
  return requestMeasurement(key, { mode: 'measure-listing', listingId, destination }, force);
}

/** Exact route for a typed-address report (which has no listings-table id). */
export async function requestAddressMeasurement(
  origin: string,
  destination: string,
  force = false
): Promise<CommuteMeasurementRequestResult> {
  const key = `address:${normDest(origin)}::${normDest(destination)}`;
  return requestMeasurement(key, { mode: 'measure-address', origin, destination }, force);
}
