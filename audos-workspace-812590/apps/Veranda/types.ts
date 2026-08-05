/**
 * Veranda — shared types + constants for the Curate → Verify journey.
 *
 * Coverage (expanded 2026-07-31): 23 major Lagos areas across the Island /
 * Lekki–Epe corridor and the mainland — launch v0 covered Surulere, Magodo
 * and Lekki Phase 1 only. Area keys here mirror the `area_profiles` table and
 * the scraping pipeline (apps/Veranda/scraping.config.ts).
 * Data lives in WorkspaceDB tables: listings, area_profiles, tenant_reports,
 * report_unlocks, curation_requests — plus area_coverage (per-carrier network
 * lookups, see apps/Veranda/coverage.ts) and the commute tables
 * (apps/Veranda/commute.ts).
 */

declare global {
  interface Window {
    useWorkspaceDB: <T = any>(
      table: string,
      options?: {
        shared?: boolean;
        limit?: number;
        offset?: number;
        orderBy?: { column: string; direction: 'asc' | 'desc' };
        filters?: Array<{ column: string; operator: string; value: any }>;
      }
    ) => {
      data: T[];
      loading: boolean;
      error: Error | null;
      total: number;
      refresh: () => void;
    };
    __workspaceDb: any;
    __APP_ID__?: string;
    __SPACE_ID__?: string;
  }
}

export type AreaKey =
  // Launch areas (v0)
  | 'surulere'
  | 'magodo'
  | 'lekki'
  // Island / Lekki–Epe corridor
  | 'victoria-island'
  | 'ikoyi'
  | 'chevron'
  | 'ajah'
  | 'sangotedo'
  | 'epe'
  // Central mainland
  | 'yaba'
  | 'gbagada'
  | 'shomolu'
  | 'maryland'
  | 'mushin'
  | 'oshodi'
  | 'isolo'
  | 'festac'
  // North & west mainland
  | 'ikeja'
  | 'ojodu'
  | 'ketu'
  | 'agege'
  | 'alimosho'
  | 'ikorodu';
export type FloodClass = 'high' | 'moderate' | 'low';

export interface Listing {
  id: number;
  external_id?: string | null;
  title?: string | null;
  area_key?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  rent_year_ngn?: number | string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  property_type?: string | null;
  furnished?: boolean | null;
  features?: string[] | string | null;
  description?: string | null;
  image_url?: string | null;
  source_portal?: string | null;
  source_url?: string | null;
  listed_at?: string | null;
  status?: string | null;
  ingested_by?: string | null;
  created_at?: string;
  /**
   * Measured commute payload attached CLIENT-SIDE by resolveCommute()
   * (apps/Veranda/commute.ts) before the listing reaches ReportView — it is
   * NOT a `listings` column. Shape: { driveMinutes, destination, routes,
   * trafficLabel?, measuredNote? }.
   */
  commute?: unknown;
}

export interface FloodZone {
  name: string;
  class: FloodClass;
  note?: string;
}

export interface SourceLink {
  label: string;
  url: string;
}

export interface AreaProfile {
  id: number;
  area_key?: string | null;
  area_name?: string | null;
  city?: string | null;
  state?: string | null;
  flood_zone_class?: string | null;
  flood_zone_label?: string | null;
  flood_summary?: string | null;
  flood_basis?: string | null;
  flood_zones?: FloodZone[] | string | null;
  disco_name?: string | null;
  disco_band?: string | null;
  band_hours_min?: number | null;
  tariff_ngn_kwh?: number | string | null;
  band_note?: string | null;
  power_summary?: string | null;
  sources?: SourceLink[] | string | null;
}

export interface TenantReport {
  id: number;
  report_type: 'flood' | 'power';
  area_key?: string | null;
  street?: string | null;
  address?: string | null;
  reporter_name?: string | null;
  source_type?: string | null;
  event_period?: string | null;
  severity?: string | null;
  description?: string | null;
  photo_url?: string | null;
  evidence_url?: string | null;
  avg_daily_hours?: number | string | null;
  outage_pattern?: string | null;
  period?: string | null;
  verified?: boolean | null;
  created_at?: string;
}

