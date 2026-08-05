import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ShieldAlert,
  MapPin,
  Plus,
  Trash2,
  Droplets,
  Zap,
  Shield,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Radar,
  Loader2,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';

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
  }
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type ScanStatus = 'pending' | 'scanning' | 'complete' | 'error';

interface RiskCategory {
  level: RiskLevel;
  headline: string;
  detail: string;
}

interface RiskReport {
  overall: RiskLevel;
  overallScore: number;
  teaser: string;
  categories: {
    flood: RiskCategory;
    power: RiskCategory;
    security: RiskCategory;
    fraud: RiskCategory;
  };
  recommendation: string;
}

interface PropertyRisk {
  id: number;
  address: string;
  status: ScanStatus;
  overall_level?: string;
  overall_score?: number;
  teaser?: string;
  flood_level?: string;
  power_level?: string;
  security_level?: string;
  fraud_level?: string;
  report_json?: string;
  error_message?: string;
  created_at?: string;
}

const RISK_META: Record<
  RiskLevel,
  { label: string; badge: string; dot: string; bar: string }
> = {
  low: {
    label: 'Low',
    badge: `${tw.badge.default} ${tw.badge.success}`,
    dot: 'bg-[var(--space-semantic-success)]',
    bar: 'bg-[var(--space-semantic-success)]',
  },
  medium: {
    label: 'Medium',
    badge: `${tw.badge.default} ${tw.badge.warning}`,
    dot: 'bg-[var(--space-semantic-warning)]',
    bar: 'bg-[var(--space-semantic-warning)]',
  },
  high: {
    label: 'High',
    badge: `${tw.badge.default} ${tw.badge.danger}`,
    dot: 'bg-[var(--space-semantic-danger)]',
    bar: 'bg-[var(--space-semantic-danger)]',
  },
  critical: {
    label: 'Critical',
    badge: `${tw.badge.default} ${tw.badge.danger}`,
    dot: 'bg-[var(--space-semantic-danger)]',
    bar: 'bg-[var(--space-semantic-danger)]',
  },
};

const CATEGORY_CONFIG = [
  { key: 'flood' as const, label: 'Flood', icon: Droplets },
  { key: 'power' as const, label: 'Power', icon: Zap },
  { key: 'security' as const, label: 'Security', icon: Shield },
  { key: 'fraud' as const, label: 'Fraud', icon: AlertTriangle },
];

function parseRiskLevel(value?: string | null): RiskLevel {
  if (value === 'medium' || value === 'high' || value === 'critical') return value;
  return 'low';
}

function levelToScore(level: RiskLevel): number {
  return { low: 15, medium: 45, high: 75, critical: 95 }[level];
}

async function searchPropertyIntel(address: string) {
  const queries = [
    `${address} Nigeria flooding risk`,
    `${address} Lagos power supply outage`,
    `${address} security crime Nigeria`,
    `${address} rental scam fraud landlord Nigeria`,
  ];

  const batches = await Promise.all(
    queries.map(async (query) => {
      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            searchType: 'web',
            num: 4,
            location: 'Nigeria',
            language: 'en',
          }),
        });
        const data = await response.json();
        return data.success ? data.results : [];
      } catch {
        return [];
      }
    })
  );

  const seen = new Set<string>();
  return batches.flat().filter((r: { link?: string }) => {
    if (!r.link || seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });
}

async function generateRiskReport(address: string, searchResults: Array<{ title?: string; snippet?: string; link?: string }>): Promise<RiskReport> {
  const context =
    searchResults.length > 0
      ? searchResults
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title || 'Untitled'}\n${r.snippet || ''}\n${r.link || ''}`
          )
          .join('\n\n')
      : 'No web results found. Apply general knowledge of Nigerian rental markets and clearly flag uncertainty.';

  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Veranda's property risk analyst for Nigeria. Analyze addresses for hidden environmental and fraud risks before leasing. Be grounded, reassuring, and clear. Return ONLY valid JSON (no markdown) with:
{
  "overall": "low"|"medium"|"high"|"critical",
  "overallScore": number 0-100,
  "teaser": "One compelling sentence hinting at the biggest concern — enough to decide whether to pay for full verification",
  "categories": {
    "flood": { "level": "low"|"medium"|"high", "headline": "short title", "detail": "2 sentences max" },
    "power": { "level": "...", "headline": "...", "detail": "..." },
    "security": { "level": "...", "headline": "...", "detail": "..." },
    "fraud": { "level": "...", "headline": "...", "detail": "..." }
  },
  "recommendation": "Clear advice: proceed, investigate further, or avoid"
}`,
        },
        {
          role: 'user',
          content: `Property address: ${address}\n\nWeb research:\n${context}`,
        },
      ],
      max_tokens: 1200,
      temperature: 0.35,
    }),
  });

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('No analysis returned');

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(cleaned) as RiskReport;
  return parsed;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const meta = RISK_META[level];
  return (
    <span className={meta.badge}>
      {meta.label} risk
    </span>
  );
}

