/**
 * Veranda listings ingestion layer.
 *
 * LIVE PIPELINE — automated scraping (option 3, founder-approved 2026-07)
 * -----------------------------------------------------------------------
 * A platform server function (hook) named `veranda-scrape-listings` scrapes
 * Nigerian property portals through the platform `web-scraping` integration
 * (Apify actors) and inserts normalized rows straight into the shared
 * `listings` WorkspaceDB table, following the exact `NormalizedListing`
 * contract below: dedupe by `external_id` across ALL sources, status
 * 'active', ingested_by 'scraper'. Three task-scheduler jobs trigger the
 * hook daily (Africa/Lagos): 06:00 NPC scrape, 06:45 PropertyPro scrape,
 * 07:45 PropertyPro photo/description backfill.
 *
 * See `apps/Veranda/scraping.config.ts` for the source registry, portal
 * status, hook/schedule identifiers and operational notes. The app itself
 * needed no changes — it reads `listings` via useWorkspaceDB(shared) and
 * surfaces scraped rows automatically.
 *
 * Each hook execution logs itself to the `scrape_runs` WorkspaceDB table
 * (opened before scraping, closed with the run summary). Rows left with
 * `finished_at IS NULL` are runs that were killed mid-flight; `ok = false`
 * marks a run whose actor batches partly failed. Check there first if the
 * catalog stops growing — a scrape that dies still answers HTTP 200, so
 * neither the hook nor its schedule records an error.
 *
 * SOURCE STATUS (2026-08-01)
 * --------------------------
 * - nigeriapropertycentre.com (NPC): LIVE — server-rendered HTML, scraped
 *   with `apify/cheerio-scraper` across 23 Lagos coverage areas.
 * - propertypro.ng (PropertyPro): LIVE — the Cloudflare JS challenge that
 *   blocked plain HTTP actors is passed by `apify/playwright-scraper`
 *   (firefox launcher, headful, NG residential proxy). Its area pages and
 *   detail pages are scraped in small batches (8 and 6 pages per Apify call)
 *   because the platform aborts a hook's outbound fetch at ~300s and one
 *   browser run covering all 23 areas overruns it. NOTE: tolet.com.ng
 *   301-redirects to propertypro.ng (ToLet rebranded to PropertyPro in
 *   2017), so this source IS the "tolet" portal — one source, one label.
 * - lamudi.com.ng (Lamudi): DEAD — parked domain (ad-arbitrage redirect,
 *   invalid TLS cert); Lamudi exited Nigeria. Nothing to scrape.
 * - jiji.ng (Jiji): DEFERRED by product decision (active anti-bot).
 *
 * `ingestListings()` below remains the client-side ingestion path (e.g. a
 * future founder admin screen pasting curated listings). The scheduled hook
 * is the server-side implementation of the same contract — both dedupe by
 * `external_id` (`<portal>:<listing-id>`), so re-runs and mixed use are safe.
 */

import type { Listing } from './types';

export interface NormalizedListing {
  /**
   * Stable dedupe key: `<portal>:<listing-id>`, e.g. `propertypro:1PSJZ`
   * (PropertyPro PID) or `nigeriapropertycentre:2358158`. Checked against
   * ALL existing rows on ingest, so re-runs and mixed sources are safe.
   * Note: the same physical property listed on two portals carries two
   * unrelated ids — cross-portal identity is not reliably detectable, so
   * such listings can legitimately appear once per portal.
   */
  external_id: string;
  title: string;
  /** One of the launch areas: surulere | magodo | lekki. */
  area_key: string;
  neighborhood?: string;
  address?: string;
  /** Annual rent in Naira. */
  rent_year_ngn: number;
  bedrooms?: number;
  bathrooms?: number;
  property_type?: string;
  furnished?: boolean;
  features?: string[];
  description?: string;
  /**
   * Listing photo(s). Scraper rows store a JSON-array string of every gallery
   * photo URL (full-size preferred), e.g. '["https://…/1.webp","https://…/2.webp"]';
   * a single plain URL is also valid. The display layer
   * (listingDisplay.tsx listingImageUrls()) parses both shapes. Field name and
   * type are frozen — it stays a string packed into the `image_url` text column.
   */
  image_url?: string;
  /**
   * Portal id: propertypro | nigeriapropertycentre | jiji | manual.
   * (tolet.com.ng listings are `propertypro` — the domain redirects there;
   * lamudi.com.ng is dead. See scraping.config.ts.)
   */
  source_portal: string;
  /** Link back to the original public listing. */
  source_url?: string;
  /** ISO date the listing went up on the portal. */
  listed_at?: string;
}

export interface IngestResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

/**
 * Idempotently ingest normalized listings into the shared `listings` table.
 * Rows whose `external_id` already exists are skipped.
 */
export async function ingestListings(rows: NormalizedListing[]): Promise<IngestResult> {
  const db = (window as any).__workspaceDb;
  const result: IngestResult = { inserted: 0, skipped: 0, errors: [] };
  if (!db || rows.length === 0) return result;

  let existingIds = new Set<string>();
  try {
    const { data } = await db.from('listings', { shared: true }).limit(1000).get();
    existingIds = new Set(
      (data || []).map((l: Listing) => l.external_id).filter(Boolean) as string[]
    );
  } catch (err) {
    result.errors.push(`Could not read existing listings: ${err instanceof Error ? err.message : 'unknown'}`);
    return result;
  }

  const fresh = rows.filter((r) => {
    if (existingIds.has(r.external_id)) {
      result.skipped += 1;
      return false;
    }
    return true;
  });

  if (fresh.length === 0) return result;

  try {
    await db.from('listings').bulkInsert(
      fresh.map((r) => ({
        external_id: r.external_id,
        title: r.title,
        area_key: r.area_key,
        neighborhood: r.neighborhood ?? null,
        address: r.address ?? null,
        rent_year_ngn: r.rent_year_ngn,
        bedrooms: r.bedrooms ?? null,
        bathrooms: r.bathrooms ?? null,
        property_type: r.property_type ?? null,
        furnished: r.furnished ?? false,
        features: r.features ?? [],
        description: r.description ?? null,
        image_url: r.image_url ?? null,
        source_portal: r.source_portal,
        source_url: r.source_url ?? null,
        listed_at: r.listed_at ?? null,
        status: 'active',
        ingested_by: 'scraper',
      }))
    );
    result.inserted = fresh.length;
  } catch (err) {
    result.errors.push(`Bulk insert failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  return result;
}