export interface ReportUnlock {
  id: number;
  listing_id?: number | null;
  area_key?: string | null;
  address?: string | null;
  amount_ngn?: number | null;
  amount_usd_cents?: number | null;
  stripe_session_id?: string | null;
  status?: string | null;
  customer_email?: string | null;
  paid_at?: string | null;
  created_at?: string;
}

export interface RenterAccount {
  id: number;
  email: string;
  work_destination?: string | null;
  last_seen_at?: string | null;
  created_at?: string;
}

export interface AccountUnlock {
  id: number;
  account_email: string;
  listing_id?: number | null;
  listing_title?: string | null;
  area_key?: string | null;
  address?: string | null;
  unlock_type: 'free' | 'subscription' | string;
  created_at?: string;
}

export interface CurationPrefs {
  budgetMin: number;
  budgetMax: number;
  areas: AreaKey[];
  bedrooms: number; // 0 = any
  mustHaves: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Covered areas (grouped into zones for the pickers)
// ---------------------------------------------------------------------------

export type AreaZone = 'island' | 'central' | 'north';

export const AREA_ZONES: Array<{ key: AreaZone; label: string }> = [
  { key: 'island', label: 'Island & Lekki–Epe corridor' },
  { key: 'central', label: 'Central mainland' },
  { key: 'north', label: 'North & west mainland' },
];

export const AREAS: Array<{ key: AreaKey; name: string; blurb: string; zone: AreaZone }> = [
  // Island & Lekki–Epe corridor
  { key: 'victoria-island', name: 'Victoria Island', blurb: 'Business district · flood-prone island', zone: 'island' },
  { key: 'ikoyi', name: 'Ikoyi', blurb: 'Leafy old money · low-lying foreshore', zone: 'island' },
  { key: 'lekki', name: 'Lekki Phase 1', blurb: 'Island living · watch the floods', zone: 'island' },
  { key: 'chevron', name: 'Chevron / Lekki corridor', blurb: 'New estates · Ikota floodplain', zone: 'island' },
  { key: 'ajah', name: 'Ajah', blurb: 'Corridor value · serious flood diligence', zone: 'island' },
  { key: 'sangotedo', name: 'Sangotedo', blurb: 'Newer estates · corridor value', zone: 'island' },
  { key: 'epe', name: 'Epe corridor', blurb: 'Upland town · budget for backup power', zone: 'island' },
  // Central mainland
  { key: 'surulere', name: 'Surulere', blurb: 'Central mainland · character streets', zone: 'central' },
  { key: 'yaba', name: 'Yaba', blurb: 'Tech cluster · elevated mainland ridge', zone: 'central' },
  { key: 'gbagada', name: 'Gbagada', blurb: 'Elevated ridges · expressway access', zone: 'central' },
  { key: 'shomolu', name: 'Shomolu', blurb: 'Dense & affordable · near Yaba', zone: 'central' },
  { key: 'maryland', name: 'Maryland', blurb: 'Estate living · Mende is the flood pocket', zone: 'central' },
  { key: 'mushin', name: 'Mushin', blurb: 'Ultra-affordable · dense inner mainland', zone: 'central' },
  { key: 'oshodi', name: 'Oshodi', blurb: 'Transit hub · Ilupeju drains best', zone: 'central' },
  { key: 'isolo', name: 'Isolo', blurb: 'Airport-adjacent · avoid Ago Palace floods', zone: 'central' },
  { key: 'festac', name: 'Festac', blurb: 'Planned town · canal-dependent drainage', zone: 'central' },
  // North & west mainland
  { key: 'ikeja', name: 'Ikeja', blurb: 'Capital district · GRA & Band A power', zone: 'north' },
  { key: 'magodo', name: 'Magodo', blurb: 'Gated GRA estates · Band A power', zone: 'north' },
  { key: 'ojodu', name: 'Ojodu Berger', blurb: 'Commuter hub · watch the river fringe', zone: 'north' },
  { key: 'ketu', name: 'Ketu', blurb: 'Budget-friendly · avoid the Mile 12 fringe', zone: 'north' },
  { key: 'agege', name: 'Agege', blurb: 'Upland & affordable · dense grid', zone: 'north' },
  { key: 'alimosho', name: 'Alimosho', blurb: "Lagos's biggest LGA · budget rents", zone: 'north' },
  { key: 'ikorodu', name: 'Ikorodu', blurb: 'Space for your money · upland town core', zone: 'north' },
];

export function areaName(key?: string | null): string {
  const found = AREAS.find((a) => a.key === key);
  return found ? found.name : key || 'Unknown area';
}

/** Best-effort mapping of a free-typed address to a covered area. */
export function detectAreaKey(text: string): AreaKey | null {
  const t = text.toLowerCase();
  // Specific landmarks/sub-areas are checked before broader containers
  // (e.g. Chevron before generic Lekki, Sangotedo before Ajah, Isheri North
  // before Magodo's Isheri fringe, Epe last so 'Lekki-Epe Expressway' doesn't
  // swallow corridor addresses).
  if (t.includes('victoria island') || t.includes('oniru') || t.includes('ahmadu bello') || t.includes('adeola odeku') || t.includes('eko atlantic')) return 'victoria-island';
  if (t.includes('ikoyi') || t.includes('banana island') || t.includes('parkview') || t.includes('osborne') || t.includes('dolphin estate') || t.includes('bourdillon')) return 'ikoyi';
  if (t.includes('chevron') || t.includes('orchid') || t.includes('ikota') || t.includes('osapa') || t.includes('agungi') || t.includes('ologolo')) return 'chevron';
  if (t.includes('sangotedo') || t.includes('ogombo') || t.includes('crown estate') || t.includes('monastery road')) return 'sangotedo';
  if (t.includes('badore') || t.includes('langbasa') || t.includes('thomas estate') || t.includes('abraham adesanya') || t.includes('ajah')) return 'ajah';
  if (t.includes('lekki') || t.includes('admiralty') || t.includes('freedom way') || t.includes('marwa') || t.includes('ikate')) return 'lekki';
  if (t.includes('surulere') || t.includes('aguda') || t.includes('bode thomas') || t.includes('ijesha') || t.includes('lawanson') || t.includes('ojuelegba') || t.includes('iponri') || t.includes('eric moore')) return 'surulere';
  if (t.includes('ebute metta') || t.includes('ebute-metta') || t.includes('yaba') || t.includes('akoka') || t.includes('jibowu') || t.includes('iwaya') || t.includes('makoko') || t.includes('onike') || t.includes('alagomeji') || t.includes('unilag')) return 'yaba';
  if (t.includes('gbagada') || t.includes('soluyi')) return 'gbagada';
  if (t.includes('shomolu') || t.includes('somolu') || t.includes('bariga') || t.includes('obanikoro') || t.includes('palmgrove') || t.includes('pedro')) return 'shomolu';
  if (t.includes('maryland') || t.includes('mende') || t.includes('anthony') || t.includes('onigbongbo')) return 'maryland';
  if (t.includes('idi-araba') || t.includes('idi araba') || t.includes('ilasamaja') || t.includes('papa ajao') || t.includes('odi-olowo') || t.includes('mushin')) return 'mushin';
  if (t.includes('mafoluku') || t.includes('shogunle') || t.includes('ilupeju') || t.includes('oshodi')) return 'oshodi';
  if (t.includes('okota') || t.includes('ago palace') || t.includes('ajao estate') || t.includes('ejigbo') || t.includes('isolo')) return 'isolo';
  if (t.includes('festac') || t.includes('amuwo') || t.includes('satellite town') || t.includes('agboju') || t.includes('mile 2')) return 'festac';
  if (t.includes('isheri north') || t.includes('opic') || t.includes('ojodu') || t.includes('berger') || t.includes('omole') || t.includes('kara ')) return 'ojodu';
  if (t.includes('magodo') || t.includes('shangisha') || t.includes('cmd road') || t.includes('isheri')) return 'magodo';
  if (t.includes('alapere') || t.includes('mile 12') || t.includes('agiliti') || t.includes('owode onirin') || t.includes('ketu')) return 'ketu';
  if (t.includes('ikorodu') || t.includes('majidun') || t.includes('igbogbo') || t.includes('ipakodo') || t.includes('owutu')) return 'ikorodu';
  if (t.includes('ikeja') || t.includes('alausa') || t.includes('allen avenue') || t.includes('opebi') || t.includes('oregun') || t.includes('ogba') || t.includes('computer village')) return 'ikeja';
  if (t.includes('oko-oba') || t.includes('oko oba') || t.includes('fagba') || t.includes('pen cinema') || t.includes('agege')) return 'agege';
  if (t.includes('alimosho') || t.includes('egbeda') || t.includes('akowonjo') || t.includes('idimu') || t.includes('ipaja') || t.includes('ayobo') || t.includes('igando') || t.includes('ikotun')) return 'alimosho';
  // 'epe' is a substring of common words (e.g. "Independence"), so it is only
  // checked once every other area has failed to match.
  if (t.includes('epe')) return 'epe';
  return null;
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

export function naira(n?: number | string | null): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v == null || isNaN(v)) return '₦—';
  return `₦${Math.round(v).toLocaleString('en-NG')}`;
}

