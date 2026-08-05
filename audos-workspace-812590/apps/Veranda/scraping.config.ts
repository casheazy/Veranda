/**
 * Veranda scraping pipeline — source registry & operational reference.
 *
 * This file is the workspace-side source of truth for the automated listing
 * scraping pipeline. The pipeline itself runs PLATFORM-SIDE (not in the
 * browser bundle):
 *
 *   1. HOOK (server function): `veranda-scrape-listings`
 *      - id: e0f044b2-5ee3-456a-887e-ffd5fb412352
 *      - Runs the Apify actor(s) below via the platform `web-scraping`
 *        integration (`POST /api/apify/run`), maps raw portal rows to the
 *        `NormalizedListing` shape (see apps/Veranda/ingestion.ts — the
 *        canonical contract, do not change it), dedupes by `external_id`
 *        against ALL existing rows (cross-portal safe), and bulk-inserts only
 *        fresh rows into the shared `listings` WorkspaceDB table.
 *      - Body `{ portals: ['nigeriapropertycentre' | 'propertypro', ...] }`
 *        restricts a run to specific portals. The daily schedules use this so
 *        each portal gets its own time budget: PropertyPro needs a real
 *        browser per page (see below) and cannot share the NPC run's
 *        10-minute hook ceiling.
 *      - PHOTOS: every scraped row stores its photo set as a JSON-array
 *        string in the existing `image_url` text column, e.g.
 *        '["https://…/photo1.webp","https://…/photo2.webp"]'. The display
 *        layer (apps/Veranda/listingDisplay.tsx listingImageUrls()) parses
 *        this shape and renders the swipeable carousel.
 *        · NPC: fresh listings get a same-run detail-page pass (full
 *          gallery). Backfill swept 2026-08-01 and re-verified 2026-08-03:
 *          zero /thumbs/-only rows remain; the ~29 NPC rows with no photo
 *          were re-scraped and their portal pages genuinely expose no
 *          gallery (they stay backfill candidates and are retried on any
 *          future NPC backfill run).
 *        · PropertyPro: fresh listings ingest with the list-card photo; a
 *          scheduled backfill pass (see schedule 3) upgrades them to the
 *          full gallery AND fills the description (list cards carry none).
 *      - BACKFILL MODE: POST body { mode: 'backfill-photos', portal?:
 *        'nigeriapropertycentre'(default) | 'propertypro', limit?, force? }.
 *        NPC rule: rows lacking a full-size JSON photo set. PropertyPro
 *        rule: rows with description IS NULL ('' marks "visited, page had
 *        no description"); failed page loads stay NULL and retry next run.
 *      - Malformed rows (no id/title, non-annual price, non-residential
 *        category, out-of-range rent) are logged in the run summary and
 *        skipped — they never crash the run.
 *      - BATCHING (do not undo): the platform aborts a hook's outbound fetch
 *        at ~300s with "fetch failed", regardless of the hook's own
 *        metadata.timeout (600000). A 23-page PropertyPro playwright call
 *        sits right on that line, so the hook issues each Apify run as a
 *        SMALL BATCH of pages (8 PropertyPro area pages, 6 PropertyPro
 *        detail pages, 60 NPC detail pages) and concatenates the results.
 *        A failed batch now costs only its own pages instead of the run.
 *      - RUN LOG: every execution opens a row in the `scrape_runs`
 *        WorkspaceDB table and closes it with the full summary. A row still
 *        holding `finished_at IS NULL`, or `ok = false`, is a run that died
 *        or degraded — check that table first when ingestion looks stalled.
 *      - PAGED READS (do not undo): a hook's `db.query` silently caps `limit`
 *        at 1000 rows and gives no sign the result was truncated. The dedupe
 *        read used to ask for 10000 and therefore stopped seeing the newest
 *        listings once the table passed 1000 rows, re-inserting them. Every
 *        full-table read now pages by id (`queryAllRows` in the hook).
 *      - MAINTENANCE MODE: POST body { mode: 'dedupe-cleanup', limit?,
 *        dryRun? } deletes rows sharing an external_id, keeping the oldest of
 *        each set. A no-op on a clean catalog.
 *      - Manage it via the `server-functions` integration endpoints:
 *        GET/PATCH /api/workspaces/{workspaceId}/hooks/{hookId}
 *
 *   2. SCHEDULES (task-scheduler) — five coordinated daily jobs:
 *      - "Veranda daily listings scrape" (NPC leg)
 *        id: 5a51a98b-4dda-478f-ba97-209fccd27249 — daily 06:00
 *        Africa/Lagos, payload { portals: ['nigeriapropertycentre'] }.
 *      - "Veranda daily listings scrape - PropertyPro"
 *        id: 60af4bf3-63a2-4ba0-963d-7c29d2ff85c2 — daily 06:45
 *        Africa/Lagos, payload { portals: ['propertypro'] }.
 *      - "Veranda PropertyPro photo and description backfill"
 *        id: 6ee28935-ddd7-463e-926e-fe6d2443693d — daily 07:45
 *        Africa/Lagos, payload { mode: 'backfill-photos', portal:
 *        'propertypro', limit: 18 }. No pending candidates → cheap no-op.
 *      - Two more backfill passes with the same payload, so the pool of rows
 *        still missing photos/descriptions drains in days rather than weeks:
 *        id: 6f29b369-dcbd-49f1-9a2b-a54f9f235614 — daily 12:45 Africa/Lagos
 *        id: 1d40633a-103e-4a66-b80b-9335e9bec28d — daily 18:45 Africa/Lagos
 *      - Manage them via the `task-scheduler` integration endpoints:
 *        GET/PATCH/DELETE /api/workspaces/{workspaceId}/schedules/{scheduleId}
 *
 * VERIFIED END-TO-END:
 *  - 2026-07-28: NPC — 52 unique listings across the 3 launch areas; repeat
 *    run produced 0 duplicates.
 *  - 2026-07-31: coverage expanded 3 → 23 major Lagos areas (matching the
 *    `area_profiles` table; keys mirror apps/Veranda/types.ts AREAS).
 *  - 2026-08-01: PropertyPro live — pilot run scraped 468 raw cards across
 *    all 23 area pages (~4.3 min, $0.07 Apify), inserted 332 residential
 *    annual-rent listings across 22 areas; backfill pass verified filling
 *    full galleries (up to 12 photos) + descriptions.
 *  - 2026-08-03: the daily PropertyPro legs turned out to have ingested
 *    NOTHING since the 2026-08-01 pilot — every scheduled run crossed the
 *    ~300s outbound-fetch ceiling and died before its insert step, silently
 *    (the hook still answered 200, so neither the hook nor the schedule
 *    recorded an error). Fixed by batching the Apify calls and by logging
 *    every run to `scrape_runs`. Re-verified with two back-to-back runs:
 *    the first ingested the backlog, the second inserted 0 new rows and
 *    skipped them all as existing — dedupe by external_id holds.
 */

