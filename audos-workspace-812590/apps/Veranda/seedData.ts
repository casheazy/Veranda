/**
 * Veranda v0 area-profile data — the day-one paid verification lookups.
 *
 * `area_profiles` holds the two dimensions Veranda can stand behind on day one
 * for each launch area:
 *   1. FLOOD  — an area-level flood-risk classification (low | moderate | high)
 *      plus the sub-zones inside it, and what the classification is based on.
 *   2. POWER  — the DisCo that serves the area and its predominant NERC service
 *      band (committed minimum daily hours + the published non-MD tariff).
 *
 * Everything here is real-world sourced (NERC service bands, the DisCos' own
 * published tariff tables, Lagos State / LASEMA flood advisories, dam-release
 * advisories for the Ogun River corridor). Do NOT add invented or placeholder
 * values to this file — it is the paid product.
 *
 * Deliberately NOT covered at launch: network coverage and neighbourhood
 * security. Those only become trustworthy once crowdsourced tenant reports
 * accumulate, so they are left out rather than shown as fake precision.
 *
 * `listings` is populated by the live scraping pipeline (see ingestion.ts /
 * scraping.config.ts) and is not seeded from here.
 *
 * `tenant_reports` IS seeded, but only with clearly-marked launch examples for
 * the three original launch areas (source_type: 'seed'). They exist so the
 * crowd layer of a report is never an empty box on day one, and they render
 * with a "Seed example" label and no verified tick — the founder replaces or
 * confirms them as real tenant submissions land. Never mark a seed row
 * `verified` or `tenant`: the crowd layer is only worth anything if renters
 * can tell seeded examples from real ones.
 *
 * Seeding is idempotent: it only inserts when the shared table is empty.
 *
 * COVERAGE EXPANDED (2026-07-31): the live `area_profiles` table now holds 23
 * areas — the 20 additional profiles were seeded server-side via a one-shot
 * platform hook (same accuracy rules: real flood classifications, real DisCo
 * bands, nothing invented). This file remains the empty-table bootstrap for
 * the original three launch areas only; the DB is the source of truth.
 */

import type { AreaProfile } from './types';

// ---------------------------------------------------------------------------
// Day-one verification lookups (the paid core)
// ---------------------------------------------------------------------------

const NERC_SOURCE = {
  label: 'NERC — service bands & committed supply hours',
  url: 'https://nerc.gov.ng/faq/electricity-tariffs/',
};
const EKEDC_SOURCE = {
  label: 'EKEDC — published service-reflective tariff table',
  url: 'https://www.ekedp.com/tariff-plans',
};
const IKEDC_SOURCE = {
  label: 'Ikeja Electric — tariff & band information',
  url: 'https://www.ikejaelectric.com',
};
const LASEMA_SOURCE = {
  label: 'LASEMA — Lagos State flood advisories',
  url: 'https://lasema.lagosstate.gov.ng',
};
const NIMET_SOURCE = {
  label: 'NiMet — seasonal rainfall prediction (Lagos)',
  url: 'https://nimet.gov.ng',
};
const NIHSA_SOURCE = {
  label: 'NIHSA — annual flood outlook & dam-release advisories',
  url: 'https://nihsa.gov.ng',
};

