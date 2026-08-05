/**
 * Veranda — report Q&A chat.
 *
 * A small chat box under an unlocked verification report. Answers are
 * grounded ONLY in this listing's data (listing fields, the area verification
 * profile and tenant reports) via a strict system prompt — the assistant is
 * told to say "not measured yet" instead of inventing numbers.
 */
import { useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircleQuestion, Send, Sparkles } from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import {
  AreaKey,
  AreaProfile,
  Listing,
  TenantReport,
  areaName,
  asArray,
  naira,
} from './types';
import { CoverageResolution } from './coverage';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_QUESTIONS = [
  'How bad does this area flood in July?',
  'Will I need a generator or inverter here?',
  'What should I check before paying for this place?',
];

function buildSystemPrompt(
  listing: Listing | null | undefined,
  areaKey: AreaKey,
  address: string,
  profile: AreaProfile | undefined,
  reports: TenantReport[],
  coverage?: CoverageResolution | null
): string {
  const areaReports = reports.filter((r) => r.area_key === areaKey);
  const listingFacts = listing
    ? {
        title: listing.title,
        address: listing.address,
        neighborhood: listing.neighborhood,
        annual_rent: listing.rent_year_ngn ? naira(listing.rent_year_ngn) : 'not stated',
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        property_type: listing.property_type,
        furnished: listing.furnished,
        advertised_features: asArray<string>(listing.features),
        lister_description: (listing.description || '').slice(0, 1500),
        source_portal: listing.source_portal,
        measured_commute: listing.commute || null,
      }
    : null;
  const profileFacts = profile
    ? {
        area: profile.area_name,
        flood_zone_class: profile.flood_zone_class,
        flood_zone_label: profile.flood_zone_label,
        flood_summary: profile.flood_summary,
        flood_basis: profile.flood_basis,
        flood_sub_zones: asArray(profile.flood_zones),
        electricity_company: profile.disco_name,
        service_band: profile.disco_band,
        committed_min_hours_per_day: profile.band_hours_min,
        tariff_ngn_per_kwh: profile.tariff_ngn_kwh,
        band_note: profile.band_note,
        power_summary: profile.power_summary,
      }
    : null;
  const coverageFacts = coverage
    ? coverage.carriers.map((c) => ({
        carrier: c.carrier.label,
        tier: c.tier || 'no data',
        source:
          c.status === 'measured'
            ? 'live OpenCelliD cell-site lookup'
            : c.status === 'reported'
              ? 'published coverage reports (baseline, not a live signal test)'
              : 'no data',
        technologies_observed: c.technologies,
        recorded_cell_sites_within_1_2km: c.cellsTotal,
        note: c.note,
      }))
    : null;
  const tenantFacts = areaReports.slice(0, 12).map((r) => ({
    type: r.report_type,
    street: r.street,
    period: r.event_period || r.period,
    severity: r.severity,
    avg_daily_power_hours: r.avg_daily_hours,
    outage_pattern: r.outage_pattern,
    description: (r.description || '').slice(0, 400),
    verified: r.verified === true,
  }));

  return [
    'You are the Veranda report assistant. Veranda helps Lagos renters verify a home before they sign a lease.',
    `You are answering follow-up questions about ONE specific listing report: ${address} in ${areaName(areaKey)}.`,
    '',
    'STRICT GROUNDING RULES:',
    '- Answer ONLY from the data below. Never invent flood events, power hours, commute times, safety claims, prices or dates that are not in the data.',
    '- If something is not covered by the data, say plainly that it has not been measured yet for this street and that the report improves as more verified lookups and tenant reports land.',
    '- Flood and power lookups are AREA-level classifications — remind the renter that street-level conditions vary and to verify the exact street/feeder.',
    '- Security is never scored. Security features listed by the landlord are advertised, not independently verified — always say so if asked about safety. If none are listed, say "No security amenities listed"; do not leave the answer blank or imply the area is safe.',
    '- Network coverage tiers come from the source named on each carrier entry: either a live cell-site lookup in the OpenCelliD community database (measured equipment on the ground) or a baseline from published coverage reports (carrier coverage maps, NCC industry data and crowd-sourced reports — NOT a live signal test). Never present a published-reports baseline as a live or real-time measurement. None of it is the carriers\' own claim or independently verified by Veranda. A carrier marked "no data" simply has no data — that is never proof of bad coverage. Advise renters to test their own SIM at the address.',
    '- Never present an estimate as a measurement. Qualitative fields are directional, not precise scores.',
    '- Keep answers short (2–5 sentences), warm and practical. Use ₦ for money. No markdown headers.',
    '',
    `LISTING DATA: ${JSON.stringify(listingFacts)}`,
    `AREA VERIFICATION LOOKUPS (official sources: LASEMA/NiMet flood advisories, NERC bands, DisCo tariffs): ${JSON.stringify(profileFacts)}`,
    `TENANT REPORTS for ${areaName(areaKey)} (${areaReports.length} total): ${JSON.stringify(tenantFacts)}`,
    `NETWORK COVERAGE per carrier near the centre of ${areaName(areaKey)} (source named on each entry — live OpenCelliD lookups and/or published coverage reports): ${JSON.stringify(coverageFacts)}`,
  ].join('\n');
}

