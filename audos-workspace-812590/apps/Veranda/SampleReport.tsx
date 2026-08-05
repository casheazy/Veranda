/**
 * Veranda — public sample verification report (trust-building conversion tool).
 *
 * Prospective renters see a fully rendered, REAL five-dimension report for one
 * recognizable Lagos address BEFORE they sign up or pay — removing the
 * blind-buy barrier. Reached from the landing page ("See a sample report"),
 * with no account, no email and no unlock gate.
 *
 * The report body is the SAME ReportView component every paid report renders,
 * fed by the same live Surulere rows (area_profiles, tenant_reports,
 * area_coverage + the published-coverage baseline), so the sample can never
 * drift from what a real report looks like. Deliberate differences from a
 * paid report:
 *   - a clearly labelled "Sample report" header above the cards;
 *   - read-only: no workplace editor, no submit-report prompts, no report
 *     chat, and it NEVER fires a live coverage lookup (this is a public,
 *     pre-payment page — it must not burn the founder's OpenCelliD quota);
 *   - the security card carries the community-sourced qualitative signal for
 *     the sample street (communitySecuritySignal — see ReportView.tsx);
 *   - a conversion CTA under the cards routes back to the normal
 *     search → unlock flow for the renter's own address.
 */
import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, Eye, MapPin, ShieldCheck } from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import {
  AreaKey,
  AreaProfile,
  FREE_UNLOCK_LIMIT,
  Listing,
  SUBSCRIPTION_PRICE_NGN,
  TenantReport,
  UNLOCK_PRICE_NGN,
  areaName,
} from './types';
import { AreaCoverageRow, resolveCoverage } from './coverage';
import ReportView from './ReportView';

/**
 * The one address the sample report is rendered for. Surulere is the
 * best-documented area in the live dataset (real EKEDC Band B lookup, five
 * named flood sub-zones, tenant flood + power reports, a published network
 * baseline), and Bode Thomas is one of its most recognizable streets — it is
 * even the example in the home-screen search placeholder.
 */
export const SAMPLE_AREA_KEY: AreaKey = 'surulere';
export const SAMPLE_ADDRESS = '15 Bode Thomas Street, Surulere';

/**
 * Qualitative, community-sourced security signal for the sample street.
 * Rendered by ReportView with a "Community-sourced" label and the neutral
 * gray tone — security is never scored, on the sample or anywhere else.
 */
const SAMPLE_SECURITY_SIGNAL = 'Moderate — mixed residential, active neighbourhood watch';

interface SampleReportProps {
  /** The live Surulere area profile row (same hook data the paid reports read). */
  profile: AreaProfile | undefined;
  /** All tenant reports — ReportView filters to the sample area itself. */
  reports: TenantReport[];
  onBack: () => void;
  /** Routes to the normal verify-an-address flow (the real unlock path). */
  onGetYours: () => void;
}

export default function SampleReport({ profile, reports, onBack, onGetYours }: SampleReportProps) {
  // No catalog listing behind an address report — the minimum listing-shaped
  // payload keeps every card rendering exactly as it does on a paid address
  // report (same shape AreaReport.tsx builds).
  const sampleListing = useMemo<Listing>(
    () => ({ id: -1, area_key: SAMPLE_AREA_KEY, address: SAMPLE_ADDRESS, title: SAMPLE_ADDRESS, features: [] }),
    []
  );

  // Same per-carrier coverage resolution as a paid report: landed OpenCelliD
  // rows win, the published-reports baseline fills the rest. Unlike the paid
  // report, this page never requests a fresh lookup — it is public.
  const coverageHook = window.useWorkspaceDB<AreaCoverageRow>('area_coverage', {
    shared: true,
    limit: 10,
    filters: [{ column: 'area_key', operator: 'eq', value: SAMPLE_AREA_KEY }],
  });
  const coverage = useMemo(
    () => resolveCoverage(SAMPLE_AREA_KEY, coverageHook.data),
    [coverageHook.data]
  );

  return (
    <div className="pb-6 max-w-2xl mx-auto" data-testid="sample-report">
      <button
        onClick={onBack}
        className={`flex items-center gap-1.5 text-sm ${typography.color.secondary} hover:opacity-80 mb-3`}
        data-testid="button-sample-back"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Sample banner — states plainly what this page is */}
      <div
        className="rounded-2xl p-4 border border-[var(--space-brand-highlight-200)] bg-[var(--space-surface-accent-soft)]"
        data-testid="sample-report-banner"
      >
        <p className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide ${typography.weight.semibold} ${typography.color.brand}`}>
          <Eye className="w-3.5 h-3.5" /> Sample report
        </p>
        <h2
          className={`text-lg leading-snug mt-1 ${typography.weight.semibold} ${typography.color.primary}`}
          data-testid="sample-report-address"
        >
          {SAMPLE_ADDRESS}
        </h2>
        <p className={`flex items-center gap-1.5 text-xs mt-1 ${typography.color.secondary}`}>
          <MapPin className={`w-3.5 h-3.5 shrink-0 ${tw.icon.primary}`} />
          Matched to {areaName(SAMPLE_AREA_KEY)}
          {profile?.city ? ` · ${profile.city}` : ''}
        </p>
        <p className={`text-xs mt-2.5 leading-relaxed ${typography.color.secondary}`}>
          This is a real report for a Lagos property — the same live official lookups and tenant
          reports every paid report runs on. Your report will look exactly like this.
        </p>
      </div>

      {/* The report itself — the exact component paid reports render */}
      <div className="mt-3">
        <ReportView
          listing={sampleListing}
          areaKey={SAMPLE_AREA_KEY}
          address={SAMPLE_ADDRESS}
          profile={profile}
          reports={reports}
          coverage={coverage}
          workDestination={null}
          communitySecuritySignal={SAMPLE_SECURITY_SIGNAL}
        />
      </div>

      {/* Conversion CTA — routes to the normal search → unlock flow */}
      <div className={`${tw.card.default} rounded-2xl p-5 mt-4 text-center`} data-testid="sample-report-cta">
        <p className={`text-base ${typography.weight.bold} ${typography.color.primary}`}>
          Get this report for your property — ₦{UNLOCK_PRICE_NGN.toLocaleString()}
        </p>
        <p className={`text-xs mt-1.5 leading-relaxed ${typography.color.muted}`}>
          Launch offer: your first {FREE_UNLOCK_LIMIT} reports are free with just your email — then
          ₦{SUBSCRIPTION_PRICE_NGN.toLocaleString()}/month for unlimited reports. Cancel anytime.
        </p>
        <button
          onClick={onGetYours}
          className={`mt-3.5 w-full py-3.5 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.primary}`}
          data-testid="button-sample-unlock"
        >
          Unlock Your Report <ArrowRight className="w-4 h-4" />
        </button>
        <p className={`flex items-center justify-center gap-1 text-[10px] mt-2.5 ${typography.color.muted}`}>
          <ShieldCheck className="w-3 h-3" /> Searching any address is free — no card needed to start.
        </p>
      </div>

      <p className={`text-[10px] mt-3 text-center leading-relaxed ${typography.color.muted}`}>
        Sample data is the live Veranda dataset for {areaName(SAMPLE_AREA_KEY)} — the same LASEMA/NiMet
        flood lookups, NERC/EKEDC band data, published network-coverage baseline and tenant reports a
        paid report runs. The sample is read-only.
      </p>
    </div>
  );
}