export function nairaShort(n?: number | string | null): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v == null || isNaN(v)) return '₦—';
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `₦${(Math.round(m * 10) / 10).toString().replace(/\.0$/, '')}m`;
  }
  if (v >= 1_000) return `₦${Math.round(v / 1_000)}k`;
  return `₦${v}`;
}

// ---------------------------------------------------------------------------
// JSON column helpers (WorkspaceDB json columns may come back parsed or raw)
// ---------------------------------------------------------------------------

export function asArray<T = any>(value: T[] | string | null | undefined): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Monetization — report unlock pricing
//
// Nothing renders these two since the 2026-08 freemium rebuild — unlocking runs
// on FREE_UNLOCK_LIMIT plus the subscription below. They are kept as the
// founder's locked v0 per-report price.
// ---------------------------------------------------------------------------

/** Display price in Naira for unlocking one full verification report (v0 locked price). */
export const UNLOCK_PRICE_NGN = 10000;
/**
 * Amount actually charged through Stripe, in USD cents. Stripe checkout runs in
 * USD, so this tracks the Naira price above at the prevailing rate
 * (₦10,000 ≈ $7.20 at ~₦1,390/USD, August 2026 — picked between the CBN
 * official rate ~₦1,368 and the parallel rate ~₦1,415, so the debit lands
 * within ~2% of ₦10,000 whichever rate the renter's bank applies).
 * Update both together.
 */