export const SEED_AREA_PROFILES: Array<Omit<AreaProfile, 'id'>> = [
  {
    area_key: 'surulere',
    area_name: 'Surulere',
    city: 'Lagos (Mainland)',
    state: 'Lagos',
    flood_zone_class: 'moderate',
    flood_zone_label: 'Moderate flood risk · high in low-lying pockets',
    flood_summary:
      'Surulere sits on low-lying inner-mainland land drained by the Lagos canal network. Most streets get flash flooding that clears within hours during the peak rains (June–July and September–October), but low-lying pockets around Aguda, Ijeshatedo/Itire and parts of Lawanson flood repeatedly when the canals back up. Ground-floor units on those streets carry materially more risk than upstairs units.',
    flood_basis:
      'Lagos State / LASEMA seasonal flood advisories and NiMet’s seasonal rainfall prediction for Lagos, combined with terrain (low elevation) and proximity to the Surulere–Itire canal network. This is an AREA-level classification — street-level risk still varies with the state of the local drainage.',
    flood_zones: [
      { name: 'Bode Thomas / Adeniran Ogunsanya', class: 'moderate', note: 'Flash flooding, usually clears in hours' },
      { name: 'Aguda', class: 'high', note: 'Repeat flooding when the canal backs up' },
      { name: 'Ijeshatedo / Itire', class: 'high', note: 'Low-lying with poor drainage' },
      { name: 'Lawanson / Ojuelegba', class: 'moderate', note: 'Ponding on side streets in heavy rain' },
      { name: 'Eric Moore / Iponri', class: 'moderate', note: 'Estate pockets drain better' },
    ],
    disco_name: 'Eko Electricity Distribution Company (EKEDC)',
    disco_band: 'B',
    band_hours_min: 16,
    tariff_ngn_kwh: 61,
    band_note:
      'Surulere is EKEDC territory and its residential feeders are predominantly Band B — a committed minimum of 16 hours/day at the published non-MD rate of ₦61.00/kWh. Bands are assigned per FEEDER, not per area: some streets sit on Band C feeders (minimum 12 hours, ₦48.53/kWh). Ask the landlord or EKEDC for the feeder name and band of the exact address before you pay.',
    power_summary:
      'Official position: EKEDC, predominantly Band B — minimum 16 hours of supply per day at ₦61.00/kWh. That is the regulated commitment for the band, not a measurement of your street. Measured hours appear here as tenants submit power reports.',
    sources: [NERC_SOURCE, EKEDC_SOURCE, LASEMA_SOURCE, NIMET_SOURCE],
  },
  {
    area_key: 'magodo',
    area_name: 'Magodo',
    city: 'Lagos (Kosofe / Ikeja axis)',
    state: 'Lagos',
    flood_zone_class: 'low',
    flood_zone_label: 'Lower flood risk · elevated, better-drained GRA',
    flood_summary:
      'Magodo GRA — especially Phase 2 (Shangisha) — sits on relatively elevated, planned estate land with engineered drainage, and is one of the better-drained residential areas on the Lagos mainland: rain generally clears quickly. The clear exception is the Phase 1 / Isheri fringe along the Ogun River floodplain, which can flood severely when the Oyan Dam is released upstream, typically between August and October.',
    flood_basis:
      'NIHSA annual flood outlook and Ogun River / Oyan Dam release advisories, Lagos State drainage records for the Magodo–Isheri channel, and estate elevation. This is an AREA-level classification — check where the specific street sits relative to the river edge.',
    flood_zones: [
      { name: 'Phase 2 core (Shangisha)', class: 'low', note: 'Elevated, engineered estate drainage' },
      { name: 'Phase 1 inner streets', class: 'low', note: 'Rain generally clears quickly' },
      { name: 'CMD Road corridor', class: 'moderate', note: 'Runoff ponding in heavy downpours' },
      { name: 'Isheri / Ogun River fringe', class: 'high', note: 'Dam-release flooding, typically Aug–Oct' },
    ],
    disco_name: 'Ikeja Electric (IKEDC)',
    disco_band: 'A',
    band_hours_min: 20,
    tariff_ngn_kwh: 209.5,
    band_note:
      'Magodo is Ikeja Electric territory and the GRA feeders are predominantly Band A — a committed minimum of 20 hours/day, but at the premium non-MD rate of ₦209.50/kWh. Bands are assigned per FEEDER: a neighbouring street can be Band B (minimum 16 hours at roughly ₦63/kWh). Confirm the feeder band for the exact address with Ikeja Electric before you sign.',
    power_summary:
      'Official position: Ikeja Electric, predominantly Band A — minimum 20 hours of supply per day at ₦209.50/kWh. Strong reliability, but budget for the Band A tariff, which is several times the Band B rate for the same usage. Measured hours appear here as tenants submit power reports.',
    sources: [NERC_SOURCE, IKEDC_SOURCE, NIHSA_SOURCE, LASEMA_SOURCE],
  },
  {
    area_key: 'lekki',
    area_name: 'Lekki Phase 1',
    city: 'Lagos (Eti-Osa / Island axis)',
    state: 'Lagos',
    flood_zone_class: 'high',
    flood_zone_label: 'High flood risk · low-lying, reclaimed coastal plain',
    flood_summary:
      'Lekki Phase 1 is built on low-lying, largely reclaimed coastal land with a high water table and few natural drainage outlets. Heavy rainfall routinely puts main corridors such as Admiralty Way and Freedom Way under water for hours, and Lagos State flood advisories name the Lekki–Victoria Island axis every rainy season. Floor level matters here: ground-floor units and compounds without raised drainage take the damage first.',
    flood_basis:
      'Recurring Lagos State / LASEMA rainy-season flood advisories for the Eti-Osa (Lekki–Victoria Island) axis, NiMet seasonal rainfall predictions, coastal elevation and the reclaimed-land history of Phase 1. This is an AREA-level classification — verify the specific street and the floor level of the unit.',
    flood_zones: [
      { name: 'Admiralty Way corridor', class: 'high', note: 'Deep ponding after heavy storms' },
      { name: 'Freedom Way / Marwa', class: 'high', note: 'Slow-draining trunk roads' },
      { name: 'Inner residential loops', class: 'moderate', note: 'Varies street by street with drainage upgrades' },
      { name: 'Ikate / Elegushi fringe', class: 'high', note: 'Wetland-adjacent, high water table' },
    ],
    disco_name: 'Eko Electricity Distribution Company (EKEDC)',
    disco_band: 'A',
    band_hours_min: 20,
    tariff_ngn_kwh: 209.5,
    band_note:
      'Lekki Phase 1 is EKEDC territory and most Phase 1 feeders are Band A — a committed minimum of 20 hours/day at the premium non-MD rate of ₦209.50/kWh. Bands are assigned per FEEDER: a few streets sit on Band B feeders (minimum 16 hours, ₦61.00/kWh). Confirm the feeder band for the exact address with EKEDC before you pay.',
    power_summary:
      'Official position: EKEDC, predominantly Band A — minimum 20 hours of supply per day at ₦209.50/kWh, the most reliable (and most expensive) band EKEDC operates. That is the regulated commitment, not a measurement: storm-related shutdowns are common in the wet season. Measured hours appear here as tenants submit power reports.',
    sources: [NERC_SOURCE, EKEDC_SOURCE, LASEMA_SOURCE, NIMET_SOURCE],
  },
];