/** Status of each portal in the scraping rotation. */
export interface ScraperSource {
  portal: string;
  status: 'live' | 'deferred' | 'dead';
  actorId: string | null;
  startUrls: string[];
  notes: string;
}

export const SCRAPER_SOURCES: ScraperSource[] = [
  {
    portal: 'nigeriapropertycentre',
    status: 'live',
    actorId: 'apify/cheerio-scraper',
    startUrls: [
      // Launch areas (2026-07)
      'https://nigeriapropertycentre.com/for-rent/lagos/surulere',
      'https://nigeriapropertycentre.com/for-rent/lagos/magodo',
      'https://nigeriapropertycentre.com/for-rent/lagos/lekki/lekki-phase-1',
      // Mainland expansion (2026-07-31) — area_keys: yaba, ikeja, ojodu,
      // gbagada, ketu, shomolu, maryland, ikorodu
      'https://nigeriapropertycentre.com/for-rent/lagos/yaba',
      'https://nigeriapropertycentre.com/for-rent/lagos/ikeja',
      'https://nigeriapropertycentre.com/for-rent/lagos/ojodu',
      'https://nigeriapropertycentre.com/for-rent/lagos/gbagada',
      'https://nigeriapropertycentre.com/for-rent/lagos/ketu',
      'https://nigeriapropertycentre.com/for-rent/lagos/shomolu',
      'https://nigeriapropertycentre.com/for-rent/lagos/maryland',
      'https://nigeriapropertycentre.com/for-rent/lagos/ikorodu',
      // Island / Lekki–Epe corridor expansion — area_keys: victoria-island,
      // ikoyi, ajah, chevron, sangotedo, epe
      'https://nigeriapropertycentre.com/for-rent/lagos/victoria-island',
      'https://nigeriapropertycentre.com/for-rent/lagos/ikoyi',
      'https://nigeriapropertycentre.com/for-rent/lagos/ajah',
      'https://nigeriapropertycentre.com/for-rent/lagos/lekki/chevron',
      'https://nigeriapropertycentre.com/for-rent/lagos/ajah/sangotedo',
      'https://nigeriapropertycentre.com/for-rent/lagos/epe',
      // Other mainland expansion — area_keys: festac, agege, alimosho,
      // isolo, oshodi, mushin
      'https://nigeriapropertycentre.com/for-rent/lagos/amuwo-odofin/festac',
      'https://nigeriapropertycentre.com/for-rent/lagos/agege',
      'https://nigeriapropertycentre.com/for-rent/lagos/alimosho',
      'https://nigeriapropertycentre.com/for-rent/lagos/isolo',
      'https://nigeriapropertycentre.com/for-rent/lagos/oshodi',
      'https://nigeriapropertycentre.com/for-rent/lagos/mushin',
    ],
    notes:
      'Server-rendered HTML; listing cards parsed with cheerio (price, period, ' +
      'title, address, beds/baths, image, detail URL). Only residential ' +
      'categories (flats-apartments, houses) with annual (⁄yr) prices are ' +
      'ingested; commercial, land and short-let rows are filtered out. ' +
      'Detail pages carry the full gallery in an Alpine propertyGallery ' +
      'x-data attribute (JSON with full + thumb URL per photo) — the hook ' +
      'extracts it per fresh listing (verified again 2026-08-01; no anti-bot ' +
      'block on detail pages via Apify proxy). ' +
      'All 23 area URLs verified live (HTTP 200) on 2026-07-31. ' +
      '~$0.05 in Apify cost per daily run for the 23 coverage-area pages, ' +
      'plus ~$0.003 per fresh listing detail page for photos.',
  },
  {
    // NOTE: tolet.com.ng 301-redirects to propertypro.ng (ToLet rebranded to
    // PropertyPro in 2017) — this source IS the "tolet" portal. Rows are
    // labeled source_portal='propertypro'.
    portal: 'propertypro',
    status: 'live',
    actorId: 'apify/playwright-scraper',
    startUrls: [
      // Same 23 coverage areas as NPC; PropertyPro slugs verified live with
      // listing cards on 2026-08-01. Magodo files under kosofe-ikosi on
      // PropertyPro (phase-1 listings surface via the ojodu page); festac
      // under amuwo-odofin.
      'https://propertypro.ng/property-for-rent/in/lagos/surulere',
      'https://propertypro.ng/property-for-rent/in/lagos/kosofe-ikosi/magodo-gra-phase-2',
      'https://propertypro.ng/property-for-rent/in/lagos/lekki/lekki-phase-1',
      'https://propertypro.ng/property-for-rent/in/lagos/yaba',
      'https://propertypro.ng/property-for-rent/in/lagos/ikeja',
      'https://propertypro.ng/property-for-rent/in/lagos/ojodu',
      'https://propertypro.ng/property-for-rent/in/lagos/gbagada',
      'https://propertypro.ng/property-for-rent/in/lagos/ketu',
      'https://propertypro.ng/property-for-rent/in/lagos/shomolu',
      'https://propertypro.ng/property-for-rent/in/lagos/maryland',
      'https://propertypro.ng/property-for-rent/in/lagos/ikorodu',
      'https://propertypro.ng/property-for-rent/in/lagos/victoria-island',
      'https://propertypro.ng/property-for-rent/in/lagos/ikoyi',
      'https://propertypro.ng/property-for-rent/in/lagos/ajah',
      'https://propertypro.ng/property-for-rent/in/lagos/lekki/chevron',
      'https://propertypro.ng/property-for-rent/in/lagos/ajah/sangotedo',
      'https://propertypro.ng/property-for-rent/in/lagos/epe',
      'https://propertypro.ng/property-for-rent/in/lagos/amuwo-odofin/festac',
      'https://propertypro.ng/property-for-rent/in/lagos/agege',
      'https://propertypro.ng/property-for-rent/in/lagos/alimosho',
      'https://propertypro.ng/property-for-rent/in/lagos/isolo',
      'https://propertypro.ng/property-for-rent/in/lagos/oshodi',
      'https://propertypro.ng/property-for-rent/in/lagos/mushin',
    ],
    notes:
      'LIVE since 2026-08-01. The site sits behind a Cloudflare interactive ' +
      'JS challenge that 403-blocks plain HTTP actors (the 2026-07-28 block), ' +
      'but a real browser passes it: apify/playwright-scraper with launcher ' +
      '"firefox", headless FALSE and NG RESIDENTIAL Apify proxies loads every ' +
      'page. Do NOT "optimize" to headless/datacenter proxies — that ' +
      're-triggers the 403. List cards (div.property-listing-content) carry ' +
      'a stable PID ("PID : 1PSJZ") used as the listing id ' +
      '(external_id propertypro:<PID>), price ("₦ 5,000,000/year" — only ' +
      '/year prices ingest), beds/baths, location line and one slider photo. ' +
      'Fresh rows ingest with that single photo + description NULL; the daily ' +
      'backfill schedule visits detail pages (gallery in .property-sslider ' +
      'img.gallery-image, lazy slides keep URLs in data-lazy) and fills the ' +
      'full gallery + description, 18 pages/run (~15s per page — each is a ' +
      'Cloudflare-challenged browser visit). ' +
      'The 23 area pages are swept 8 at a time and detail pages 6 at a time: ' +
      'one browser run covering all of them takes longer than the ~300s ' +
      'ceiling the platform puts on a hook’s outbound fetch, which is what ' +
      'silently stalled PropertyPro ingestion on 2026-08-02/03. ' +
      '~$0.07-0.10 in Apify cost per daily 23-page list run (~4-6 min), plus ' +
      'the backfill run while a pool is pending. ' +
      'tolet.com.ng resolves here (301) — do not add it as a separate source.',
  },
  {
    portal: 'lamudi',
    status: 'dead',
    actorId: null,
    startUrls: [],
    notes:
      'DEAD (checked 2026-08-01): lamudi.com.ng is a parked domain — it ' +
      'serves a ParkLogic ad-arbitrage redirect script over an invalid TLS ' +
      'certificate and hosts no property listings. Lamudi exited Nigeria ' +
      'years ago (its old Nigerian operation is what became PropertyPro). ' +
      'There is nothing to scrape; do not add start URLs.',
  },
  {
    portal: 'jiji',
    status: 'deferred',
    actorId: null,
    startUrls: [],
    notes:
      'Deferred by product decision this cycle: active anti-bot protection ' +
      'makes jiji.ng the hardest target.',
  },
];