export const UNLOCK_PRICE_USD_CENTS = 720;

// ---------------------------------------------------------------------------
// Freemium model (2026-08): browsing is free; every account gets
// FREE_UNLOCK_LIMIT lifetime report unlocks; after that a monthly
// subscription unlocks reports with no per-report friction.
// ---------------------------------------------------------------------------

/** Lifetime free full-report unlocks per account (tracked in account_unlocks). */
export const FREE_UNLOCK_LIMIT = 5;

/** Customer-facing plan name — shown on the pricing card and the account page. */
export const SUBSCRIPTION_PLAN_NAME = 'Veranda Monthly';

/**
 * Monthly subscription display price in Naira — the figure every price line in
 * the app shows. LOCKED by the founder at ₦7,000/month (August 2026) — do not
 * change without founder approval.
 */
export const SUBSCRIPTION_PRICE_NGN = 7000;

/**
 * The currency Stripe actually CHARGES the subscription in. This is the single
 * switch behind both the amount sent to /api/payments/subscribe and every
 * "charged as …" line shown to renters — see subscriptionCharge() below.
 *
 * 'usd' (current): Veranda quotes ₦ but Stripe debits USD, so the naira a card
 *   is really debited drifts with the exchange rate and
 *   SUBSCRIPTION_PRICE_USD_CENTS needs an occasional founder-approved rebase.
 *   Drift is watched automatically — see the note on that constant below.
 * 'ngn': charges the naira price directly — the drift disappears for good.
 *
 * DO NOT flip this to 'ngn' until Stripe Naira payment methods are confirmed
 * live on the Stripe account that processes Veranda's payments (Stripe
 * Dashboard → Settings → Payment methods). Naira presentment is an
 * invite-only Stripe preview served through Stripe's Nigerian
 * merchant-of-record partner; sending currency 'ngn' before it is enabled
 * makes Stripe reject the checkout for every customer. This workspace bills
 * through the Audos platform's Stripe account, so either Audos enables Naira
 * there, or the workspace moves to Stripe Connect (Wallet → Accept Payments)
 * on a US-based account holding the Nigeria market invite.
 *
 * When it is flipped, four things do not follow automatically: retire
 * SUBSCRIPTION_PRICE_USD_CENTS and UNLOCK_PRICE_USD_CENTS; update the pricing
 * paragraph in agent/customer-prompt.md (static text this switch cannot
 * reach); decide what happens to renters already on a USD subscription, since
 * Stripe cannot change the currency of a live subscription; and present
 * VAT-inclusive prices, which Stripe requires for Nigerian customers.
 */
