/**
 * Veranda — network coverage data layer (the "Network coverage" card).
 *
 * The report card renders per-carrier tiers for the four major Nigerian
 * carriers — MTN, Airtel, Glo and 9mobile — from two clearly-labelled
 * layers: live OpenCelliD cell-site measurements where they have landed,
 * and a published-coverage-reports baseline (COVERAGE_BASELINE below)
 * everywhere else. Nothing here invents street-level data: a carrier with
 * neither layer renders a gray "Data unavailable" row, and only when ALL
 * four have nothing does the card keep the overall gray "Improving" state.
 *
 * DATA SOURCE — why OpenCelliD and not the carriers' own checkers
 * (researched 2026-08-04): none of the four carriers exposes a queryable
 * coverage API. MTN's and 9mobile's checker pages do not answer non-browser
 * clients, Glo's returns 403 (bot protection), and Airtel's is an
 * Incapsula-protected SPA whose map polygons load behind the bot wall; none
 * publishes coverage shapefiles/GeoJSON. OpenCelliD (opencellid.org) is the
 * one documented, queryable source of real coverage-related data: a
 * community database of observed cell sites, filterable by country
 * (MCC 621), carrier (MNC) and radio technology (2G/3G/4G/5G). Observed
 * cell-site density near a point is measured ground truth, and the card
 * labels it exactly that way — never as the carrier's own claim, never as
 * independently verified. Each carrier row links out to that carrier's own
 * checker so renters can cross-check manually.
 *
 * BASELINE LAYER (added 2026-08-04): while OpenCelliD lookups are pending
 * (they need the founder's OPENCELLID_API_KEY), the card no longer shows a
 * wall of gray "Data pending" rows. COVERAGE_BASELINE below is a static
 * per-area × per-carrier tier table compiled from PUBLISHED sources — the
 * carriers' own published coverage maps, NCC (Nigerian Communications
 * Commission) industry statistics and public crowd-sourced
 * coverage-experience reports — rendered with the explicit label "Based on
 * published coverage reports", never as a live signal test. A landed
 * OpenCelliD measurement ALWAYS supersedes the baseline for its carrier row.
 * Alternatives investigated first (2026-08-04) before settling on this:
 * OpenSignal has no queryable API — api.opensignal.com (its retired public
 * developer API) no longer resolves in DNS, and current access is
 * enterprise-licensed only (the ONX suite, shapefiles under contract).
 * nperf's Nigeria map is a session-authenticated
 * SPA serving raster map tiles via ws.nperf.com — no per-location JSON to
 * query. Hence: honest labelled baseline + OpenCelliD upgrade path.
 *
 * PIPELINE (runs PLATFORM-SIDE, not in the browser bundle):
 *   1. HOOK (server function): `veranda-check-coverage`
 *      - id: 612f7e57-8b9f-4fbd-9e2f-cfed729660ee
 *      - Queries OpenCelliD `cell/getInAreaSize` through the BYOK secrets
 *        proxy ({{secrets.OPENCELLID_API_KEY}}, allowed host
 *        opencellid.org) in a ~2.4 km box around each area's centroid —
 *        one count per radio (GSM/UMTS/LTE/NR) per carrier — and derives
 *        the tier: any 5G or a dense 4G grid → 'good'; thinner 4G →
 *        'fair'; only 2G/3G → 'limited'. ZERO observed cells maps to
 *        status 'unavailable' (gray "No data yet"), NOT to 'none' —
 *        absence from a community database is not proof of no coverage.
 *      - Mode `check-areas` (scheduled): seeds + refreshes the 23 areas ×
 *        4 carriers matrix in the `area_coverage` table; rows refresh
 *        after 30 days.
 *      - Mode `check-area` { areaKey }: on-demand refresh of one area's
 *        rows, fired by requestCoverageCheck() below when a renter opens a
 *        report whose rows are still pending. Deduped by attempt time so a
 *        public caller cannot burn the founder's OpenCelliD quota.
 *      - NO KEY, NO MEASUREMENTS: while OPENCELLID_API_KEY is missing the
 *        hook reports blocked: 'unknown_secret' and rows stay 'pending' —
 *        the card then shows the labelled published-reports baseline
 *        instead. (Free key: register at opencellid.org.)
 *   2. SCHEDULES (task-scheduler), daily Africa/Lagos, payload
 *      { mode: 'check-areas', limit: 10 }:
 *      - "Veranda network coverage lookup (morning)"
 *        id: 61675de0-1798-4be5-ae8e-4d08ea6fe12e — 06:20
 *      - "Veranda network coverage lookup (midday)"
 *        id: a64aab9e-f313-40b4-ae89-94753c30c9c8 — 12:20
 *      - "Veranda network coverage lookup (evening)"
 *        id: 62954395-56d3-4bfa-93dc-46926283f184 — 18:20
 *      Three runs/day × 10 rows fills the 92-row matrix in ~3 days once
 *      the key lands, then most runs are cheap no-ops (30-day refresh).
 */