function CategoryPill({
  label,
  level,
  icon: Icon,
}: {
  label: string;
  level: RiskLevel;
  icon: typeof Droplets;
}) {
  const meta = RISK_META[level];
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
      <Icon className={`w-3.5 h-3.5 shrink-0 ${tw.icon.muted}`} />
      <span className={`text-xs ${typography.weight.medium} ${typography.color.secondary}`}>{label}</span>
      <span className={`text-xs ml-auto ${typography.color.primary}`}>{meta.label}</span>
    </div>
  );
}

function RadarVisual({ report }: { report: RiskReport }) {
  const segments = CATEGORY_CONFIG.map(({ key }) => parseRiskLevel(report.categories[key].level));
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {[0, 1, 2, 3].map((i) => {
          const angle = (i * 90 - 90) * (Math.PI / 180);
          const x = 50 + Math.cos(angle) * 38;
          const y = 50 + Math.sin(angle) * 38;
          const level = segments[i];
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={level === 'low' ? 6 : level === 'medium' ? 7 : 8}
              className={RISK_META[level].bar}
              opacity={level === 'low' ? 0.55 : level === 'medium' ? 0.75 : 1}
            />
          );
        })}
        <circle cx="50" cy="50" r="14" fill="var(--space-surface-card)" stroke="var(--space-border-strong)" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="6" className="fill-[var(--space-brand-primary)]" opacity="0.85" />
      </svg>
    </div>
  );
}