export const SUBSCRIPTION_CHARGE_CURRENCY: 'usd' | 'ngn' = 'usd';

/**
 * Amount charged through Stripe each month while SUBSCRIPTION_CHARGE_CURRENCY
 * is 'usd', in USD cents. It tracks the Naira price above at the prevailing
 * rate (₦7,000 ≈ $5.04 at ~₦1,389/USD, rebased 4 August 2026 when the founder
 * locked the plan at ₦7,000/month — picked between the CBN official rate
 * ~₦1,368 and the parallel/BDC rate ~₦1,415, so the $5.04 debit lands at
 * ₦6,895–7,131, within ~2% of ₦7,000 whichever rate the renter's bank
 * applies). This is the live recurring charge for existing subscribers too,
 * so confirm any change with the founder before publishing, and keep
 * agent/customer-prompt.md's and workspace-branding.json's quoted USD figures
 * in step.
 *
 * DRIFT IS MONITORED AUTOMATICALLY (since 2026-08-04): the weekly
 * task-scheduler job "Veranda weekly subscription FX drift check" runs the
 * veranda-fx-drift-check server-function hook, which reads this constant's
 * LIVE published value from the site bundle (so a rebase + publish retunes
 * the check by itself), sources the CBN official/NFEM and parallel/BDC
 * USD/NGN rates, and keeps execution output in internal hook/scheduler logs.
 * When notifyEmail is set on the schedule payload, it emails the founder ONLY
 * when either end drifts more than ~2% from the naira price — with a suggested
 * new cents figure. It never writes to customer or founder chat history. The
 * job never edits code; the rebase stays a manual, founder-reviewed change
 * here.
 */
export const SUBSCRIPTION_PRICE_USD_CENTS = 504;

export interface SubscriptionCharge {
  /** Three-letter lowercase ISO code for /api/payments/subscribe. */
  currency: 'usd' | 'ngn';
  /** Minor units — both USD and NGN are two-decimal currencies in Stripe. */
  priceCents: number;
  /** Customer-facing clause describing what the card is actually debited. */
  note: string;
}

/**
 * What Stripe should charge, and how to describe it honestly to the renter.
 * The checkout call and every "charged as …" line derive from this, so
 * flipping SUBSCRIPTION_CHARGE_CURRENCY moves the whole app together.
 */
export function subscriptionCharge(): SubscriptionCharge {
  if (SUBSCRIPTION_CHARGE_CURRENCY === 'ngn') {
    return {
      currency: 'ngn',
      priceCents: SUBSCRIPTION_PRICE_NGN * 100,
      note: `billed in naira — exactly ₦${SUBSCRIPTION_PRICE_NGN.toLocaleString()} every month`,
    };
  }
  return {
    currency: 'usd',
    priceCents: SUBSCRIPTION_PRICE_USD_CENTS,
    note: `charged as $${(SUBSCRIPTION_PRICE_USD_CENTS / 100).toFixed(2)} USD/month`,
  };
}

/** Secondary MRR line for the admin dashboard — what Stripe actually bills. */
export function mrrChargeHint(activeSubscribers: number | null): string {
  if (activeSubscribers == null) return 'active subscribers × price';
  if (SUBSCRIPTION_CHARGE_CURRENCY === 'ngn') return 'billed in naira — no exchange-rate drift';
  return `≈ $${((activeSubscribers * SUBSCRIPTION_PRICE_USD_CENTS) / 100).toFixed(0)} USD/mo`;
}

// ---------------------------------------------------------------------------
// Must-have vocabulary (used by intake + seeded listings)
// ---------------------------------------------------------------------------

export const MUST_HAVE_OPTIONS = [
  'Gated estate',
  'Prepaid meter',
  'Borehole water',
  'Parking space',
  'Upstairs unit',
  'Newly built',
  'Serviced',
  'Close to major road',
];