import { AreaKey, areaName } from './types';
import { WORKSPACE_ID } from './account';

export type CoverageTier = 'good' | 'fair' | 'limited' | 'none';

export interface CarrierInfo {
  key: 'mtn' | 'airtel' | 'glo' | '9mobile';
  label: string;
  /** The carrier's own public coverage checker — offered as a manual cross-check. */
  checkerUrl: string;
  checkerLabel: string;
}

/** The four major Nigerian carriers, in display order. */
export const CARRIERS: CarrierInfo[] = [
  { key: 'mtn', label: 'MTN', checkerUrl: 'https://www.mtnonline.com/coverage-checker/', checkerLabel: 'MTN coverage checker' },
  { key: 'airtel', label: 'Airtel', checkerUrl: 'https://www.airtel.com.ng/coverage-checker/', checkerLabel: 'Airtel coverage checker' },
  { key: 'glo', label: 'Glo', checkerUrl: 'https://gloworld.com/ng/coverage-map/', checkerLabel: 'Glo coverage map' },
  { key: '9mobile', label: '9mobile', checkerUrl: 'https://www.9mobile.com.ng/coverage/', checkerLabel: '9mobile coverage map' },
];

// ---------------------------------------------------------------------------
// Published-reports baseline (per area × carrier)
// ---------------------------------------------------------------------------

/** Tier per carrier for one area, sourced from published coverage reports. */
type BaselineTiers = Record<CarrierInfo['key'], CoverageTier>;

/** Provenance label rendered wherever a baseline tier is shown. */
export const BASELINE_SOURCE_LABEL = 'Published coverage reports';

/**
 * Static baseline compiled August 2026 from publicly available sources: the
 * carriers' published coverage maps, NCC industry statistics and public
 * crowd-sourced coverage-experience reports for Lagos. Deliberately coarse —
 * broad, defensible strokes only, no invented street-level precision:
 * - MTN: Nigeria's largest network (~half of all subscriptions), densest
 *   Lagos 4G grid and the widest 5G footprint → Good across all covered
 *   areas.
 * - Airtel: second-densest urban Lagos network, 4G throughout the metro and
 *   5G in core areas → Good in the urban core, Fair on the outer Epe
 *   corridor.
 * - Glo: wide footprint but consistently trails MTN/Airtel in published
 *   4G-experience rankings → Fair across the board.
 * - 9mobile: smallest carrier (single-digit market share, widely reported
 *   network decline, now leaning on MTN national roaming) → Fair in the
 *   urban core, Limited on the outer corridor and fringe towns.
 * A landed OpenCelliD measurement always replaces these for its row.
 */
export const COVERAGE_BASELINE: Record<AreaKey, BaselineTiers> = {
  // Island & Lekki–Epe corridor
  'victoria-island': { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  ikoyi: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  lekki: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  chevron: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  ajah: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'limited' },
  sangotedo: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'limited' },
  epe: { mtn: 'good', airtel: 'fair', glo: 'fair', '9mobile': 'limited' },
  // Central mainland
  surulere: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  yaba: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  gbagada: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  shomolu: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  maryland: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  mushin: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  oshodi: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  isolo: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  festac: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  // North & west mainland
  ikeja: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  magodo: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  ojodu: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  ketu: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  agege: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  alimosho: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'fair' },
  ikorodu: { mtn: 'good', airtel: 'good', glo: 'fair', '9mobile': 'limited' },
};

