/**
 * Veranda — listing detail page.
 *
 * Photo carousel + listing info and the verification-report panel, side by
 * side on desktop and stacked on mobile. Browsing the listing is always free;
 * the report panel handles its own gating (ReportGate) and, once unlocked,
 * renders the full report plus the grounded Q&A chat.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bath,
  BedDouble,
  ExternalLink,
  MapPin,
  ShieldCheck,
  Sofa,
  Camera,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import {
  AreaKey,
  AreaProfile,
  Listing,
  TenantReport,
  asArray,
  naira,
} from './types';
import { ListingPhotoCarousel, cleanScrapedText, locationLabel, rentValue } from './listingDisplay';
import {
  AreaCommuteRow,
  CommutePayload,
  CommuteRouteRow,
  requestListingMeasurement,
  resolveCommute,
} from './commute';
import { AreaCoverageRow, requestCoverageCheck, resolveCoverage } from './coverage';
import ReportGate from './ReportGate';
import ReportView from './ReportView';
import ReportChat from './ReportChat';

const PORTAL_LABELS: Record<string, string> = {
  propertypro: 'propertypro.ng',
  nigeriapropertycentre: 'nigeriapropertycentre.com',
  jiji: 'jiji.ng',
  seed: 'sample listing',
  manual: 'curated',
};

interface ListingDetailProps {
  listing: Listing;
  profile: AreaProfile | undefined;
  reports: TenantReport[];
  accountEmail: string | null;
  unlocked: boolean;
  freeUsed: number;
  subscribed: boolean;
  accountLoading: boolean;
  accountError?: string | null;
  onRetryAccount?: () => void;
  workDestination?: string | null;
  onBack: () => void;
  onSignedIn: (email: string) => void;
  onUnlock: (listing: Listing) => Promise<void>;
  onSaveWorkDestination?: (destination: string) => void;
  /** Opens the tenant submit-a-report flow for this home's area. */
  onSubmitReport?: (areaKey: AreaKey) => void;
}

