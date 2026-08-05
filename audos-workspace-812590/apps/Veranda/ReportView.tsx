/**
 * Veranda — Verification Report (the unlocked report itself).
 *
 * Design contract:
 * - Location map first, then five stacked dimension cards (flood, power,
 *   distance-to-work, network, security), then sources + a muted disclaimer.
 *   This is an invariant: no report variant may omit a dimension, even when
 *   its lookup is unavailable.
 * - Every card carries a plain-language one-line headline and a color-coded
 *   pill: Good (green) / Fair (amber) / Watch out (red) / Improving (gray).
 *   "Improving" is used whenever confidence in the data is low — missing data
 *   must read as "not measured yet", never as a danger signal.
 * - Commute is public-transit first: total distance, a 7:30am weekday travel
 *   time, Lagos mode tags, and numbered board/alight steps. Driving is a
 *   comparison or the explicit coverage fallback when transit returns no
 *   route. Provider failures show a retryable unavailable state; with no
 *   saved destination the card shows the non-blocking “Where do you commute
 *   to?” capture. A destination is ANY labelled place the renter goes often
 *   (work, school, market, church, family) — up to three per account,
 *   switchable right on the card; the active one is what the card routes to.
 *   Only REAL provider routes are shown — no straight-line guesses. Edits
 *   update the account-level destinations every report reads.
 * - Network coverage is a per-carrier breakdown (MTN / Airtel / Glo /
 *   9mobile). Tiers come from a published-coverage-reports baseline and are
 *   superseded per carrier by live OpenCelliD cell-site lookups as those
 *   land (see coverage.ts) — each row names its source, and nothing is
 *   presented as real-time or independently verified. A gray "Data
 *   unavailable" row appears only when a carrier has neither.
 * - Security is NEVER scored: always an "Improving" badge, plus any security
 *   features the lister advertised, clearly labelled as unverified.
 *
 * Unlock gating lives in ReportGate.tsx — this component assumes the renter
 * already has access.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import {
  Droplets,
  Zap,
  Shield,
  ExternalLink,
  BadgeCheck,
  Users,
  Info,
  Wifi,
  Car,
  Bus,
  Briefcase,
  ChevronDown,
  Loader2,
  MapPin,
  PlusCircle,
  RefreshCw,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import {
  AreaKey,
  AreaProfile,
  FloodClass,
  FloodZone,
  Listing,
  SourceLink,
  TenantReport,
  areaName,
  asArray,
} from './types';
import { CoverageResolution, CoverageTier, resolveCoverage } from './coverage';
import { CommuteDestination, MAX_COMMUTE_DESTINATIONS } from './account';
import { fetchDestinationSuggestions } from './commute';

// ---------------------------------------------------------------------------
// Badge pills — the four confidence tones of the report
// ---------------------------------------------------------------------------

export type BadgeTone = 'good' | 'fair' | 'watch' | 'improving';

const TONE_META: Record<BadgeTone, { label: string; cls: string }> = {
  good: {
    label: 'Good',
    cls: 'bg-[var(--space-semantic-success-100)] text-[var(--space-semantic-success-700)]',
  },
  fair: {
    label: 'Fair',
    cls: 'bg-[var(--space-semantic-warning-100)] text-[var(--space-semantic-warning-700)]',
  },
  watch: {
    label: 'Watch out',
    cls: 'bg-[var(--space-semantic-danger-100)] text-[var(--space-semantic-danger-700)]',
  },
  improving: {
    label: 'Improving',
    cls: 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] border border-[var(--space-border-default)]',
  },
};

function Pill({ tone, label }: { tone: BadgeTone; label?: string }) {
  return (
    <span
      className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] ${typography.weight.semibold} ${TONE_META[tone].cls}`}
      data-testid={`pill-${tone}`}
    >
      {label || TONE_META[tone].label}
    </span>
  );
}

const FLOOD_CLASS_META: Record<FloodClass, { label: string; badge: string; fill: string }> = {
  high: { label: 'High risk', badge: `${tw.badge.default} ${tw.badge.danger}`, fill: 'var(--space-semantic-danger)' },
  moderate: { label: 'Moderate', badge: `${tw.badge.default} ${tw.badge.warning}`, fill: 'var(--space-semantic-warning)' },
  low: { label: 'Low risk', badge: `${tw.badge.default} ${tw.badge.success}`, fill: 'var(--space-semantic-success)' },
};

const SEVERITY_META: Record<string, { label: string; badge: string }> = {
  none: { label: 'No flooding', badge: `${tw.badge.default} ${tw.badge.success}` },
  ankle: { label: 'Ankle-deep', badge: `${tw.badge.default} ${tw.badge.warning}` },
  knee: { label: 'Knee-deep', badge: `${tw.badge.default} ${tw.badge.warning}` },
  waist: { label: 'Waist-deep', badge: `${tw.badge.default} ${tw.badge.danger}` },
  severe: { label: 'Severe', badge: `${tw.badge.default} ${tw.badge.danger}` },
};

const SOURCE_META: Record<string, string> = {
  founder: 'Veranda-verified',
  tenant: 'Tenant report',
  social: 'Social evidence',
  seed: 'Seed example — pending verification',
};

/** "July 2025 rains · Tenant report · Tunde A." — skips whatever is missing. */
function sourceLine(r: TenantReport, when?: string | null): string {
  return [when, SOURCE_META[r.source_type || 'tenant'] || 'Tenant report', r.reporter_name]
    .filter(Boolean)
    .join(' · ');
}

function parseFloodClass(value?: string | null): FloodClass {
  if (value === 'high' || value === 'moderate' || value === 'low') return value;
  return 'moderate';
}

function firstSentence(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/^[^.!?]+[.!?]/);
  return match ? match[0].trim() : text.trim();
}

// ---------------------------------------------------------------------------
// Plain-language derivations from the verified lookups
// ---------------------------------------------------------------------------

function floodPresentation(profile?: AreaProfile): { tone: BadgeTone; headline: string; detail: string | null } {
  if (!profile?.flood_zone_class) {
    return {
      tone: 'improving',
      headline: 'Flood picture is still building',
      detail:
        'The flood lookup for this address has not landed yet. Missing data here means "not measured yet" — not safe, and not dangerous.',
    };
  }
  const cls = parseFloodClass(profile.flood_zone_class);
  const headline =
    cls === 'low'
      ? 'Low flood risk area'
      : cls === 'moderate'
        ? 'Some streets flood in heavy rain'
        : 'Flood-prone area — check the exact street';
  const tone: BadgeTone = cls === 'low' ? 'good' : cls === 'moderate' ? 'fair' : 'watch';
  return { tone, headline, detail: firstSentence(profile.flood_summary) || profile.flood_zone_label || null };
}

