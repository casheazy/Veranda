/**
 * Veranda — address / area verification report.
 *
 * A renter types the address (or area) they are about to pay rent on and gets
 * the same five-dimension report as a listing: flood, power, network,
 * security and distance to work. Address-only reports use the typed address
 * plus area-level lookup rows; where listing-specific or measured data is not
 * available, the card remains visible with an honest neutral fallback.
 *
 * Searching is free. The report itself runs through the same unlock gate as a
 * listing report (5 free unlocks per account, then the subscription), so an
 * address report and a listing report cost a renter exactly the same thing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Droplets, MapPin, PlusCircle, ShieldCheck, Users, Zap } from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import { AreaKey, AreaProfile, Listing, TenantReport, areaName } from './types';
import { AreaCommuteRow, CommutePayload, requestAddressMeasurement, resolveCommute } from './commute';
import type { CommuteDestination } from './account';
import { AreaCoverageRow, requestCoverageCheck, resolveCoverage } from './coverage';
import ReportGate from './ReportGate';
import ReportView from './ReportView';
import ReportChat from './ReportChat';

interface AreaReportProps {
  areaKey: AreaKey;
  /** What the renter actually typed — shown verbatim so they recognise it. */
  address: string;
  profile: AreaProfile | undefined;
  reports: TenantReport[];
  accountEmail: string | null;
  unlocked: boolean;
  freeUsed: number;
  subscribed: boolean;
  accountLoading: boolean;
  accountError?: string | null;
  onRetryAccount?: () => void;
  /** ADDRESS of the active saved destination — drives the route machinery. */
  workDestination?: string | null;
  /** All saved destinations + which one is active (card label and switcher). */
  destinations?: CommuteDestination[];
  activeDestinationIndex?: number;
  onSaveDestination?: (dest: CommuteDestination, index: number | null) => void | Promise<void>;
  onSelectDestination?: (index: number) => void | Promise<void>;
  onBack: () => void;
  onSignedIn: (email: string) => void;
  onUnlock: () => Promise<void>;
  onSubmitReport: () => void;
}