/** Row shape of the `area_coverage` table (one row per area × carrier). */
export interface AreaCoverageRow {
  id: number;
  area_key?: string | null;
  carrier?: string | null;
  tier?: string | null;
  technologies?: string | null;
  cells_gsm?: number | null;
  cells_umts?: number | null;
  cells_lte?: number | null;
  cells_nr?: number | null;
  cells_total?: number | null;
  status?: string | null;
  source?: string | null;
  source_label?: string | null;
  note?: string | null;
  checked_at?: string | null;
  attempted_at?: string | null;
}

export interface CarrierCoverage {
  carrier: CarrierInfo;
  /** null only while pending/unavailable — renders gray, never a made-up score. */
  tier: CoverageTier | null;
  /** e.g. '5G · 4G · 3G' — the technologies actually observed (measured rows only). */
  technologies: string | null;
  /** 'measured' = live OpenCelliD lookup · 'reported' = published-reports baseline. */
  status: 'pending' | 'measured' | 'unavailable' | 'reported';
  /** Honest caveat rendered with the row (e.g. the baseline provenance line). */
  note: string | null;
  sourceLabel: string | null;
  cellsTotal: number | null;
  checkedAt: string | null;
}

export interface CoverageResolution {
  /** Always all four carriers, in CARRIERS display order. */
  carriers: CarrierCoverage[];
  tone: 'good' | 'fair' | 'watch' | 'improving';
  headline: string;
  detail: string;
  measuredCount: number;
  /**
   * True when at least one carrier row is still pending (or missing) — the
   * caller may fire requestCoverageCheck() so data appears once looked up.
   */
  shouldRequestCheck: boolean;
}

function parseTier(value?: string | null): CoverageTier | null {
  if (value === 'good' || value === 'fair' || value === 'limited' || value === 'none') return value;
  return null;
}

function toCarrierCoverage(
  carrier: CarrierInfo,
  row: AreaCoverageRow | undefined,
  baselineTier: CoverageTier | undefined,
  areaLabel: string
): CarrierCoverage {
  // A landed measurement is the strongest signal — it always wins.
  const measuredTier = row?.status === 'measured' ? parseTier(row.tier) : null;
  if (measuredTier) {
    return {
      carrier,
      tier: measuredTier,
      technologies: row?.technologies || null,
      status: 'measured',
      note: row?.note || null,
      sourceLabel: row?.source_label || 'OpenCelliD community cell-site data',
      cellsTotal: row?.cells_total ?? null,
      checkedAt: row?.checked_at || null,
    };
  }
  // Pending / unavailable / missing rows fall back to the published-reports
  // baseline — clearly labelled, never presented as a live test.
  if (baselineTier) {
    return {
      carrier,
      tier: baselineTier,
      technologies: null,
      status: 'reported',
      note: `Based on published coverage reports for ${areaLabel} — not a live signal test.`,
      sourceLabel: BASELINE_SOURCE_LABEL,
      cellsTotal: null,
      checkedAt: null,
    };
  }
  // Truly nothing queryable for this carrier — honest gray, never a made-up score.
  return {
    carrier,
    tier: null,
    technologies: null,
    status: row?.status === 'unavailable' ? 'unavailable' : 'pending',
    note: row?.note || null,
    sourceLabel: row?.source_label || null,
    cellsTotal: row?.cells_total ?? null,
    checkedAt: row?.checked_at || null,
  };
}

/**
 * Overall card tone, per the report's semantics:
 *   green (good)      — all/most measured carriers test Good
 *   amber (fair)      — mixed results
 *   red (watch)       — every measured carrier is Limited / No coverage
 *   gray (improving)  — nothing measured yet for ANY carrier
 */