function powerPresentation(
  profile: AreaProfile | undefined,
  tenantAvgHours: number | null,
  tenantReportCount: number
): { tone: BadgeTone; headline: string; detail: string | null } {
  const band = (profile?.disco_band || '').toUpperCase() || null;
  if (!band) {
    return {
      tone: 'improving',
      headline: 'Power picture is still building',
      detail:
        'The official tariff-band lookup for this address has not landed yet — it will appear here as soon as it does.',
    };
  }
  const BAND_MAP: Record<string, { tone: BadgeTone; headline: string }> = {
    A: { tone: 'good', headline: 'Reliable grid power' },
    B: { tone: 'good', headline: 'Solid grid power most of the day' },
    C: { tone: 'fair', headline: 'Grid power about half the day' },
    D: { tone: 'watch', headline: 'Weak grid supply — budget for backup' },
    E: { tone: 'watch', headline: 'Very weak grid supply — budget for backup' },
  };
  const meta = BAND_MAP[band] || { tone: 'improving' as BadgeTone, headline: 'Power picture is still building' };
  const parts: string[] = [];
  if (profile?.disco_name) parts.push(profile.disco_name);
  if (profile?.band_hours_min != null && profile?.tariff_ngn_kwh != null) {
    parts.push(
      `committed minimum ${profile.band_hours_min} hours a day at about ₦${Number(profile.tariff_ngn_kwh).toLocaleString()}/kWh`
    );
  } else if (profile?.band_hours_min != null) {
    parts.push(`committed minimum ${profile.band_hours_min} hours of supply a day`);
  }
  let detail = parts.length > 0 ? `${parts.join(' — ')}.` : null;
  if (tenantAvgHours != null) {
    detail = `${detail ? `${detail} ` : ''}Tenants on the ground report ~${tenantAvgHours} hrs/day, based on ${tenantReportCount} tenant ${tenantReportCount === 1 ? 'report' : 'reports'}.`;
  }
  return { ...meta, detail };
}

// ---------------------------------------------------------------------------
// Commute data (renders richly when measured route data exists; honest
// gray state when not — never a straight-line guess)
// ---------------------------------------------------------------------------

type LagosMode = 'walk' | 'brt' | 'bus' | 'danfo' | 'keke' | 'ferry' | 'rail' | 'drive' | 'transit';

interface CommuteStep {
  instruction: string;
  line?: string | null;
  distance?: string | null;
  duration?: string | null;
  mode?: LagosMode | null;
}

interface CommuteRoute {
  mode: string; // 'driving' | 'transit'
  minutes?: number | null;
  distanceKm?: number | null;
  steps?: CommuteStep[] | null;
}

interface CommuteInfo {
  driveMinutes: number;
  destination?: string | null;
  distanceKm?: number | null;
  routes: CommuteRoute[];
  /** e.g. 'typical weekday 7:30am Lagos conditions'. */
  trafficLabel?: string | null;
  /** Honest provenance line (what was measured, from where, when). */
  measuredNote?: string | null;
}

/**
 * Commute data arrives as a `commute` json payload attached to the listing —
 * an exact measured route or an area→hub baseline picked by resolveCommute()
 * (apps/Veranda/commute.ts, fed by the veranda-measure-commutes hook) — with
 * the area profile row as a fallback. When nothing measured exists this
 * returns null and the card renders the honest "Improving" state — never a
 * straight-line guess.
 */
function parseCommute(listing?: Listing | null, profile?: AreaProfile): CommuteInfo | null {
  const raw = (listing as { commute?: unknown } | null | undefined)?.commute ??
    (profile as unknown as { commute?: unknown } | undefined)?.commute;
  if (!raw) return null;
  let obj: any = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const routes: CommuteRoute[] = Array.isArray(obj.routes)
    ? obj.routes.filter((r: any) => r && typeof r.mode === 'string')
    : [];
  const driving = routes.find((r) => r.mode === 'driving');
  const driveMinutes =
    typeof obj.driveMinutes === 'number'
      ? obj.driveMinutes
      : typeof driving?.minutes === 'number'
        ? driving.minutes
        : null;
  if (driveMinutes == null) return null;
  return {
    driveMinutes,
    destination: typeof obj.destination === 'string' ? obj.destination : null,
    distanceKm: typeof obj.distanceKm === 'number' ? obj.distanceKm : null,
    routes,
    trafficLabel: typeof obj.trafficLabel === 'string' ? obj.trafficLabel : null,
    measuredNote: typeof obj.measuredNote === 'string' ? obj.measuredNote : null,
  };
}

/** Badge tone from the car commute: <30 min Good, 30–60 Fair, >60 Watch out. */
function commuteTone(driveMinutes: number): BadgeTone {
  if (driveMinutes < 30) return 'good';
  if (driveMinutes <= 60) return 'fair';
  return 'watch';
}

function parseDistanceKm(text?: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/([\d.]+)\s*(km|m)\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (isNaN(value)) return null;
  return m[2].toLowerCase() === 'km' ? value : value / 1000;
}

/** Sum per-step distances ("2.3 km", "450 m") into a route total, in km. */
function totalDistanceKm(steps?: CommuteStep[] | null): number | null {
  if (!steps || steps.length === 0) return null;
  let total = 0;
  let found = false;
  for (const step of steps) {
    const km = parseDistanceKm(step.distance);
    if (km != null) {
      total += km;
      found = true;
    }
  }
  return found ? Math.round(total * 10) / 10 : null;
}

const MODE_META: Record<LagosMode, { emoji: string; label: string }> = {
  walk: { emoji: '🚶', label: 'Walk' },
  brt: { emoji: '🚌', label: 'BRT' },
  bus: { emoji: '🚌', label: 'Bus' },
  danfo: { emoji: '🚐', label: 'Danfo' },
  keke: { emoji: '🛺', label: 'Keke' },
  ferry: { emoji: '⛴️', label: 'Ferry' },
  rail: { emoji: '🚆', label: 'Rail' },
  drive: { emoji: '🚗', label: 'Drive' },
  transit: { emoji: '🚌', label: 'Transit' },
};

function inferLagosMode(step: CommuteStep): LagosMode {
  if (step.mode && MODE_META[step.mode]) return step.mode;
  const text = `${step.line || ''} ${step.instruction || ''}`.toLowerCase();
  if (/\bbrt\b|lagbus|blue line bus|red line bus/.test(text)) return 'brt';
  if (/\bkeke\b|napep|tricycle/.test(text)) return 'keke';
  if (/\bdanfo\b|shared taxi/.test(text)) return 'danfo';
  if (/ferry|boat/.test(text)) return 'ferry';
  if (/train|rail|metro/.test(text)) return 'rail';
  if (/walk|foot/.test(text)) return 'walk';
  return 'bus';
}

/** Tighten older generic provider steps into board / alight Lagos directions. */
function localizeTransitStep(step: CommuteStep): CommuteStep {
  const mode = inferLagosMode(step);
  const ride = step.instruction.match(/^Ride from (.+?) to (.+?)(?: \(toward (.+)\))?(?: · \d+ stops)?$/i);
  if (!ride) return { ...step, mode };
  const label = step.line || MODE_META[mode].label;
  return {
    ...step,
    mode,
    instruction: `Board ${label}${ride[3] ? ` towards ${ride[3]}` : ''} at ${ride[1]} — alight at ${ride[2]}`,
  };
}

function commuteModes(steps: CommuteStep[] | null, fallbackToDriving: boolean): LagosMode[] {
  if (fallbackToDriving) return ['drive'];
  const modes: LagosMode[] = [];
  for (const step of steps || []) {
    const mode = inferLagosMode(step);
    if (!modes.includes(mode)) modes.push(mode);
  }
  return modes.length > 0 ? modes : ['transit'];
}

// ---------------------------------------------------------------------------
// Network coverage — per-carrier tier badges (same semantic palette as the
// report's other status badges: green / amber / red / gray)
// ---------------------------------------------------------------------------