export default function ReportChat({
  listing,
  areaKey,
  address,
  profile,
  reports,
  coverage,
}: {
  listing?: Listing | null;
  areaKey: AreaKey;
  address: string;
  profile: AreaProfile | undefined;
  reports: TenantReport[];
  /** Resolved network coverage — passed for listing reports so answers match the card. */
  coverage?: CoverageResolution | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const systemPrompt = useMemo(
    () => buildSystemPrompt(listing, areaKey, address, profile, reports, coverage),
    [listing, areaKey, address, profile, reports, coverage]
  );

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput('');
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const res = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...nextMessages.slice(-8),
          ],
          max_tokens: 500,
          temperature: 0.4,
        }),
      });
      const data = await res.json();
      const answer = data?.choices?.[0]?.message?.content;
      if (!answer) throw new Error('No answer returned');
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch {
      setError('Could not reach the assistant — please try again.');
      setMessages((prev) => prev.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 60);
    }
  };

  return (
    <div className={`${tw.card.default} rounded-2xl overflow-hidden`} data-testid="report-chat">
      <div className={`px-4 py-3 border-b border-[var(--space-border-default)] ${tw.bg.accent} flex items-center gap-2`}>
        <MessageCircleQuestion className={`w-4 h-4 ${tw.icon.primary}`} />
        <div>
          <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>Ask about this report</p>
          <p className={`text-[11px] ${typography.color.muted}`}>
            Answers grounded only in this report's data — no guesses.
          </p>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                disabled={busy}
                className={`px-2.5 py-1.5 rounded-full text-[11px] border border-[var(--space-border-default)] bg-[var(--space-surface-card)] ${typography.color.secondary} hover:bg-[var(--space-surface-card-hover)] transition-colors disabled:opacity-50`}
                data-testid="chat-suggestion"
              >
                <Sparkles className="w-3 h-3 inline mr-1 -mt-0.5" />
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="px-4 py-3 max-h-72 overflow-y-auto space-y-2.5">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? `${tw.message.user} rounded-br-md`
                    : `${tw.message.assistant} border border-[var(--space-border-default)] rounded-bl-md`
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className={`px-3 py-2 rounded-2xl rounded-bl-md text-xs ${tw.message.assistant} border border-[var(--space-border-default)]`}>
                <Loader2 className={`w-3.5 h-3.5 animate-spin ${tw.icon.muted}`} />
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className={`px-4 pb-1 text-[11px] ${typography.color.danger}`}>{error}</p>}

      <div className="p-3 border-t border-[var(--space-border-default)] flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask(input)}
          placeholder='e.g. "How bad does this flood in July?"'
          className={`${tw.input.base} ${tw.input.default} text-xs rounded-xl py-2.5`}
          data-testid="input-report-chat"
        />
        <button
          onClick={() => ask(input)}
          disabled={busy || !input.trim()}
          className={`shrink-0 w-10 rounded-xl flex items-center justify-center ${tw.button.primary} disabled:opacity-50`}
          aria-label="Send question"
          data-testid="button-report-chat-send"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