function overallTone(carriers: CarrierCoverage[]): CoverageResolution['tone'] {
  const known = carriers.filter((c) => c.tier != null);
  if (known.length === 0) return 'improving';
  const good = known.filter((c) => c.tier === 'good').length;
  const weak = known.filter((c) => c.tier === 'limited' || c.tier === 'none').length;
  if (weak === known.length) return 'watch';
  if (good >= 3 || (good === known.length && known.length >= 2)) return 'good';
  return 'fair';
}

const HEADLINES: Record<CoverageResolution['tone'], string> = {
  good: 'Strong data signal from most carriers',
  fair: 'Mixed carrier coverage — pick your network first',
  watch: 'Weak data signal across carriers here',
  improving: 'Network coverage is still building',
};

/**
 * Resolve the per-carrier coverage picture for one area: a landed
 * `area_coverage` measurement wins per carrier, the published-reports
 * baseline fills the rest (clearly labelled), and a carrier with neither
 * stays an honest gray entry — never a guess presented as data.
 */
export function resolveCoverage(
  areaKey: string,
  rows: AreaCoverageRow[] | undefined
): CoverageResolution {
  const areaRows = (rows || []).filter((r) => r.area_key === areaKey);
  const baseline = COVERAGE_BASELINE[areaKey as AreaKey];
  const label = areaName(areaKey);
  const carriers = CARRIERS.map((carrier) =>
    toCarrierCoverage(
      carrier,
      areaRows.find((r) => r.carrier === carrier.key),
      baseline?.[carrier.key],
      label
    )
  );
  const tone = overallTone(carriers);
  const measuredCount = carriers.filter((c) => c.status === 'measured').length;
  const reportedCount = carriers.filter((c) => c.status === 'reported').length;
  let detail: string;
  if (measuredCount === 0 && reportedCount === 0) {
    detail =
      'Per-carrier lookups for MTN, Airtel, Glo and 9mobile have not landed for this area yet, and it has no published-reports baseline — we show nothing rather than a made-up score.';
  } else if (measuredCount === 0) {
    detail = `Based on published coverage reports for ${label} — the carriers' published coverage maps, NCC industry data and public crowd-sourced coverage reports, not a live signal test. Live cell-site lookups replace these tiers as they land. Signal varies street by street and indoors, so test your own SIM at the address.`;
  } else if (measuredCount === carriers.length) {
    detail = `Live cell-site lookups from the OpenCelliD community database near the centre of ${label} — observed network equipment on the ground, not carrier marketing. Signal at the exact address still varies street by street and indoors.`;
  } else {
    detail = `A mix of live OpenCelliD cell-site lookups and published coverage reports near the centre of ${label} — each carrier row names its source. Signal at the exact address still varies street by street and indoors.`;
  }
  return {
    carriers,
    tone,
    headline: HEADLINES[tone],
    detail,
    measuredCount,
    // Request a live lookup while any underlying row is missing or pending —
    // baseline tiers render meanwhile, and a landed measurement replaces them.
    shouldRequestCheck: CARRIERS.some((carrier) => {
      const row = areaRows.find((r) => r.carrier === carrier.key);
      return !row || row.status === 'pending';
    }),
  };
}

// ---------------------------------------------------------------------------
// On-demand lookup trigger (fire-and-forget)
// ---------------------------------------------------------------------------

const requestedThisSession = new Set<string>();

/**
 * Ask the platform hook to look up one area's carrier coverage now. Safe to
 * call optimistically: the hook dedupes by attempt time and rate-caps, and
 * simply leaves rows pending while the OpenCelliD key is missing — the card
 * keeps its labelled published-reports baseline meanwhile.
 */
export function requestCoverageCheck(areaKey: string): void {
  if (!areaKey || requestedThisSession.has(areaKey)) return;
  requestedThisSession.add(areaKey);
  fetch(`/api/workspaces/${WORKSPACE_ID}/hooks/veranda-check-coverage/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'check-area', areaKey }),
  }).catch(() => {
    /* best-effort — the scheduled matrix refresh still covers every area */
  });
}