/** Identifiers for the platform-side pieces (for ops/debugging). */
export const SCRAPER_PIPELINE = {
  hookName: 'veranda-scrape-listings',
  hookId: 'e0f044b2-5ee3-456a-887e-ffd5fb412352',
  schedules: [
    {
      name: 'Veranda daily listings scrape',
      id: '5a51a98b-4dda-478f-ba97-209fccd27249',
      cadence: 'daily @ 06:00 Africa/Lagos',
      payload: { portals: ['nigeriapropertycentre'] },
    },
    {
      name: 'Veranda daily listings scrape - PropertyPro',
      id: '60af4bf3-63a2-4ba0-963d-7c29d2ff85c2',
      cadence: 'daily @ 06:45 Africa/Lagos',
      payload: { portals: ['propertypro'] },
    },
    {
      name: 'Veranda PropertyPro photo and description backfill',
      id: '6ee28935-ddd7-463e-926e-fe6d2443693d',
      cadence: 'daily @ 07:45 Africa/Lagos',
      payload: { mode: 'backfill-photos', portal: 'propertypro', limit: 18 },
    },
    {
      name: 'Veranda PropertyPro photo and description backfill (12:45)',
      id: '6f29b369-dcbd-49f1-9a2b-a54f9f235614',
      cadence: 'daily @ 12:45 Africa/Lagos',
      payload: { mode: 'backfill-photos', portal: 'propertypro', limit: 18 },
    },
    {
      name: 'Veranda PropertyPro photo and description backfill (18:45)',
      id: '1d40633a-103e-4a66-b80b-9335e9bec28d',
      cadence: 'daily @ 18:45 Africa/Lagos',
      payload: { mode: 'backfill-photos', portal: 'propertypro', limit: 18 },
    },
  ],
  dedupeKey: 'external_id (<portal>:<listing-id>) — checked across ALL portals',
} as const;