export default function ListingDetail({
  listing,
  profile,
  reports,
  accountEmail,
  unlocked,
  freeUsed,
  subscribed,
  accountLoading,
  accountError,
  onRetryAccount,
  workDestination,
  onBack,
  onSignedIn,
  onUnlock,
  onSaveWorkDestination,
  onSubmitReport,
}: ListingDetailProps) {
  const [descExpanded, setDescExpanded] = useState(false);

  const areaKey = (listing.area_key || 'surulere') as AreaKey;
  const address = listing.address || listing.title || 'Unknown address';

  // ---------------- commute (“Distance to work”) data ----------------
  // Exact measured routes for this listing, and the area→hub baselines the
  // scheduled pipeline maintains. resolveCommute() picks the best real
  // measurement (or none — the card then keeps its honest gray state).
  const listingRoutesHook = window.useWorkspaceDB<CommuteRouteRow>('commute_routes', {
    shared: true,
    limit: 20,
    filters: [{ column: 'listing_id', operator: 'eq', value: listing.id }],
  });
  const areaRoutesHook = window.useWorkspaceDB<AreaCommuteRow>('area_commutes', {
    shared: true,
    limit: 10,
    filters: [{ column: 'area_key', operator: 'eq', value: areaKey }],
  });
  const commuteResolution = useMemo(
    () => resolveCommute(listing, workDestination, listingRoutesHook.data, areaRoutesHook.data),
    [listing, workDestination, listingRoutesHook.data, areaRoutesHook.data]
  );

  // Request the exact route immediately when no measured cache exists. The
  // request state is passed into the card so provider/config failures become
  // a clear retry state instead of a permanently gray, broken card.
  const [liveCommute, setLiveCommute] = useState<CommutePayload | null>(null);
  const [commuteRequestState, setCommuteRequestState] = useState<'idle' | 'loading' | 'error'>('idle');
  const requestKeyRef = useRef('');

  const loadCommute = async (force = false) => {
    if (!workDestination) return;
    const key = `${listing.id}::${workDestination.trim().toLowerCase()}`;
    if (!force && requestKeyRef.current === key) return;
    requestKeyRef.current = key;
    setCommuteRequestState('loading');
    const result = await requestListingMeasurement(listing.id, workDestination, force);
    if (result.commute) {
      setLiveCommute(result.commute);
      setCommuteRequestState('idle');
    } else if (result.ok && result.result === 'cached') {
      listingRoutesHook.refresh();
      setCommuteRequestState('idle');
    } else {
      setCommuteRequestState('error');
    }
    listingRoutesHook.refresh();
  };

  useEffect(() => {
    setLiveCommute(null);
    setCommuteRequestState('idle');
    requestKeyRef.current = '';
  }, [listing.id, workDestination]);

  useEffect(() => {
    if (!unlocked || !workDestination || listingRoutesHook.loading || areaRoutesHook.loading) return;
    const destinationKey = workDestination.trim().replace(/\s+/g, ' ').toLowerCase();
    const hasFreshExact = (listingRoutesHook.data || []).some(
      (row) =>
        row.status === 'measured' &&
        row.drive_minutes != null &&
        (row.destination || '').trim().replace(/\s+/g, ' ').toLowerCase() === destinationKey
    );
    if (hasFreshExact) return;
    // Request the exact property route even when an area→hub baseline is
    // already visible; the baseline is a fallback, never the final answer.
    void loadCommute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, listing.id, workDestination, listingRoutesHook.loading, areaRoutesHook.loading]);

  // ---------------- network coverage data ----------------
  // Per-carrier (MTN / Airtel / Glo / 9mobile) lookups the scheduled pipeline
  // maintains in `area_coverage`. resolveCoverage() maps them to the report
  // card, falling back per carrier to the labelled published-coverage-reports
  // baseline until a live lookup lands (see coverage.ts).
  const coverageHook = window.useWorkspaceDB<AreaCoverageRow>('area_coverage', {
    shared: true,
    limit: 10,
    filters: [{ column: 'area_key', operator: 'eq', value: areaKey }],
  });
  const coverage = useMemo(
    () => resolveCoverage(areaKey, coverageHook.data),
    [areaKey, coverageHook.data]
  );

  // When coverage rows for this area are still pending, ask the pipeline
  // (once per session per area) to look them up now, then refresh so fresh
  // data appears without a reload. The hook dedupes and rate-caps, and simply
  // leaves rows pending while the OpenCelliD key is missing — the card keeps
  // its labelled published-reports baseline meanwhile, never a fabricated
  // measurement.
  const coverageRequestedRef = useRef(false);
  useEffect(() => {
    if (!unlocked || coverageRequestedRef.current) return;
    if (coverageHook.loading || !coverage.shouldRequestCheck) return;
    coverageRequestedRef.current = true;
    requestCoverageCheck(areaKey);
    const timer = setTimeout(() => coverageHook.refresh(), 15000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, areaKey, coverage.shouldRequestCheck, coverageHook.loading]);

  const reportListing = useMemo<Listing>(() => {
    const payload = liveCommute || commuteResolution.payload;
    return payload ? { ...listing, commute: payload } : listing;
  }, [listing, liveCommute, commuteResolution.payload]);
  const rent = rentValue(listing);
  const title = cleanScrapedText(listing.title) || 'Lagos home';
  const description = cleanScrapedText(listing.description);
  const features = asArray<string>(listing.features);
  const portal = PORTAL_LABELS[(listing.source_portal || '').toLowerCase()] || listing.source_portal;

  return (
    <div className="pb-6">
      <button
        onClick={onBack}
        className={`flex items-center gap-1.5 text-sm ${typography.color.secondary} hover:opacity-80 mb-3`}
        data-testid="button-detail-back"
      >
        <ArrowLeft className="w-4 h-4" /> Back to listings
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* ---------------- Left: the listing ---------------- */}
        <div>
          <div className="rounded-2xl overflow-hidden border border-[var(--space-border-default)]">
            <ListingPhotoCarousel listing={listing} alt={title} heightClass="h-56 sm:h-64" />
          </div>

          <div className="mt-3.5">
            {rent > 0 ? (
              <p className={`text-2xl leading-tight ${typography.weight.bold} ${typography.color.brand}`} data-testid="detail-price">
                {naira(rent)}
                <span className={`text-xs ml-1 ${typography.weight.medium} ${typography.color.muted}`}>/year</span>
              </p>
            ) : (
              <p className={`text-lg ${typography.weight.semibold} ${typography.color.muted}`}>Price on request</p>
            )}
            <p className={`flex items-center gap-1 mt-1.5 text-sm ${typography.weight.medium} ${typography.color.primary}`}>
              <MapPin className={`w-4 h-4 shrink-0 ${tw.icon.primary}`} aria-hidden="true" />
              {locationLabel(listing)}
            </p>
            <h2 className={`text-base mt-1 leading-snug ${typography.weight.semibold} ${typography.color.primary}`}>
              {title}
            </h2>

            {/* Facts */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {listing.bedrooms != null && (
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] ${typography.weight.medium} bg-[var(--space-surface-muted)] border border-[var(--space-border-default)] ${typography.color.secondary}`}>
                  <BedDouble className="w-3.5 h-3.5" /> {listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bed`}
                </span>
              )}
              {listing.bathrooms != null && (
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] ${typography.weight.medium} bg-[var(--space-surface-muted)] border border-[var(--space-border-default)] ${typography.color.secondary}`}>
                  <Bath className="w-3.5 h-3.5" /> {listing.bathrooms} bath
                </span>
              )}
              {listing.property_type && (
                <span className={`px-2 py-1 rounded-lg text-[11px] ${typography.weight.medium} bg-[var(--space-surface-muted)] border border-[var(--space-border-default)] ${typography.color.secondary}`}>
                  {listing.property_type}
                </span>
              )}
              {listing.furnished ? (
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] ${typography.weight.medium} bg-[var(--space-surface-muted)] border border-[var(--space-border-default)] ${typography.color.secondary}`}>
                  <Sofa className="w-3.5 h-3.5" /> Furnished
                </span>
              ) : null}
            </div>

            {features.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2.5">
                {features.slice(0, 8).map((f) => (
                  <span key={f} className={`${tw.badge.default} ${tw.badge.primary}`}>
                    {f}
                  </span>
                ))}
              </div>
            )}

            {description && (
              <div className="mt-3">
                <p
                  className={`text-xs leading-relaxed ${typography.color.secondary}`}
                  style={
                    descExpanded
                      ? undefined
                      : {
                          display: '-webkit-box',
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }
                  }
                >
                  {description}
                </p>
                {description.length > 220 && (
                  <button
                    onClick={() => setDescExpanded((v) => !v)}
                    className={`mt-1 py-1 pr-3 text-xs ${typography.weight.medium} ${typography.color.brand} underline underline-offset-2`}
                  >
                    {descExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

            {listing.source_url && (
              <a
                href={listing.source_url}
                target="_blank"
                rel="noreferrer"
                className={`mt-3.5 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs ${tw.button.secondary}`}
                data-testid="link-original-listing"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View original listing{portal ? ` on ${portal}` : ''}
              </a>
            )}

            <p className={`text-[10px] mt-3 ${typography.color.muted}`}>
              <Camera className="w-3 h-3 inline mr-1 -mt-0.5" />
              Listing aggregated from public sources{portal ? ` (${portal})` : ''}. Photos are the
              lister's — illustrative, not verified.
            </p>
          </div>
        </div>

        {/* ---------------- Right: the verification report ---------------- */}
        <div>
          <div className={`flex items-center gap-2 mb-3 p-2.5 rounded-xl ${tw.bg.accent} border border-[var(--space-border-default)]`}>
            <ShieldCheck className={`w-4 h-4 shrink-0 ${tw.icon.primary}`} />
            <p className={`text-xs ${typography.color.secondary}`}>
              Veranda Verification Report — flood, power, distance to work, network & security{' '}
              {unlocked ? 'unlocked for this home.' : 'ready for this home.'}
            </p>
          </div>

          {unlocked ? (
            <div className="space-y-3">
              <ReportView
                listing={reportListing}
                areaKey={areaKey}
                address={address}
                profile={profile}
                reports={reports}
                coverage={coverage}
                workDestination={workDestination}
                onSaveWorkDestination={onSaveWorkDestination}
                commuteRequestState={commuteRequestState}
                onRetryCommute={workDestination ? () => void loadCommute(true) : undefined}
                onSubmitReport={onSubmitReport ? () => onSubmitReport(areaKey) : undefined}
              />
              <ReportChat
                listing={listing}
                areaKey={areaKey}
                address={address}
                profile={profile}
                reports={reports}
                coverage={coverage}
              />
            </div>
          ) : (
            <ReportGate
              listing={listing}
              areaKey={areaKey}
              address={address}
              profile={profile}
              reports={reports}
              accountEmail={accountEmail}
              freeUsed={freeUsed}
              subscribed={subscribed}
              accountLoading={accountLoading}
              accountError={accountError}
              onRetryAccount={onRetryAccount}
              onSignedIn={onSignedIn}
              onUnlock={() => onUnlock(listing)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