export default function RiskRadar() {
  const { data: properties, loading, error, refresh } = window.useWorkspaceDB<PropertyRisk>(
    'property_risks',
    { orderBy: { column: 'created_at', direction: 'desc' }, limit: 50 }
  );

  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const scanningRef = useRef<Set<number>>(new Set());

  const stats = useMemo(() => {
    const rows = properties || [];
    const complete = rows.filter((r) => r.status === 'complete');
    const highRisk = complete.filter((r) => {
      const level = parseRiskLevel(r.overall_level);
      return level === 'high' || level === 'critical';
    });
    return {
      total: rows.length,
      scanned: complete.length,
      highRisk: highRisk.length,
    };
  }, [properties]);

  const runScan = async (row: PropertyRisk) => {
    if (scanningRef.current.has(row.id)) return;
    scanningRef.current.add(row.id);

    try {
      await window.__workspaceDb.from('property_risks').update(row.id, { status: 'scanning' });
      refresh();

      const searchResults = await searchPropertyIntel(row.address);
      const report = await generateRiskReport(row.address, searchResults);

      await window.__workspaceDb.from('property_risks').update(row.id, {
        status: 'complete',
        overall_level: report.overall,
        overall_score: report.overallScore,
        teaser: report.teaser,
        flood_level: report.categories.flood.level,
        power_level: report.categories.power.level,
        security_level: report.categories.security.level,
        fraud_level: report.categories.fraud.level,
        report_json: JSON.stringify(report),
        error_message: null,
      });
      refresh();
    } catch (err) {
      await window.__workspaceDb.from('property_risks').update(row.id, {
        status: 'error',
        error_message: err instanceof Error ? err.message : 'Scan failed',
      });
      refresh();
    } finally {
      scanningRef.current.delete(row.id);
    }
  };

  useEffect(() => {
    (properties || []).forEach((row) => {
      if ((row.status === 'pending' || row.status === 'scanning') && !scanningRef.current.has(row.id)) {
        runScan(row);
      }
    });
  }, [properties]);

  const handleAdd = async () => {
    const trimmed = address.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await window.__workspaceDb.from('property_risks').insert({
        address: trimmed,
        status: 'pending',
      });
      setAddress('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    await window.__workspaceDb.from('property_risks').delete(id);
    if (expandedId === id) setExpandedId(null);
    refresh();
  };

  const handleRescan = async (row: PropertyRisk) => {
    await window.__workspaceDb.from('property_risks').update(row.id, {
      status: 'pending',
      error_message: null,
    });
    refresh();
  };

  return (
    <div className="min-h-full flex flex-col w-full bg-transparent">
      {/* Atmospheric header strip */}
      <div className={`relative overflow-hidden px-5 pt-5 pb-4 ${tw.bg.muted} border-b border-[var(--space-border-default)]`}>
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 20% 0%, var(--space-brand-primary-100), transparent), radial-gradient(ellipse 60% 50% at 90% 100%, var(--space-brand-highlight-100), transparent)',
          }}
        />
        <div className="relative flex items-start gap-3">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tw.bg.accent} border border-[var(--space-border-default)]`}>
            <ShieldAlert className={`w-5 h-5 ${tw.icon.primary}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs uppercase tracking-widest ${typography.weight.semibold} ${typography.color.muted}`}>
              Veranda · Risk Radar
            </p>
            <p className={`text-sm mt-0.5 ${typography.color.secondary}`}>
              Truth before you move in — scan addresses for flood, power, security & fraud risks.
            </p>
          </div>
        </div>
      </div>

      {/* Address composer */}
      <div className="px-5 py-4 border-b border-[var(--space-border-default)]">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <MapPin className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${tw.icon.muted}`} />
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Enter property address (e.g. Lekki Phase 1, Lagos)"
              className={`${tw.input.base} ${tw.input.default} pl-10 text-sm rounded-xl`}
              data-testid="input-address"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={busy || !address.trim()}
            className={`px-4 py-2.5 rounded-xl text-sm shrink-0 flex items-center gap-1.5 ${tw.button.primary} disabled:opacity-40 disabled:cursor-not-allowed`}
            data-testid="button-scan-address"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Scan
          </button>
        </div>
      </div>

      {/* Stats */}
      {!loading && (properties?.length ?? 0) > 0 && (
        <div className="px-5 py-3 grid grid-cols-3 gap-2 border-b border-[var(--space-border-default)]">
          {[
            { label: 'Tracked', value: stats.total, icon: Radar },
            { label: 'Verified', value: stats.scanned, icon: CheckCircle2 },
            { label: 'High risk', value: stats.highRisk, icon: ShieldAlert },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className={`${tw.card.default} rounded-xl p-3 text-center`}>
              <Icon className={`w-4 h-4 mx-auto mb-1 ${tw.icon.primary}`} />
              <p className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>{value}</p>
              <p className={`text-[11px] ${typography.color.muted}`}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-[var(--space-border-default)] border-t-[var(--space-brand-primary)]" />
            <p className={`text-sm ${typography.color.muted}`}>Loading your watchlist…</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className={`text-sm ${typography.color.danger}`}>Couldn't load properties: {error.message}</p>
            <button
              onClick={refresh}
              className={`mt-3 px-3 py-1.5 text-sm rounded-lg border border-[var(--space-border-default)] ${typography.color.primary} hover:bg-[var(--space-surface-muted)]`}
            >
              Try again
            </button>
          </div>
        ) : !properties || properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center max-w-xs mx-auto">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${tw.bg.muted} border border-[var(--space-border-default)]`}>
              <ShieldAlert className={`w-6 h-6 ${tw.icon.primary}`} />
            </div>
            <p className={`text-sm ${typography.weight.medium} ${typography.color.primary}`}>No addresses yet</p>
            <p className={`text-xs ${typography.color.muted}`}>
              Add a property you're considering. We'll cross-check flood maps, grid reliability, security reports, and fraud signals — free teaser included.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {properties.map((row) => {
              const isExpanded = expandedId === row.id;
              const overall = parseRiskLevel(row.overall_level);
              const report: RiskReport | null = row.report_json
                ? (() => {
                    try {
                      return JSON.parse(row.report_json);
                    } catch {
                      return null;
                    }
                  })()
                : null;
              const isScanning = row.status === 'pending' || row.status === 'scanning';

              return (
                <li
                  key={row.id}
                  className={`${tw.card.default} rounded-2xl overflow-hidden transition-all duration-200 hover:border-[var(--space-brand-primary-500)]/40`}
                  data-testid={`row-property-${row.id}`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      {report && row.status === 'complete' ? (
                        <RadarVisual report={report} />
                      ) : (
                        <div className={`w-28 h-28 rounded-2xl flex items-center justify-center shrink-0 ${tw.bg.muted} border border-[var(--space-border-default)]`}>
                          {isScanning ? (
                            <Loader2 className={`w-7 h-7 animate-spin ${tw.icon.primary}`} />
                          ) : row.status === 'error' ? (
                            <AlertTriangle className={`w-7 h-7 ${tw.icon.danger}`} />
                          ) : (
                            <MapPin className={`w-7 h-7 ${tw.icon.muted}`} />
                          )}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary} truncate`}>
                              {row.address}
                            </p>
                            {row.status === 'complete' && (
                              <div className="mt-1.5">
                                <RiskBadge level={overall} />
                              </div>
                            )}
                            {isScanning && (
                              <p className={`text-xs mt-1.5 ${typography.color.muted}`}>
                                Scanning web intel & generating risk report…
                              </p>
                            )}
                            {row.status === 'error' && (
                              <p className={`text-xs mt-1.5 ${typography.color.danger}`}>
                                {row.error_message || 'Scan failed'}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {row.status === 'error' && (
                              <button
                                onClick={() => handleRescan(row)}
                                className={`p-1.5 rounded-lg hover:bg-[var(--space-surface-muted)] ${tw.icon.muted}`}
                                title="Retry scan"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(row.id)}
                              className="p-1.5 rounded-lg text-[var(--space-text-muted)] hover:text-[var(--space-semantic-danger)] hover:bg-[var(--space-semantic-danger)]/10 transition-colors"
                              aria-label="Remove address"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {row.teaser && row.status === 'complete' && (
                          <p className={`text-xs mt-3 leading-relaxed ${typography.color.secondary} border-l-2 border-[var(--space-brand-highlight)] pl-3`}>
                            {row.teaser}
                          </p>
                        )}

                        {row.status === 'complete' && (
                          <div className="grid grid-cols-2 gap-1.5 mt-3">
                            {CATEGORY_CONFIG.map(({ key, label, icon }) => (
                              <CategoryPill
                                key={key}
                                label={label}
                                level={parseRiskLevel(row[`${key}_level` as keyof PropertyRisk] as string)}
                                icon={icon}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {report && row.status === 'complete' && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : row.id)}
                        className={`mt-4 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs ${typography.weight.medium} ${tw.button.secondary}`}
                      >
                        {isExpanded ? (
                          <>
                            Hide full report <ChevronUp className="w-3.5 h-3.5" />
                          </>
                        ) : (
                          <>
                            View full risk breakdown <ChevronDown className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {isExpanded && report && (
                    <div className={`px-4 pb-4 pt-0 border-t border-[var(--space-border-default)] ${tw.bg.muted}`}>
                      <div className="pt-4 space-y-3">
                        {CATEGORY_CONFIG.map(({ key, label, icon: Icon }) => {
                          const cat = report.categories[key];
                          const level = parseRiskLevel(cat.level);
                          return (
                            <div
                              key={key}
                              className={`p-3 rounded-xl ${tw.bg.card} border border-[var(--space-border-default)]`}
                            >
                              <div className="flex items-center gap-2 mb-1.5">
                                <Icon className={`w-4 h-4 ${tw.icon.primary}`} />
                                <span className={`text-sm ${typography.weight.medium} ${typography.color.primary}`}>
                                  {label}
                                </span>
                                <span className="ml-auto">
                                  <RiskBadge level={level} />
                                </span>
                              </div>
                              <p className={`text-sm ${typography.weight.medium} ${typography.color.primary}`}>
                                {cat.headline}
                              </p>
                              <p className={`text-xs mt-1 ${typography.color.secondary}`}>{cat.detail}</p>
                              <div className="mt-2 h-1.5 rounded-full bg-[var(--space-surface-muted)] overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${RISK_META[level].bar}`}
                                  style={{ width: `${levelToScore(level)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                        <div className={`p-3 rounded-xl border border-[var(--space-border-strong)] ${tw.bg.card}`}>
                          <p className={`text-xs uppercase tracking-wide ${typography.color.muted} mb-1`}>
                            Veranda recommendation
                          </p>
                          <p className={`text-sm ${typography.color.primary}`}>{report.recommendation}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