const CARRIER_TIER_META: Record<CoverageTier | 'pending' | 'unavailable', { label: string; cls: string }> = {
  good: {
    label: 'Good',
    cls: 'bg-[var(--space-semantic-success-100)] text-[var(--space-semantic-success-700)]',
  },
  fair: {
    label: 'Fair',
    cls: 'bg-[var(--space-semantic-warning-100)] text-[var(--space-semantic-warning-700)]',
  },
  limited: {
    label: 'Limited',
    cls: 'bg-[var(--space-semantic-danger-100)] text-[var(--space-semantic-danger-700)]',
  },
  none: {
    label: 'No coverage',
    cls: 'bg-[var(--space-semantic-danger-100)] text-[var(--space-semantic-danger-700)]',
  },
  pending: {
    label: 'Data unavailable',
    cls: 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] border border-[var(--space-border-default)]',
  },
  unavailable: {
    label: 'Data unavailable',
    cls: 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] border border-[var(--space-border-default)]',
  },
};

function coverageDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Security features the lister advertised (never independently verified)
// ---------------------------------------------------------------------------

const SECURITY_FEATURE_MATCHERS: Array<{ label: string; re: RegExp }> = [
  { label: 'Gated estate', re: /gated\s+(estate|community|compound)|access[- ]?controlled/i },
  { label: 'CCTV', re: /\bcctv\b|security camera/i },
  { label: '24-hour security', re: /24[\s/-]?(hr|hrs|hours?|7)[^.]{0,24}security|security[^.]{0,24}24[\s/-]?(hr|hrs|hours?|7)/i },
  { label: 'Security post / gatehouse', re: /security post|gate\s?house|gateman/i },
  { label: 'Fenced compound', re: /fenced/i },
  { label: 'Estate security', re: /estate security|uniformed security|tight security|top-?notch security/i },
];

function advertisedSecurityFeatures(listing?: Listing | null): string[] {
  if (!listing) return [];
  const haystack = [...asArray<string>(listing.features), listing.title || '', listing.description || ''].join(' • ');
  return SECURITY_FEATURE_MATCHERS.filter((m) => m.re.test(haystack)).map((m) => m.label);
}

// ---------------------------------------------------------------------------
// Location map — schematic, full width, pin on the covered area
// ---------------------------------------------------------------------------

const MAP_BLOCKS: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 12, y: 12, w: 74, h: 40 },
  { x: 96, y: 10, w: 88, h: 34 },
  { x: 196, y: 14, w: 62, h: 38 },
  { x: 270, y: 10, w: 78, h: 44 },
  { x: 16, y: 62, w: 62, h: 46 },
  { x: 252, y: 66, w: 94, h: 42 },
  { x: 18, y: 120, w: 86, h: 46 },
  { x: 116, y: 126, w: 96, h: 40 },
  { x: 224, y: 122, w: 56, h: 44 },
  { x: 292, y: 120, w: 54, h: 46 },
];