// ---------------------------------------------------------------------------
// Auto-seed (runs once, client-side, on first app load)
// ---------------------------------------------------------------------------

let seedPromise: Promise<boolean> | null = null;

/**
 * Ensures the three launch-area profiles exist. Checks the SHARED row count so
 * it is idempotent across visitors; inserts only when the table is empty.
 * Returns true when rows were inserted (callers should refresh their hook).
 *
 * `listings` comes from the scraping pipeline and is never seeded here;
 * `tenant_reports` has its own seeder below.
 */
export function ensureAreaProfilesSeeded(): Promise<boolean> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const db = (window as any).__workspaceDb;
      if (!db) return false;
      try {
        const { total } = await db.from('area_profiles', { shared: true }).limit(1).get();
        if ((total ?? 0) > 0) return false;
        // Insert into the SHARED pool (session_id = NULL) — a default insert
        // would tag the rows with this visitor's session, making them invisible
        // to every other visitor (and to the shared-count check above).
        await db.from('area_profiles', { shared: true }).bulkInsert(SEED_AREA_PROFILES);
        return true;
      } catch (err) {
        // If we can't read the table, never blind-insert (avoids duplicates).
        console.error('[Veranda] Area profile seeding failed:', err);
        return false;
      }
    })();
  }
  return seedPromise;
}

// ---------------------------------------------------------------------------
// Launch tenant-report examples (the crowd layer's starting point)
// ---------------------------------------------------------------------------

/**
 * Placeholder-but-realistic flood + power entries for the three launch areas,
 * written to match the streets and sub-zones named in the area profiles above.
 * Every row carries `source_type: 'seed'` and `verified: false` so the report
 * UI labels it "Seed example — pending verification" instead of passing it off
 * as a tenant's own account.
 */