export default function AreaReport({
  areaKey,
  address,
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
  destinations,
  activeDestinationIndex,
  onSaveDestination,
  onSelectDestination,
  onBack,
  onSignedIn,
  onUnlock,
  onSubmitReport,
}: AreaReportProps) {
  const areaReports = reports.filter((r) => r.area_key === areaKey);
  const floodCount = areaReports.filter((r) => r.report_type === 'flood').length;
  const powerCount = areaReports.filter((r) => r.report_type === 'power').length;

  // Address verification has no catalog listing row, so build the minimum
  // listing-shaped payload ReportView needs. Security then renders its neutral
  // "No security amenities listed" state instead of disappearing.
  const addressListing = useMemo<Listing>(
    () => ({ id: -1, area_key: areaKey, address, title: address, features: [] }),
    [areaKey, address]
  );

  // Area-level Google Routes baselines can still personalize an address-only
  // report when the saved workplace matches a measured hub. Otherwise the
  // distance card stays visible and prompts for a workplace / measurement.
  const areaRoutesHook = window.useWorkspaceDB<AreaCommuteRow>('area_commutes', {
    shared: true,
    limit: 10,
    filters: [{ column: 'area_key', operator: 'eq', value: areaKey }],
  });
  const commuteResolution = useMemo(
    () => resolveCommute(addressListing, workDestination, [], areaRoutesHook.data),
    [addressListing, workDestination, areaRoutesHook.data]
  );
  const [liveCommute, setLiveCommute] = useState<CommutePayload | null>(null);
  const [commuteRequestState, setCommuteRequestState] = useState<'idle' | 'loading' | 'error'>('idle');
  const commuteRequestKeyRef = useRef('');

  const loadAddressCommute = async (force = false) => {
    if (!workDestination) return;
    const key = `${address.trim().toLowerCase()}::${workDestination.trim().toLowerCase()}`;
    if (!force && commuteRequestKeyRef.current === key) return;
    commuteRequestKeyRef.current = key;
    setCommuteRequestState('loading');
    const result = await requestAddressMeasurement(address, workDestination, force);
    if (result.commute) {
      setLiveCommute(result.commute);
      setCommuteRequestState('idle');
    } else {
      setCommuteRequestState('error');
    }
  };

  useEffect(() => {
    setLiveCommute(null);
    setCommuteRequestState('idle');
    commuteRequestKeyRef.current = '';
  }, [address, workDestination]);

  useEffect(() => {
    if (!unlocked || !workDestination || areaRoutesHook.loading) return;
    // Even when a measured area baseline is available, request the exact typed
    // property address; the baseline remains a useful instant fallback.
    void loadAddressCommute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, address, workDestination, areaRoutesHook.loading]);

  const reportListing = useMemo<Listing>(() => {
    const payload = liveCommute || commuteResolution.payload;
    return payload ? { ...addressListing, commute: payload } : addressListing;
  }, [addressListing, liveCommute, commuteResolution.payload]);

  // Use the same per-carrier ISP/mobile coverage lookup as listing reports.
  // Published-report baselines render immediately; a live lookup is requested
  // once after unlock when any underlying carrier row is still pending.
  const coverageHook = window.useWorkspaceDB<AreaCoverageRow>('area_coverage', {
    shared: true,
    limit: 10,
    filters: [{ column: 'area_key', operator: 'eq', value: areaKey }],
  });
  const coverage = useMemo(
    () => resolveCoverage(areaKey, coverageHook.data),
    [areaKey, coverageHook.data]
  );
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

  return (
    <div className="pb-6 max-w-2xl mx-auto" data-testid="area-report">
      <button
        onClick={onBack}
        className={`flex items-center gap-1.5 text-sm ${typography.color.secondary} hover:opacity-80 mb-3`}
        data-testid="button-area-report-back"
      >
        <ArrowLeft className="w-4 h-4" /> New search
      </button>

      {/* What was looked up */}
      <div className={`${tw.card.default} rounded-2xl p-4`}>
        <p className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide ${typography.color.muted}`}>
          <ShieldCheck className="w-3.5 h-3.5" /> Veranda Verification Report
        </p>
        <h2
          className={`text-lg leading-snug mt-1 ${typography.weight.semibold} ${typography.color.primary}`}
          data-testid="area-report-address"
        >
          {address}
        </h2>
        <p className={`flex items-center gap-1.5 text-xs mt-1 ${typography.color.secondary}`}>
          <MapPin className={`w-3.5 h-3.5 shrink-0 ${tw.icon.primary}`} />
          Matched to {areaName(areaKey)}
          {profile?.city ? ` · ${profile.city}` : ''}
        </p>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className={`p-2.5 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}>
            <p className={`flex items-center gap-1.5 text-[11px] ${typography.weight.semibold} ${typography.color.primary}`}>
              <Droplets className={`w-3.5 h-3.5 ${tw.icon.primary}`} /> Flood
            </p>
            <p className={`text-[11px] mt-1 leading-relaxed ${typography.color.muted}`}>
              Zone classification, zone map and {floodCount} tenant flood{' '}
              {floodCount === 1 ? 'report' : 'reports'}
            </p>
          </div>
          <div className={`p-2.5 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}>
            <p className={`flex items-center gap-1.5 text-[11px] ${typography.weight.semibold} ${typography.color.primary}`}>
              <Zap className={`w-3.5 h-3.5 ${tw.icon.primary}`} /> Power
            </p>
            <p className={`text-[11px] mt-1 leading-relaxed ${typography.color.muted}`}>
              DisCo and official band, plus {powerCount} tenant power{' '}
              {powerCount === 1 ? 'report' : 'reports'}
            </p>
          </div>
        </div>

        <p className={`text-[10px] mt-2.5 ${typography.color.muted}`}>
          Flood and power are area-level lookups, and network coverage is resolved per carrier for
          the matched area. Security and commute remain neutral until listing amenities or a real
          measured route are available — no card is hidden and no missing data is treated as safe.
        </p>
      </div>

      <div className="mt-3">
        {unlocked ? (
          <div className="space-y-3">
            <ReportView
              listing={reportListing}
              areaKey={areaKey}
              address={address}
              profile={profile}
              reports={reports}
              coverage={coverage}
              destinations={destinations}
              activeDestinationIndex={activeDestinationIndex}
              onSaveDestination={onSaveDestination}
              onSelectDestination={onSelectDestination}
              commuteRequestState={commuteRequestState}
              onRetryCommute={workDestination ? () => void loadAddressCommute(true) : undefined}
              onSubmitReport={onSubmitReport}
            />
            <ReportChat
              listing={reportListing}
              areaKey={areaKey}
              address={address}
              profile={profile}
              reports={reports}
              coverage={coverage}
            />
          </div>
        ) : (
          <ReportGate
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
            onUnlock={onUnlock}
          />
        )}
      </div>

      {/* Grow the crowd — always visible, locked or not */}
      <div className={`${tw.card.flat} p-4 mt-3`}>
        <p className={`flex items-center gap-2 text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
          <Users className={`w-4 h-4 ${tw.icon.primary}`} /> Have you lived in {areaName(areaKey)}?
        </p>
        <p className={`text-xs mt-1.5 leading-relaxed ${typography.color.muted}`}>
          The official lookups are the same for everyone. What only you can add is what actually
          happened on your street — how high the water came in July, how many hours the power really
          gives. Photos and links to posts are welcome.
        </p>
        <button
          onClick={onSubmitReport}
          className={`mt-3 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs ${tw.button.secondary}`}
          data-testid="button-area-submit-report"
        >
          <PlusCircle className="w-3.5 h-3.5" /> Submit a report for this area
        </button>
      </div>
    </div>
  );
}
