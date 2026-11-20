/**
 * Veranda — "My list": the homes a renter saved, compared side by side on the
 * area-level checks (flood, power, network) plus rent. Opening a home goes to
 * its full report. This is the "every home on your list" promise of the Pass.
 */
import { Heart, Trash2, ArrowRight } from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import { AreaProfile, Listing, areaName, naira } from './types';
import { resolveCoverage } from './coverage';
import { floodPresentation, powerPresentation, Pill } from './ReportView';
import { cleanScrapedText, rentValue } from './listingDisplay';
import { removeFromShortlist, useShortlist, MAX_SHORTLIST } from './shortlist';

export default function ShortlistView({
  profileFor,
  onOpen,
  onBrowse,
}: {
  profileFor: (key: string | null | undefined) => AreaProfile | undefined;
  onOpen: (listing: Listing) => void;
  onBrowse: () => void;
}) {
  const list = useShortlist();

  if (list.length === 0) {
    return (
      <div className="pb-6 max-w-md mx-auto text-center" data-testid="shortlist-empty">
        <div className={`w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center ${tw.bg.accent}`}>
          <Heart className={`w-5 h-5 ${tw.icon.primary}`} aria-hidden="true" />
        </div>
        <p className={`text-base ${typography.weight.semibold} ${typography.color.primary}`}>Your list is empty</p>
        <p className={`text-xs mt-1.5 ${typography.color.muted}`}>
          Tap “Save to my list” on any home. Then compare flood, power, network and rent side by side, and only
          visit the ones worth visiting.
        </p>
        <button
          onClick={onBrowse}
          className={`mt-4 px-5 py-3 rounded-xl text-sm inline-flex items-center gap-2 ${tw.button.primary}`}
          data-testid="button-shortlist-browse"
        >
          Browse homes <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="pb-6" data-testid="shortlist-view">
      <h2 className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>My list</h2>
      <p className={`text-xs mt-0.5 mb-3 ${typography.color.muted}`}>
        {list.length} of {MAX_SHORTLIST} homes · area-level checks. Tap a home for its full report.
      </p>
      <div className="space-y-3">
        {list.map((l) => {
          const profile = profileFor(l.area_key);
          const flood = floodPresentation(profile);
          const power = powerPresentation(profile, null, 0);
          const network = l.area_key ? resolveCoverage(l.area_key, undefined) : null;
          const rent = rentValue(l);
          const title = cleanScrapedText(l.title) || l.address || 'Saved home';
          return (
            <div key={l.id} className={`${tw.card.default} rounded-2xl p-4`} data-testid={`shortlist-item-${l.id}`}>
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => onOpen(l)} className="text-left min-w-0" data-testid={`shortlist-open-${l.id}`}>
                  <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary} truncate`}>{title}</p>
                  <p className={`text-xs ${typography.color.muted}`}>
                    {areaName(l.area_key)}
                    {rent > 0 ? ` · ${naira(rent)}/yr` : ''}
                  </p>
                </button>
                <button
                  onClick={() => removeFromShortlist(l.id)}
                  className={`p-1.5 rounded-lg ${tw.button.ghost}`}
                  aria-label={`Remove ${title} from my list`}
                  data-testid={`shortlist-remove-${l.id}`}
                >
                  <Trash2 className={`w-4 h-4 ${tw.icon.muted}`} aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { label: 'Flood', value: flood.headline, tone: flood.tone },
                  { label: 'Power', value: power.headline, tone: power.tone },
                  network
                    ? { label: 'Network', value: network.headline, tone: network.tone }
                    : { label: 'Network', value: 'Not measured yet', tone: 'improving' as const },
                ].map((c) => (
                  <div key={c.label} className={`rounded-xl px-3 py-2 ${tw.bg.accent}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] uppercase tracking-wide ${typography.color.muted}`}>{c.label}</span>
                      <Pill tone={c.tone} />
                    </div>
                    <p className={`text-xs mt-1 ${typography.color.primary}`}>{c.value}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={() => onOpen(l)}
                className={`mt-3 text-xs inline-flex items-center gap-1 ${typography.color.brand}`}
                data-testid={`shortlist-report-${l.id}`}
              >
                Full report and commute <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