function LocationMap({ areaKey, address }: { areaKey: AreaKey; address: string }) {
  return (
    <div data-testid="map-location">
      <div className="relative rounded-2xl overflow-hidden border border-[var(--space-border-default)]">
        <svg
          viewBox="0 0 360 180"
          className="w-full block"
          role="img"
          aria-label={`Schematic map showing the approximate location of ${address} in ${areaName(areaKey)}`}
        >
          <rect width="360" height="180" fill="var(--space-surface-muted)" />
          {MAP_BLOCKS.map((b) => (
            <rect
              key={`${b.x}-${b.y}`}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx="7"
              fill="var(--space-surface-card)"
              stroke="var(--space-border-default)"
              strokeWidth="1"
            />
          ))}
          <rect x="88" y="62" width="58" height="46" rx="10" fill="var(--space-semantic-success)" opacity="0.14" />
          <path
            d="M0,132 C70,124 130,100 196,96 C258,92 318,66 360,58"
            stroke="var(--space-surface-page)"
            strokeWidth="11"
            fill="none"
          />
          <path
            d="M0,132 C70,124 130,100 196,96 C258,92 318,66 360,58"
            stroke="var(--space-border-strong)"
            strokeWidth="1.5"
            strokeDasharray="5 5"
            fill="none"
            opacity="0.8"
          />
          <path d="M212,0 C210,60 216,120 208,180" stroke="var(--space-surface-page)" strokeWidth="7" fill="none" />
          <circle cx="180" cy="86" r="20" fill="var(--space-brand-primary)" opacity="0.14" />
          <path
            d="M180 60c-9.4 0-17 7.6-17 17 0 12.6 17 29 17 29s17-16.4 17-29c0-9.4-7.6-17-17-17z"
            fill="var(--space-brand-primary)"
          />
          <circle cx="180" cy="77" r="6" fill="var(--space-surface-card)" />
        </svg>
        <span className="absolute bottom-2 left-2 px-2.5 py-1 rounded-full text-[11px] font-medium bg-black/50 text-white backdrop-blur-sm pointer-events-none">
          {areaName(areaKey)}
        </span>
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/40 text-white backdrop-blur-sm pointer-events-none">
          Approximate
        </span>
      </div>
      <p className={`text-[10px] mt-1.5 ${typography.color.muted}`}>
        Schematic area map — the pin marks the {areaName(areaKey)} area, not the surveyed plot.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dimension card — the shared anatomy of the five report cards
// ---------------------------------------------------------------------------

function DimensionCard({
  testId,
  icon: Icon,
  dimension,
  headline,
  tone,
  statusLabel,
  detail,
  children,
  expand,
  expandLabel = 'See the data behind this',
  headlineClassName,
}: {
  testId: string;
  icon: ComponentType<{ className?: string }>;
  dimension: string;
  headline: string;
  /** Overrides the default headline size/weight (e.g. the commute headline). */
  headlineClassName?: string;
  tone: BadgeTone;
  /** Optional explicit gray-state label such as “Data unavailable”. */
  statusLabel?: string;
  detail?: string | null;
  children?: ReactNode;
  expand?: ReactNode;
  expandLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${tw.card.default} rounded-2xl p-4`} data-testid={testId}>
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tw.bg.accent}`}>
          <Icon className={`w-[18px] h-[18px] ${tw.icon.primary}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-[10px] uppercase tracking-wide ${typography.color.muted}`}>{dimension}</p>
              <p
                className={`leading-snug mt-0.5 ${headlineClassName || `text-[15px] ${typography.weight.semibold}`} ${typography.color.primary}`}
              >
                {headline}
              </p>
            </div>
            <Pill tone={tone} label={statusLabel} />
          </div>
          {detail && (
            <p className={`text-xs mt-1.5 leading-relaxed ${typography.color.muted}`}>{detail}</p>
          )}
          {children}
          {expand && (
            <>
              <button
                onClick={() => setOpen((o) => !o)}
                className={`mt-2.5 inline-flex items-center gap-1 py-1 text-xs ${typography.weight.medium} ${typography.color.brand}`}
                aria-expanded={open}
                data-testid={`${testId}-toggle`}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                {open ? 'Hide the detail' : expandLabel}
              </button>
              {open && (
                <div className="mt-2 pt-3 border-t border-[var(--space-border-default)]">{expand}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commute route section — collapsible turn-by-turn timeline
// ---------------------------------------------------------------------------

function RouteSection({
  icon: Icon,
  title,
  subtitle,
  steps,
  testId,
  defaultOpen = false,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string | null;
  steps?: CommuteStep[] | null;
  testId: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const stepList = steps || [];
  const expandable = stepList.length > 0;
  const header = (
    <>
      <Icon className={`w-4 h-4 shrink-0 ${tw.icon.primary}`} />
      <span className="flex-1 min-w-0">
        <span className={`block text-sm ${typography.weight.semibold} ${typography.color.primary}`}>{title}</span>
        {subtitle && <span className={`block text-[11px] mt-0.5 ${typography.color.muted}`}>{subtitle}</span>}
      </span>
    </>
  );
  return (
    <div className="border border-[var(--space-border-default)] rounded-xl overflow-hidden" data-testid={testId}>
      {expandable ? (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--space-surface-muted)] transition-colors"
          aria-expanded={open}
          data-testid={`${testId}-toggle`}
        >
          {header}
          <ChevronDown
            className={`w-4 h-4 shrink-0 transition-transform ${tw.icon.muted} ${open ? 'rotate-180' : ''}`}
          />
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5">{header}</div>
      )}
      {expandable && open && (
        <ol className="px-3 pb-3 pt-1">
          {stepList.map((step, i) => (
            <li key={i} className="relative pl-9 pb-3.5 last:pb-0">
              {i < stepList.length - 1 && (
                <span
                  className="absolute left-[11px] top-[24px] bottom-0 w-px bg-[var(--space-border-default)]"
                  aria-hidden="true"
                />
              )}
              <span
                className={`absolute left-0 top-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] ${typography.weight.semibold} ${tw.bg.accent} ${typography.color.brand}`}
              >
                {i + 1}
              </span>
              <p className={`text-xs leading-relaxed ${typography.color.primary}`}>{step.instruction}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {step.line && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] ${typography.weight.medium} ${tw.bg.accent} ${typography.color.brand}`}>
                    {step.line}
                  </span>
                )}
                {(step.distance || step.duration) && (
                  <span className={`text-[10px] ${typography.color.muted}`}>
                    {[step.distance, step.duration].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schematic flood-zone map overlay (flood card detail)
// ---------------------------------------------------------------------------

const ZONE_SLOTS: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 8, y: 8, w: 148, h: 84 },
  { x: 164, y: 8, w: 148, h: 84 },
  { x: 8, y: 100, w: 96, h: 84 },
  { x: 112, y: 100, w: 116, h: 84 },
  { x: 236, y: 100, w: 76, h: 84 },
];

function FloodZoneMap({ zones }: { zones: FloodZone[] }) {
  const visible = zones.slice(0, ZONE_SLOTS.length);
  return (
    <div>
      <div className="rounded-xl overflow-hidden border border-[var(--space-border-default)]">
        <svg viewBox="0 0 320 192" className="w-full block" role="img" aria-label="Schematic flood zone map">
          <rect x="0" y="0" width="320" height="192" fill="var(--space-surface-muted)" />
          {[32, 64, 96, 128, 160].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="320" y2={y} stroke="var(--space-border-default)" strokeWidth="1" />
          ))}
          {[40, 80, 120, 160, 200, 240, 280].map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="192" stroke="var(--space-border-default)" strokeWidth="1" />
          ))}
          {visible.map((zone, i) => {
            const slot = ZONE_SLOTS[i];
            const meta = FLOOD_CLASS_META[parseFloodClass(zone.class)];
            return (
              <g key={zone.name}>
                <rect
                  x={slot.x}
                  y={slot.y}
                  width={slot.w}
                  height={slot.h}
                  rx="10"
                  fill={meta.fill}
                  opacity="0.22"
                  stroke={meta.fill}
                  strokeWidth="1.5"
                />
                <text
                  x={slot.x + 8}
                  y={slot.y + 18}
                  fontSize="9"
                  fontWeight="600"
                  fill="var(--space-text-primary)"
                >
                  {zone.name.length > 26 ? `${zone.name.slice(0, 25)}…` : zone.name}
                </text>
                <text x={slot.x + 8} y={slot.y + 31} fontSize="8" fill="var(--space-text-muted)">
                  {FLOOD_CLASS_META[parseFloodClass(zone.class)].label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        {(['low', 'moderate', 'high'] as FloodClass[]).map((c) => (
          <span key={c} className={`inline-flex items-center gap-1.5 text-[11px] ${typography.color.muted}`}>
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FLOOD_CLASS_META[c].fill, opacity: 0.6 }} />
            {FLOOD_CLASS_META[c].label}
          </span>
        ))}
        <span className={`text-[10px] ml-auto ${typography.color.muted}`}>Schematic — indicative, not a survey plan</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report view (unlocked)
// ---------------------------------------------------------------------------

interface ReportViewProps {
  listing?: Listing | null;
  areaKey: AreaKey;
  address: string;
  profile: AreaProfile | undefined;
  reports: TenantReport[];
  /**
   * Resolved per-carrier network coverage (resolveCoverage in coverage.ts).
   * When omitted the card renders the honest all-pending state.
   */
  coverage?: CoverageResolution | null;
  /** The renter's saved commute destinations (label + address), if any. */
  destinations?: CommuteDestination[];
  /** Index of the saved destination the commute card currently routes to. */
  activeDestinationIndex?: number;
  /**
   * Persist a destination for this account. `index` null appends a new
   * destination (it becomes active); a number replaces that entry. Must
   * THROW on failure so the editor can show the real reason inline.
   */
  onSaveDestination?: (dest: CommuteDestination, index: number | null) => void | Promise<void>;
  /** Switch which saved destination the commute card routes to. */
  onSelectDestination?: (index: number) => void | Promise<void>;
  /** Live provider request state when no cached route is available. */
  commuteRequestState?: 'idle' | 'loading' | 'error';
  /** Retry an unavailable or failed commute request. */
  onRetryCommute?: () => void;
  /** Opens the tenant submit-a-report flow, prefilled for this area. */
  onSubmitReport?: () => void;
  /**
   * Community-sourced qualitative security signal (used by the public sample
   * report). When set, the security card leads with this line under a
   * "Community-sourced" label instead of the listing-amenities view. The
   * badge stays the neutral gray tone — security is still never scored.
   */
  communitySecuritySignal?: string | null;
}

function SubmitReportPrompt({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      onClick={onClick}
      className={`mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs ${tw.button.secondary}`}
      data-testid="button-add-tenant-report"
    >
      <PlusCircle className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

/**
 * Destination capture + edit for the commute card. A destination is ANY place
 * the renter commutes to — office, school, market, church, family house —
 * saved with a short renter-chosen label to their account
 * (renter_destinations snapshots, account.ts). Saved once, it powers every
 * report; the commute is a lookup, not stored per report.
 *
 * The address input autocompletes real Lagos addresses as the renter types
 * (fetchDestinationSuggestions in commute.ts — Google Places when the
 * founder's key allows it, OpenStreetMap Nominatim otherwise): debounced
 * 300ms, min 3 characters, tap or arrow-keys + Enter to fill the full
 * formatted address. The label field stays plain free text.
 */
const LABEL_SUGGESTIONS = ['Work', 'School', 'Market', 'Church', 'Family'];

export function DestinationEditor({
  initial,
  onSave,
  onCancel,
  saveLabel = 'Save',
}: {
  initial?: CommuteDestination | null;
  /** Must THROW on failure — the editor shows the error message inline. */
  onSave: (dest: CommuteDestination) => void | Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const [label, setLabel] = useState(initial?.label || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Address autocomplete state: suggestions for the CURRENT text, whether the
  // dropdown is open, and which row the arrow keys have highlighted.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const lookupRef = useRef<AbortController | null>(null);
  // Suppress one lookup: starts true so the MOUNT run never pops the dropdown
  // over a prefilled address (editing an existing destination), and picking a
  // suggestion re-arms it so the pick doesn't immediately re-open the list.
  const suppressLookupRef = useRef(true);

  useEffect(() => {
    if (suppressLookupRef.current) {
      suppressLookupRef.current = false;
      return;
    }
    const query = address.trim();
    if (query.length < 3) {
      lookupRef.current?.abort();
      setSuggestions([]);
      setSuggestionsOpen(false);
      setHighlightedIndex(-1);
      return;
    }
    const timer = setTimeout(async () => {
      lookupRef.current?.abort();
      const controller = new AbortController();
      lookupRef.current = controller;
      try {
        const list = await fetchDestinationSuggestions(query, controller.signal);
        if (controller.signal.aborted) return;
        setSuggestions(list);
        setSuggestionsOpen(list.length > 0);
        setHighlightedIndex(-1);
      } catch {
        /* superseded lookup or offline — keep what is on screen */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [address]);

  // Abort any in-flight lookup when the editor unmounts.
  useEffect(() => () => lookupRef.current?.abort(), []);

  const chooseSuggestion = (suggestion: string) => {
    suppressLookupRef.current = true;
    setAddress(suggestion);
    setSuggestions([]);
    setSuggestionsOpen(false);
    setHighlightedIndex(-1);
  };

  const save = async () => {
    if (saving) return;
    if (!address.trim()) {
      setSaveError('Enter the address or area you commute to.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.resolve(onSave({ label: label.trim() || 'Work', address: address.trim() }));
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'We could not save this destination — please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3" data-testid="destination-editor">
      <div className="flex gap-1.5 flex-wrap" aria-label="Quick labels">
        {LABEL_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setLabel(suggestion)}
            className={`px-2.5 py-1 rounded-full text-[10px] ${typography.weight.medium} transition-colors ${
              label === suggestion
                ? `${tw.bg.accent} ${typography.color.brand}`
                : `bg-[var(--space-surface-muted)] border border-[var(--space-border-default)] ${typography.color.secondary}`
            }`}
            data-testid={`destination-label-suggestion-${suggestion.toLowerCase()}`}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label — e.g. Work, School, Mum's place"
        maxLength={40}
        className={`${tw.input.base} ${tw.input.default} text-xs rounded-xl py-2 mt-2`}
        data-testid="input-destination-label"
      />
      <div className="flex gap-2 mt-2">
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (suggestionsOpen && suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightedIndex((i) => (i + 1) % suggestions.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                  return;
                }
                if (e.key === 'Escape') {
                  setSuggestionsOpen(false);
                  return;
                }
                if (e.key === 'Enter' && highlightedIndex >= 0) {
                  e.preventDefault();
                  chooseSuggestion(suggestions[highlightedIndex]);
                  return;
                }
              }
              if (e.key === 'Enter') save();
            }}
            onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
            onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
            placeholder="Address or area — type for Lagos suggestions"
            role="combobox"
            aria-expanded={suggestionsOpen}
            aria-autocomplete="list"
            className={`${tw.input.base} ${tw.input.default} text-xs rounded-xl py-2`}
            data-testid="input-destination-address"
          />
          {suggestionsOpen && suggestions.length > 0 && (
            <ul
              className="absolute left-0 right-0 top-full mt-1 z-30 max-h-56 overflow-y-auto rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel-strong)] shadow-lg"
              role="listbox"
              data-testid="destination-address-suggestions"
            >
              {suggestions.map((suggestion, i) => (
                <li key={suggestion} role="option" aria-selected={i === highlightedIndex}>
                  <button
                    type="button"
                    // onMouseDown (not onClick) so the pick lands before the
                    // input's blur closes the dropdown.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      chooseSuggestion(suggestion);
                    }}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-start gap-1.5 transition-colors ${
                      i === highlightedIndex ? 'bg-[var(--space-surface-accent-soft)]' : ''
                    } ${typography.color.secondary}`}
                    data-testid={`destination-address-suggestion-${i}`}
                  >
                    <MapPin className={`w-3 h-3 mt-0.5 shrink-0 ${tw.icon.primary}`} />
                    <span className="min-w-0">{suggestion}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={save}
          disabled={saving || !address.trim()}
          className={`shrink-0 px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 ${tw.button.secondary} disabled:opacity-50`}
          data-testid="button-save-destination"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saveLabel}
        </button>
      </div>
      {saveError && (
        <p className={`mt-1.5 text-[11px] ${typography.color.danger}`} role="alert" data-testid="destination-save-error">
          {saveError}
        </p>
      )}
      {onCancel && (
        <button
          onClick={() => {
            setSaveError(null);
            onCancel();
          }}
          className={`mt-1.5 py-1 text-[11px] underline underline-offset-2 ${typography.color.muted}`}
          data-testid="button-cancel-destination-editor"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

/**
 * Saved-destination controls under the commute card: switch which saved
 * destination the card routes to, change the current one, or add another
 * (up to MAX_COMMUTE_DESTINATIONS).
 */
function DestinationControls({
  destinations,
  activeIndex,
  onSelect,
  onSave,
}: {
  destinations: CommuteDestination[];
  activeIndex: number;
  onSelect?: (index: number) => void | Promise<void>;
  onSave?: (dest: CommuteDestination, index: number | null) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<'change' | 'add' | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const active = destinations[activeIndex] || null;

  const select = async (index: number) => {
    if (!onSelect || index === activeIndex) return;
    setSwitchError(null);
    try {
      await Promise.resolve(onSelect(index));
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : 'Could not switch destination — please try again.'
      );
    }
  };

  return (
    <div className="mt-2.5" data-testid="destination-controls">
      {justSaved && (
        <p className={`text-xs mb-1 ${typography.color.success}`} data-testid="destination-saved-note">
          Destination saved to your account — every report can use it.
        </p>
      )}
      {destinations.length > 1 && (
        <div className="flex gap-1.5 flex-wrap mb-1.5" data-testid="destination-switcher">
          {destinations.map((dest, i) => (
            <button
              key={`${dest.label}-${i}`}
              onClick={() => select(i)}
              className={`px-2.5 py-1 rounded-full text-[10px] ${typography.weight.semibold} transition-colors ${
                i === activeIndex
                  ? `${tw.bg.accent} ${typography.color.brand}`
                  : `bg-[var(--space-surface-muted)] border border-[var(--space-border-default)] ${typography.color.secondary}`
              }`}
              data-testid={`destination-chip-${i}`}
            >
              {dest.label}
            </button>
          ))}
        </div>
      )}
      {switchError && (
        <p className={`text-[11px] mb-1 ${typography.color.danger}`} role="alert" data-testid="destination-switch-error">
          {switchError}
        </p>
      )}
      {onSave && editing === null && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => {
              setJustSaved(false);
              setEditing('change');
            }}
            className={`py-1 text-xs underline underline-offset-2 ${typography.weight.medium} ${typography.color.brand}`}
            data-testid="button-change-destination"
          >
            Change destination
          </button>
          {destinations.length < MAX_COMMUTE_DESTINATIONS && (
            <button
              onClick={() => {
                setJustSaved(false);
                setEditing('add');
              }}
              className={`py-1 text-xs underline underline-offset-2 ${typography.weight.medium} ${typography.color.brand}`}
              data-testid="button-add-destination"
            >
              + Add another
            </button>
          )}
        </div>
      )}
      {onSave && editing !== null && (
        <DestinationEditor
          initial={editing === 'change' ? active : null}
          saveLabel={editing === 'change' ? 'Save' : 'Add'}
          onSave={async (dest) => {
            await Promise.resolve(onSave(dest, editing === 'change' ? activeIndex : null));
            setEditing(null);
            setJustSaved(true);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export default function ReportView({
  listing,
  areaKey,
  address,
  profile,
  reports,
  coverage,
  destinations,
  activeDestinationIndex,
  onSaveDestination,
  onSelectDestination,
  commuteRequestState = 'idle',
  onRetryCommute,
  onSubmitReport,
  communitySecuritySignal,
}: ReportViewProps) {
  // The parent (App.tsx) holds destination state optimistically, so this view
  // just renders whichever destination is active.
  const destinationList = destinations || [];
  const activeIndex = Math.min(
    Math.max(activeDestinationIndex ?? 0, 0),
    Math.max(destinationList.length - 1, 0)
  );
  const activeDestination = destinationList[activeIndex] || null;
  const workplace = activeDestination?.address || null;
  const destinationLabel = activeDestination?.label || null;

  const floodReports = useMemo(
    () => reports.filter((r) => r.report_type === 'flood' && r.area_key === areaKey),
    [reports, areaKey]
  );
  const powerReports = useMemo(
    () => reports.filter((r) => r.report_type === 'power' && r.area_key === areaKey),
    [reports, areaKey]
  );

  const avgPowerHours = useMemo(() => {
    const values = powerReports
      .map((r) => (typeof r.avg_daily_hours === 'string' ? parseFloat(r.avg_daily_hours) : r.avg_daily_hours))
      .filter((v): v is number => v != null && !isNaN(v));
    if (values.length === 0) return null;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }, [powerReports]);

  const zones = asArray<FloodZone>(profile?.flood_zones);
  const sources = asArray<SourceLink>(profile?.sources);

  const flood = useMemo(() => floodPresentation(profile), [profile]);
  const power = useMemo(
    () => powerPresentation(profile, avgPowerHours, powerReports.length),
    [profile, avgPowerHours, powerReports.length]
  );
  const commute = useMemo(() => parseCommute(listing, profile), [listing, profile]);
  const advertisedSecurity = useMemo(() => advertisedSecurityFeatures(listing), [listing]);
  const coverageInfo = useMemo(() => coverage ?? resolveCoverage(areaKey, undefined), [coverage, areaKey]);

  const drivingRoute = commute?.routes.find((r) => r.mode === 'driving') || null;
  const drivingSteps = (drivingRoute?.steps as CommuteStep[] | null) || null;
  const transitRoute = commute?.routes.find((r) => r.mode === 'transit' && typeof r.minutes === 'number') || null;
  const transitMinutes = transitRoute?.minutes ?? null;
  const transitSteps = transitRoute?.steps
    ? (transitRoute.steps as CommuteStep[]).map(localizeTransitStep)
    : null;
  const transitDistanceKm = transitRoute?.distanceKm ?? totalDistanceKm(transitSteps);
  const drivingDistanceKm = drivingRoute?.distanceKm ?? totalDistanceKm(drivingSteps);
  const routeDistanceKm = commute?.distanceKm ?? transitDistanceKm ?? drivingDistanceKm;
  const modeTags = commuteModes(transitSteps, transitMinutes == null);

  return (
    <div className="space-y-3" data-testid="report-unlocked">
      {/* ------------------------- 1 · LOCATION MAP ------------------------- */}
      <LocationMap areaKey={areaKey} address={address} />

      {/* ------------------------- 2 · FLOOD ------------------------- */}
      <DimensionCard
        testId="card-flood"
        icon={Droplets}
        dimension="Flood risk"
        headline={flood.headline}
        tone={flood.tone}
        detail={flood.detail}
        expand={
          <div>
            {profile?.flood_zone_label && (
              <p className={`text-sm ${typography.weight.medium} ${typography.color.primary}`}>
                {profile.flood_zone_label}
              </p>
            )}
            {profile?.flood_summary && (
              <p className={`text-xs mt-1.5 leading-relaxed ${typography.color.secondary}`}>{profile.flood_summary}</p>
            )}
            {zones.length > 0 && (
              <div className="mt-3">
                <p className={`text-xs uppercase tracking-wide mb-2 ${typography.color.muted}`}>
                  Zone map — {areaName(areaKey)}
                </p>
                <FloodZoneMap zones={zones} />
              </div>
            )}
            {profile?.flood_basis && (
              <div className="flex items-start gap-2 mt-3">
                <Info className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tw.icon.muted}`} />
                <p className={`text-[11px] leading-relaxed ${typography.color.muted}`}>{profile.flood_basis}</p>
              </div>
            )}

            {/* Tenant flood history */}
            <div className="mt-3 pt-3 border-t border-[var(--space-border-default)]">
              <div className="flex items-center gap-2 mb-2">
                <Users className={`w-3.5 h-3.5 ${tw.icon.muted}`} />
                <p className={`text-xs uppercase tracking-wide ${typography.color.muted}`}>
                  Tenant flood history · {floodReports.length} report{floodReports.length === 1 ? '' : 's'}
                </p>
              </div>
              {floodReports.length === 0 ? (
                <p className={`text-xs ${typography.color.muted}`}>
                  No tenant reports for this area yet — the zone lookup above stands on its own. If
                  you've lived on one of these streets, your report is what makes this section
                  sharper for the next renter.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {floodReports.map((r) => {
                    const sev = SEVERITY_META[r.severity || ''] || null;
                    return (
                      <li key={r.id} className={`p-3 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs ${typography.weight.semibold} ${typography.color.primary}`}>{r.street || 'Unnamed street'}</span>
                          {sev && <span className={sev.badge}>{sev.label}</span>}
                          {r.verified && (
                            <span className={`inline-flex items-center gap-1 text-[10px] ${typography.color.success}`}>
                              <BadgeCheck className="w-3 h-3" /> verified
                            </span>
                          )}
                        </div>
                        <p className={`text-[11px] mt-0.5 ${typography.color.muted}`}>
                          {sourceLine(r, r.event_period)}
                        </p>
                        {r.description && <p className={`text-xs mt-1.5 leading-relaxed ${typography.color.secondary}`}>{r.description}</p>}
                        <div className="flex items-center gap-3 mt-2">
                          {r.photo_url && (
                            <a href={r.photo_url} target="_blank" rel="noreferrer" className="block">
                              <img src={r.photo_url} alt="Flood evidence" className="h-16 w-24 object-cover rounded-lg border border-[var(--space-border-default)]" />
                            </a>
                          )}
                          {r.evidence_url && (
                            <a
                              href={r.evidence_url}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center gap-1 text-xs underline ${typography.color.secondary}`}
                            >
                              <ExternalLink className="w-3 h-3" /> View evidence
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <SubmitReportPrompt label="Report flooding on your street" onClick={onSubmitReport} />
            </div>
          </div>
        }
      />

      {/* ------------------------- 3 · POWER ------------------------- */}
      <DimensionCard
        testId="card-power"
        icon={Zap}
        dimension="Grid power"
        headline={power.headline}
        tone={power.tone}
        detail={power.detail}
        expand={
          <div>
            <div className="grid grid-cols-2 gap-2">
              <div className={`p-3 rounded-xl text-center ${tw.bg.muted} border border-[var(--space-border-default)]`}>
                <p className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>
                  {profile?.band_hours_min ?? '—'}h+
                </p>
                <p className={`text-[11px] ${typography.color.muted}`}>committed daily supply</p>
              </div>
              <div className={`p-3 rounded-xl text-center ${tw.bg.muted} border border-[var(--space-border-default)]`}>
                <p className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>
                  ₦{profile?.tariff_ngn_kwh != null ? Number(profile.tariff_ngn_kwh).toLocaleString() : '—'}
                </p>
                <p className={`text-[11px] ${typography.color.muted}`}>per kWh (approx. tariff)</p>
              </div>
            </div>
            {profile?.band_note && (
              <div className="flex items-start gap-2 mt-3">
                <Info className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tw.icon.muted}`} />
                <p className={`text-[11px] leading-relaxed ${typography.color.muted}`}>{profile.band_note}</p>
              </div>
            )}
            {profile?.power_summary && (
              <p className={`text-xs mt-2 leading-relaxed ${typography.color.secondary}`}>{profile.power_summary}</p>
            )}

            {/* Crowd power reports */}
            <div className="mt-3 pt-3 border-t border-[var(--space-border-default)]">
              <div className="flex items-center gap-2 mb-2">
                <Users className={`w-3.5 h-3.5 ${tw.icon.muted}`} />
                <p className={`text-xs uppercase tracking-wide ${typography.color.muted}`}>
                  Tenant-reported hours · {powerReports.length} report{powerReports.length === 1 ? '' : 's'}
                </p>
                {avgPowerHours != null && (
                  <span className={`ml-auto ${tw.badge.default} ${tw.badge.primary}`}>avg {avgPowerHours}h/day</span>
                )}
              </div>
              {powerReports.length === 0 ? (
                <p className={`text-xs ${typography.color.muted}`}>
                  No tenant power reports yet — the official band above stands on its own. The band is
                  a regulated commitment; only tenants can say what the meter actually gives.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {powerReports.map((r) => (
                    <li key={r.id} className={`p-3 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs ${typography.weight.semibold} ${typography.color.primary}`}>{r.street || 'Unnamed street'}</span>
                        <span className={`${tw.badge.default} ${tw.badge.primary}`}>
                          {r.avg_daily_hours != null ? `${Number(r.avg_daily_hours)}h/day` : '—'}
                        </span>
                        {r.verified && (
                          <span className={`inline-flex items-center gap-1 text-[10px] ${typography.color.success}`}>
                            <BadgeCheck className="w-3 h-3" /> verified
                          </span>
                        )}
                      </div>
                      <p className={`text-[11px] mt-0.5 ${typography.color.muted}`}>
                        {sourceLine(r, r.period)}
                      </p>
                      {r.outage_pattern && <p className={`text-xs mt-1 ${typography.color.secondary}`}>{r.outage_pattern}</p>}
                      {r.description && <p className={`text-xs mt-1 leading-relaxed ${typography.color.muted}`}>{r.description}</p>}
                      <div className="flex items-center gap-3 mt-2 empty:mt-0">
                        {r.photo_url && (
                          <a href={r.photo_url} target="_blank" rel="noreferrer" className="block">
                            <img src={r.photo_url} alt="Power evidence" className="h-16 w-24 object-cover rounded-lg border border-[var(--space-border-default)]" />
                          </a>
                        )}
                        {r.evidence_url && (
                          <a
                            href={r.evidence_url}
                            target="_blank"
                            rel="noreferrer"
                            className={`inline-flex items-center gap-1 text-xs underline ${typography.color.secondary}`}
                          >
                            <ExternalLink className="w-3 h-3" /> View evidence
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <SubmitReportPrompt label="Report your daily power hours" onClick={onSubmitReport} />
            </div>
          </div>
        }
      />

      {/* ------- 4–6 · COMMUTE, NETWORK & SECURITY (always rendered) ------- */}
      {!workplace ? (
        <DimensionCard
          testId="card-commute"
          icon={Briefcase}
          dimension="Commute Intelligence"
          headline="Where do you commute to? →"
          tone="improving"
          statusLabel="Add destination"
          detail="Save any place you go often — your office, school, market, church or a family house — and this card shows the BRT, bus, Danfo, Keke, ferry or rail route Lagos routing data can find from this property. A short label like “Work” or “School” keeps it clear which trip you're seeing."
        >
          {onSaveDestination && (
            <DestinationEditor onSave={(dest) => Promise.resolve(onSaveDestination(dest, null))} />
          )}
        </DimensionCard>
      ) : commute ? (
        <DimensionCard
          testId="card-commute"
          icon={transitMinutes != null ? Bus : Car}
          dimension={destinationLabel ? `Commute Intelligence · ${destinationLabel}` : 'Commute Intelligence'}
          headline={
            transitMinutes != null
              ? `~${transitMinutes} min by public transport · ${commute.driveMinutes} min drive`
              : `${commute.driveMinutes} min drive${routeDistanceKm != null ? ` · ${routeDistanceKm} km` : ''}`
          }
          headlineClassName={`text-lg ${typography.weight.bold}`}
          tone={commuteTone(commute.driveMinutes)}
          detail={
            transitMinutes == null
              ? 'No public transit route found — driving directions shown instead.'
              : commute.measuredNote ||
                `Route to ${commute.destination || workplace}, departing at 7:30am on a typical Lagos weekday.`
          }
        >
          <div className="mt-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className={`text-[10px] uppercase tracking-wide ${typography.color.muted}`}>Total distance</p>
                <p className={`text-lg ${typography.weight.bold} ${typography.color.primary}`} data-testid="commute-distance">
                  {routeDistanceKm != null ? `${routeDistanceKm} km` : 'Distance unavailable'}
                </p>
              </div>
              <div className="flex gap-1.5 flex-wrap" data-testid="commute-mode-tags">
                {modeTags.map((mode) => (
                  <span
                    key={mode}
                    className={`px-2.5 py-1 rounded-full text-[10px] ${typography.weight.semibold} ${tw.bg.accent} ${typography.color.brand}`}
                  >
                    {MODE_META[mode].emoji} {MODE_META[mode].label}
                  </span>
                ))}
              </div>
            </div>

            {transitMinutes != null ? (
              <RouteSection
                icon={Bus}
                title={`Public transport — ${transitMinutes} min`}
                subtitle={`${commute.trafficLabel || 'typical weekday 7:30am Lagos conditions'}${
                  routeDistanceKm != null ? ` · ${routeDistanceKm} km` : ''
                }`}
                steps={transitSteps}
                testId="route-transit"
                defaultOpen
              />
            ) : null}

            <RouteSection
              icon={Car}
              title={`${transitMinutes != null ? 'Driving comparison' : 'Driving directions'} — ${commute.driveMinutes} min`}
              subtitle={`${commute.trafficLabel || 'typical weekday 7:30am Lagos conditions'}${
                drivingDistanceKm != null ? ` · ${drivingDistanceKm} km` : ''
              }`}
              steps={drivingSteps}
              testId="route-driving"
              defaultOpen={transitMinutes == null}
            />
          </div>
          <DestinationControls
            destinations={destinationList}
            activeIndex={activeIndex}
            onSelect={onSelectDestination}
            onSave={onSaveDestination}
          />
        </DimensionCard>
      ) : (
        <DimensionCard
          testId="card-commute"
          icon={Briefcase}
          dimension={destinationLabel ? `Commute Intelligence · ${destinationLabel}` : 'Commute Intelligence'}
          headline={
            commuteRequestState === 'loading'
              ? `Finding your Lagos route to ${destinationLabel || workplace}…`
              : 'Commute info temporarily unavailable'
          }
          tone="improving"
          statusLabel={commuteRequestState === 'loading' ? 'Checking route' : 'Try again'}
          detail={
            commuteRequestState === 'loading'
              ? 'Checking public transport first, then driving and walking as coverage fallback.'
              : 'We could not load a route right now. Your destination is still saved and no report access was affected.'
          }
        >
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {commuteRequestState === 'loading' ? (
              <span className={`inline-flex items-center gap-1.5 text-xs ${typography.color.muted}`}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking BRT, bus, ferry and road options…
              </span>
            ) : onRetryCommute ? (
              <button
                onClick={onRetryCommute}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs ${tw.button.secondary}`}
                data-testid="button-retry-commute"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry commute
              </button>
            ) : null}
          </div>
          <DestinationControls
            destinations={destinationList}
            activeIndex={activeIndex}
            onSelect={onSelectDestination}
            onSave={onSaveDestination}
          />
        </DimensionCard>
      )}

      {/* ------------------------- 5 · NETWORK ------------------------- */}
      <DimensionCard
        testId="card-network"
        icon={Wifi}
        dimension="Network coverage"
        headline={coverageInfo.headline}
        tone={coverageInfo.tone}
        detail={coverageInfo.detail}
        expand={
          <div>
            <ul className="space-y-3">
              {coverageInfo.carriers.map((c) => (
                <li key={c.carrier.key} data-testid={`network-source-${c.carrier.key}`}>
                  <p className={`text-xs ${typography.weight.semibold} ${typography.color.primary}`}>{c.carrier.label}</p>
                  <p className={`text-[11px] mt-0.5 leading-relaxed ${typography.color.muted}`}>
                    {c.status === 'measured'
                      ? `Source: ${c.sourceLabel || 'OpenCelliD community cell-site data'} — ${c.cellsTotal ?? 0} recorded cell site${c.cellsTotal === 1 ? '' : 's'} within ~1.2 km${coverageDate(c.checkedAt) ? ` · checked ${coverageDate(c.checkedAt)}` : ''}.`
                      : c.status === 'reported'
                        ? c.note || 'Based on published coverage reports — not a live signal test.'
                        : c.note ||
                          'No queryable data for this carrier here yet — the row stays gray rather than showing a made-up score.'}
                  </p>
                  <a
                    href={c.carrier.checkerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-1 mt-1 text-[11px] underline ${typography.color.secondary}`}
                  >
                    <ExternalLink className="w-3 h-3" /> Cross-check on the {c.carrier.checkerLabel}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex items-start gap-2 mt-3 pt-3 border-t border-[var(--space-border-default)]">
              <Info className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tw.icon.muted}`} />
              <p className={`text-[11px] leading-relaxed ${typography.color.muted}`}>
                Each carrier row names its source: “Published coverage reports” tiers come from the
                carriers' published coverage maps, NCC industry data and public crowd-sourced
                coverage reports for {areaName(areaKey)} — never a live signal test — while live
                lookups reflect observed cell-site density in the OpenCelliD community database.
                Neither is the carriers' own coverage claim, and none of it is independently
                verified by Veranda. Always test your own SIM at the address before you sign.
              </p>
            </div>
          </div>
        }
      >
        <div className="mt-3 space-y-1.5" data-testid="network-carriers">
          {coverageInfo.carriers.map((c) => {
            const meta = c.tier
              ? CARRIER_TIER_META[c.tier]
              : CARRIER_TIER_META[c.status === 'unavailable' ? 'unavailable' : 'pending'];
            return (
              <div
                key={c.carrier.key}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}
                data-testid={`network-carrier-${c.carrier.key}`}
              >
                <span className={`flex-1 min-w-0 truncate text-xs ${typography.weight.semibold} ${typography.color.primary}`}>
                  {c.carrier.label}
                </span>
                {c.technologies && (
                  <span className={`shrink-0 text-[10px] ${typography.color.muted}`}>{c.technologies}</span>
                )}
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] ${typography.weight.semibold} ${meta.cls}`}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </DimensionCard>

      {/* ------------------------- 6 · SECURITY ------------------------- */}
      {communitySecuritySignal ? (
        <DimensionCard
          testId="card-security"
          icon={Shield}
          dimension="Security"
          headline={communitySecuritySignal}
          tone="improving"
          statusLabel="Community-sourced"
          detail="Community-sourced signal from residents and tenant reports — not an official crime statistic, and not independently verified by Veranda. Always walk the street yourself, ideally after dark, before you sign."
        />
      ) : (
      <DimensionCard
        testId="card-security"
        icon={Shield}
        dimension="Security"
        headline={
          advertisedSecurity.length > 0
            ? `${advertisedSecurity.length} security ${advertisedSecurity.length === 1 ? 'amenity' : 'amenities'} listed`
            : 'No security amenities listed'
        }
        tone="improving"
        statusLabel={advertisedSecurity.length > 0 ? 'Landlord listed' : 'Data unavailable'}
        detail={
          advertisedSecurity.length > 0
            ? 'Advertised by landlord — not independently verified.'
            : "The listing does not mention gated access, CCTV, a security post or similar amenities. That is missing listing data, not a claim that the area is safe or unsafe."
        }
      >
        {advertisedSecurity.length > 0 ? (
          <div className="mt-3" data-testid="security-advertised">
            <p className={`text-[11px] ${typography.weight.medium} ${typography.color.muted}`}>
              Advertised by landlord — not independently verified.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {advertisedSecurity.map((feature) => (
                <span
                  key={feature}
                  className={`px-2.5 py-1 rounded-full text-[11px] ${tw.bg.muted} border border-[var(--space-border-default)] ${typography.color.secondary}`}
                >
                  {feature}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className={`text-xs mt-3 ${typography.color.muted}`} data-testid="security-empty">
            No security amenities listed
          </p>
        )}
      </DimensionCard>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <div className={`${tw.card.flat} p-3`}>
          <p className={`text-xs uppercase tracking-wide mb-1.5 ${typography.color.muted}`}>Lookup sources</p>
          <ul className="space-y-1">
            {sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 text-xs underline ${typography.color.secondary}`}>
                  <ExternalLink className="w-3 h-3" /> {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Disclaimer — sits below all five dimensions */}
      <p className={`text-[10px] text-center leading-relaxed ${typography.color.muted}`} data-testid="report-disclaimer">
        Qualitative fields on this report are directional, not precise scores — they sharpen as more
        verified lookups and tenant reports land for this street. Gray “Improving”, “Add destination”
        and “Data unavailable” badges are neutral states, never danger signals.
      </p>
    </div>
  );
}