export const SEED_TENANT_REPORTS: Array<Record<string, unknown>> = [
  // ----------------------------- Surulere ----------------------------------
  {
    report_type: 'flood',
    area_key: 'surulere',
    street: 'Enitan Street, Aguda',
    source_type: 'seed',
    event_period: 'July 2025 rains',
    severity: 'knee',
    description:
      'Water sat at knee height on the street for most of an afternoon after the heavy July downpour. Ground-floor flats took water; it drained once the canal cleared.',
    verified: false,
  },
  {
    report_type: 'flood',
    area_key: 'surulere',
    street: 'Ijesha Road, Itire',
    source_type: 'seed',
    event_period: 'October 2025',
    severity: 'ankle',
    description:
      'Ankle-deep ponding on the side streets on most heavy-rain days through October. Clears within an hour or two.',
    verified: false,
  },
  {
    report_type: 'flood',
    area_key: 'surulere',
    street: 'Adeniran Ogunsanya',
    source_type: 'seed',
    event_period: 'June 2026 rains',
    severity: 'none',
    description:
      'No flooding on the main stretch — the drains were desilted before the rains. Side streets off Bode Thomas still puddle.',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'surulere',
    street: 'Aguda',
    source_type: 'seed',
    avg_daily_hours: 13,
    outage_pattern: 'Usually off around midday and again briefly at night',
    period: 'Jan–Jun 2026',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'surulere',
    street: 'Bode Thomas',
    source_type: 'seed',
    avg_daily_hours: 15,
    outage_pattern: 'Steady apart from storm-day trips',
    period: 'Feb–Jul 2026',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'surulere',
    street: 'Lawanson',
    source_type: 'seed',
    avg_daily_hours: 11,
    outage_pattern: 'Off most evenings for a few hours',
    period: 'Mar–Jun 2026',
    verified: false,
  },

  // ------------------------------ Magodo -----------------------------------
  {
    report_type: 'flood',
    area_key: 'magodo',
    street: 'Magodo Phase 2 (Shangisha)',
    source_type: 'seed',
    event_period: 'September 2025 rains',
    severity: 'none',
    description:
      'Rain cleared within the hour — the estate drainage held through the September downpours.',
    verified: false,
  },
  {
    report_type: 'flood',
    area_key: 'magodo',
    street: 'Isheri fringe, Magodo Phase 1',
    source_type: 'seed',
    event_period: 'October 2025 dam release',
    severity: 'waist',
    description:
      'Waist-high water on the streets closest to the Ogun River after the Oyan Dam release. Households on the fringe moved out for about a week.',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'magodo',
    street: 'Magodo Phase 2 (Shangisha)',
    source_type: 'seed',
    avg_daily_hours: 19.5,
    outage_pattern: 'Near-constant; short outages during storms',
    period: 'Jan–Jun 2026',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'magodo',
    street: 'CMD Road corridor',
    source_type: 'seed',
    avg_daily_hours: 18,
    outage_pattern: 'Occasional evening outages, usually under an hour',
    period: 'Feb–Jul 2026',
    verified: false,
  },

  // ------------------------------- Lekki -----------------------------------
  {
    report_type: 'flood',
    area_key: 'lekki',
    street: 'Admiralty Way',
    source_type: 'seed',
    event_period: 'July 2025 rains',
    severity: 'knee',
    description:
      'Knee-deep along Admiralty for most of the afternoon after the storm; cars stalled in the dip near the roundabout.',
    verified: false,
  },
  {
    report_type: 'flood',
    area_key: 'lekki',
    street: 'Freedom Way / Marwa',
    source_type: 'seed',
    event_period: 'June 2026 rains',
    severity: 'knee',
    description:
      'Standing water on most heavy-rain mornings. Takes three to four hours to drain once the rain stops.',
    verified: false,
  },
  {
    report_type: 'flood',
    area_key: 'lekki',
    street: 'Ikate / Elegushi fringe',
    source_type: 'seed',
    event_period: 'October 2025',
    severity: 'waist',
    description:
      'Compound flooded to waist height on the wetland-adjacent streets; ground-floor units lost furniture.',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'lekki',
    street: 'Admiralty Way corridor',
    source_type: 'seed',
    avg_daily_hours: 18,
    outage_pattern: 'Reliable outside the rainy season; storm shutdowns are the main gap',
    period: 'Jan–Jun 2026',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'lekki',
    street: 'Ikate',
    source_type: 'seed',
    avg_daily_hours: 16,
    outage_pattern: 'Off for a few hours most afternoons',
    period: 'Mar–Jun 2026',
    verified: false,
  },
  {
    report_type: 'power',
    area_key: 'lekki',
    street: 'Lekki Phase 1 inner loops',
    source_type: 'seed',
    avg_daily_hours: 19,
    outage_pattern: 'Rarely off for long; estate generators cover the gaps',
    period: 'Feb–Jul 2026',
    verified: false,
  },
];

let tenantSeedPromise: Promise<boolean> | null = null;

/**
 * Ensures the launch tenant-report examples exist. Like the profile seeder it
 * checks the SHARED row count first, so it never doubles up across visitors and
 * never fires once real tenants have started submitting.
 */
export function ensureTenantReportsSeeded(): Promise<boolean> {
  if (!tenantSeedPromise) {
    tenantSeedPromise = (async () => {
      const db = (window as any).__workspaceDb;
      if (!db) return false;
      try {
        const { total } = await db.from('tenant_reports', { shared: true }).limit(1).get();
        if ((total ?? 0) > 0) return false;
        // Shared-pool insert — see the note in ensureAreaProfilesSeeded above.
        await db.from('tenant_reports', { shared: true }).bulkInsert(SEED_TENANT_REPORTS);
        return true;
      } catch (err) {
        console.error('[Veranda] Tenant report seeding failed:', err);
        return false;
      }
    })();
  }
  return tenantSeedPromise;
}
