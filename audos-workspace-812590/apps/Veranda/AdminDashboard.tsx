/**
 * Veranda — internal admin dashboard (founder/team only).
 *
 * Password-gated (ADMIN_PASSWORD below — change it any time); opens without a
 * password when the space is viewed in entrepreneur mode (App Studio).
 * Shows: listings count, renter accounts, free vs subscription unlock
 * breakdown, active subscribers + MRR, recent unlock activity, and a
 * tenant-report moderation panel for curating the crowd layer
 * (verify / edit / delete rows in the tenant_reports table).
 */
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Building2,
  Camera,
  Check,
  ClipboardList,
  CreditCard,
  Droplets,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  ShieldCheck,
  Ticket,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import {
  AccountUnlock,
  RenterAccount,
  SUBSCRIPTION_PRICE_NGN,
  TenantReport,
  areaName,
  mrrChargeHint,
} from './types';
import { WORKSPACE_ID } from './account';

/** Shared with the founder — rotate whenever someone leaves the team. */
const ADMIN_PASSWORD = 'veranda-team-2026';
const ADMIN_SESSION_KEY = 'veranda_admin_ok_v1';

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className={`${tw.card.default} rounded-2xl p-4`}>
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tw.bg.accent}`}>
          <Icon className={`w-4 h-4 ${tw.icon.primary}`} />
        </span>
        <p className={`text-[11px] uppercase tracking-wide ${typography.color.muted}`}>{label}</p>
      </div>
      <p className={`text-2xl mt-2 ${typography.weight.bold} ${typography.color.primary}`}>
        {loading ? <Loader2 className={`w-5 h-5 animate-spin ${tw.icon.muted}`} /> : value}
      </p>
      {hint && <p className={`text-[10px] mt-0.5 ${typography.color.muted}`}>{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tenant-report moderation — curate the crowd layer. Seed rows (source_type
// 'seed') render publicly as “Seed example — pending verification”; once the
// founder confirms one they can promote it to 'founder' (“Veranda-verified”).
// ---------------------------------------------------------------------------

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'tenant', label: 'Tenant report' },
  { value: 'founder', label: 'Veranda-verified (founder)' },
  { value: 'social', label: 'Social evidence' },
  { value: 'seed', label: 'Seed example' },
];

const SOURCE_BADGE_LABELS: Record<string, string> = {
  tenant: 'Tenant',
  founder: 'Veranda-verified',
  social: 'Social',
  seed: 'Seed',
};

const SEVERITY_LABELS: Record<string, string> = {
  none: 'No flooding',
  ankle: 'Ankle-deep',
  knee: 'Knee-deep',
  waist: 'Waist-deep',
  severe: 'Severe',
};

function sourceBadgeClass(source?: string | null): string {
  if (source === 'founder') return tw.badge.primary;
  if (source === 'seed') return tw.badge.warning;
  if (source === 'social') return tw.badge.accent;
  return tw.badge.neutral;
}

interface ReportDraft {
  street: string;
  reporter_name: string;
  description: string;
  event_period: string;
  severity: string;
  avg_daily_hours: string;
  outage_pattern: string;
  period: string;
  source_type: string;
}

const adminInputCls =
  'w-full px-3 py-2 text-xs rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] text-[var(--space-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--space-brand-primary)]';
const adminLabelCls = `block text-[10px] mb-1 ${typography.weight.medium} ${typography.color.secondary}`;

function filterChipCls(active: boolean): string {
  return `px-2.5 py-1 rounded-full text-[11px] border transition-all ${
    active
      ? `${tw.button.primary} border-transparent`
      : `bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary}`
  }`;
}

function TenantReportsPanel() {
  const [typeFilter, setTypeFilter] = useState<'all' | 'flood' | 'power'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'tenant' | 'founder' | 'social' | 'seed'>('all');
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Type + source are filtered server-side so seed rows are always findable
  // even past the fetch limit; verified/unverified is split client-side
  // (seed + tenant rows may carry false OR null).
  const serverFilters: Array<{ column: string; operator: string; value: any }> = [];
  if (typeFilter !== 'all') serverFilters.push({ column: 'report_type', operator: 'eq', value: typeFilter });
  if (sourceFilter !== 'all') serverFilters.push({ column: 'source_type', operator: 'eq', value: sourceFilter });

  const reportsHook = window.useWorkspaceDB<TenantReport>('tenant_reports', {
    shared: true,
    limit: 100,
    orderBy: { column: 'created_at', direction: 'desc' },
    filters: serverFilters,
  });
  const seedCountHook = window.useWorkspaceDB<TenantReport>('tenant_reports', {
    shared: true,
    limit: 1,
    filters: [{ column: 'source_type', operator: 'eq', value: 'seed' }],
  });
  const seedCount = seedCountHook.total || 0;

  const rows = (reportsHook.data || []).filter((r) =>
    verifiedFilter === 'all' ? true : verifiedFilter === 'verified' ? !!r.verified : !r.verified
  );

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const startEdit = (r: TenantReport) => {
    setActionError(null);
    setEditingId(r.id);
    setDraft({
      street: r.street || '',
      reporter_name: r.reporter_name || '',
      description: r.description || '',
      event_period: r.event_period || '',
      severity: r.severity || 'knee',
      avg_daily_hours: r.avg_daily_hours != null ? String(r.avg_daily_hours) : '',
      outage_pattern: r.outage_pattern || '',
      period: r.period || '',
      source_type: r.source_type || 'tenant',
    });
  };

  const runAction = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      reportsHook.refresh();
      seedCountHook.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed — please retry.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleVerified = (r: TenantReport) =>
    runAction(r.id, () => window.__workspaceDb.from('tenant_reports').update(r.id, { verified: !r.verified }));

  const saveEdit = (r: TenantReport) => {
    if (!draft) return;
    const payload: Record<string, any> = {
      street: draft.street.trim() || null,
      reporter_name: draft.reporter_name.trim() || null,
      description: draft.description.trim() || null,
      source_type: draft.source_type,
    };
    if (r.report_type === 'flood') {
      payload.event_period = draft.event_period.trim() || null;
      payload.severity = draft.severity || null;
    } else {
      const hours = parseFloat(draft.avg_daily_hours);
      payload.avg_daily_hours = isNaN(hours) ? null : Math.min(24, Math.max(0, hours));
      payload.outage_pattern = draft.outage_pattern.trim() || null;
      payload.period = draft.period.trim() || null;
    }
    return runAction(r.id, async () => {
      await window.__workspaceDb.from('tenant_reports').update(r.id, payload);
      cancelEdit();
    });
  };

  const deleteRow = (r: TenantReport) => {
    const where = r.street || areaName(r.area_key);
    if (!window.confirm(`Delete this ${r.report_type} report for ${where}? This cannot be undone.`)) return;
    if (editingId === r.id) cancelEdit();
    runAction(r.id, () => window.__workspaceDb.from('tenant_reports').delete(r.id));
  };

  return (
    <div className={`${tw.card.default} rounded-2xl p-4 mt-3`} data-testid="admin-tenant-reports">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <ClipboardList className={`w-4 h-4 ${tw.icon.primary}`} />
          <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
            Tenant reports · {reportsHook.loading ? '…' : reportsHook.total ?? 0}
          </p>
        </div>
        {seedCount > 0 && (
          <button
            onClick={() => {
              setTypeFilter('all');
              setSourceFilter('seed');
              setVerifiedFilter('all');
            }}
            className={`${tw.badge.default} ${tw.badge.warning} hover:brightness-95`}
            data-testid="button-show-seed-rows"
          >
            {seedCount} seed example{seedCount === 1 ? '' : 's'} left — review
          </button>
        )}
      </div>
      <p className={`text-[11px] mb-3 ${typography.color.muted}`}>
        Curate the crowd layer: verify real submissions, tidy up wording, promote confirmed seed examples to
        Veranda-verified, or delete junk. Changes show on renter reports immediately.
      </p>

      {/* Filters */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wide w-12 shrink-0 ${typography.color.muted}`}>Type</span>
          {(['all', 'flood', 'power'] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)} className={filterChipCls(typeFilter === t)} data-testid={`filter-report-type-${t}`}>
              {t === 'all' ? 'All' : t === 'flood' ? 'Flood' : 'Power'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wide w-12 shrink-0 ${typography.color.muted}`}>Source</span>
          {(['all', 'tenant', 'founder', 'social', 'seed'] as const).map((s) => (
            <button key={s} onClick={() => setSourceFilter(s)} className={filterChipCls(sourceFilter === s)} data-testid={`filter-report-source-${s}`}>
              {s === 'all' ? 'All' : SOURCE_BADGE_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wide w-12 shrink-0 ${typography.color.muted}`}>Status</span>
          {(['all', 'verified', 'unverified'] as const).map((v) => (
            <button key={v} onClick={() => setVerifiedFilter(v)} className={filterChipCls(verifiedFilter === v)} data-testid={`filter-report-verified-${v}`}>
              {v === 'all' ? 'All' : v === 'verified' ? 'Verified' : 'Unverified'}
            </button>
          ))}
        </div>
      </div>

      {actionError && <p className={`text-xs mb-2 ${typography.color.danger}`}>{actionError}</p>}

      {reportsHook.loading ? (
        <Loader2 className={`w-4 h-4 animate-spin ${tw.icon.muted}`} />
      ) : rows.length === 0 ? (
        <p className={`text-xs ${typography.color.muted}`}>No reports match these filters.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const isEditing = editingId === r.id && draft != null;
            const busy = busyId === r.id;
            const hours = r.avg_daily_hours != null ? parseFloat(String(r.avg_daily_hours)) : null;
            const detail =
              r.report_type === 'flood'
                ? [SEVERITY_LABELS[r.severity || ''] || r.severity || 'Severity —', r.event_period].filter(Boolean).join(' · ')
                : [hours != null && !isNaN(hours) ? `${hours}h power/day` : 'Hours —', r.outage_pattern, r.period]
                    .filter(Boolean)
                    .join(' · ');
            return (
              <li
                key={r.id}
                className={`p-3 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}
                data-testid={`admin-report-${r.id}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${tw.bg.accent}`}>
                    {r.report_type === 'flood' ? (
                      <Droplets className={`w-3.5 h-3.5 ${tw.icon.primary}`} />
                    ) : (
                      <Zap className={`w-3.5 h-3.5 ${tw.icon.primary}`} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs truncate ${typography.weight.semibold} ${typography.color.primary}`}>
                      {r.street || 'Unknown street'}{' '}
                      <span className={`${typography.weight.normal} ${typography.color.muted}`}>· {areaName(r.area_key)}</span>
                    </p>
                    <p className={`text-[10px] mt-0.5 ${typography.color.muted}`}>{detail}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`${tw.badge.default} ${sourceBadgeClass(r.source_type)}`}>
                      {SOURCE_BADGE_LABELS[r.source_type || 'tenant'] || r.source_type}
                    </span>
                    <span className={`${tw.badge.default} ${r.verified ? tw.badge.success : tw.badge.neutral}`}>
                      {r.verified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                </div>

                {r.description && <p className={`text-[11px] mt-1.5 ${typography.color.secondary}`}>{r.description}</p>}
                <p className={`text-[10px] mt-1 ${typography.color.muted}`}>
                  {[r.reporter_name, r.created_at ? new Date(r.created_at).toLocaleString() : null].filter(Boolean).join(' · ') ||
                    'No reporter name'}
                </p>
                {(r.photo_url || r.evidence_url) && (
                  <div className="flex items-center gap-3 mt-1">
                    {r.photo_url && (
                      <a
                        href={r.photo_url}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1 text-[10px] underline ${typography.color.brand}`}
                      >
                        <Camera className="w-3 h-3" /> Photo
                      </a>
                    )}
                    {r.evidence_url && (
                      <a
                        href={r.evidence_url}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1 text-[10px] underline ${typography.color.brand}`}
                      >
                        <ExternalLink className="w-3 h-3" /> Evidence link
                      </a>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button
                    onClick={() => toggleVerified(r)}
                    disabled={busy}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1 ${
                      r.verified ? tw.button.secondary : tw.button.primary
                    } disabled:opacity-50`}
                    data-testid={`button-report-verify-${r.id}`}
                  >
                    <ShieldCheck className="w-3 h-3" /> {r.verified ? 'Unverify' : 'Mark verified'}
                  </button>
                  <button
                    onClick={() => (isEditing ? cancelEdit() : startEdit(r))}
                    disabled={busy}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1 ${tw.button.secondary} disabled:opacity-50`}
                    data-testid={`button-report-edit-${r.id}`}
                  >
                    <Pencil className="w-3 h-3" /> {isEditing ? 'Close editor' : 'Edit'}
                  </button>
                  <button
                    onClick={() => deleteRow(r)}
                    disabled={busy}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1 ${tw.button.danger} disabled:opacity-50`}
                    data-testid={`button-report-delete-${r.id}`}
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                  {busy && <Loader2 className={`w-3.5 h-3.5 animate-spin ${tw.icon.muted}`} />}
                </div>

                {isEditing && draft && (
                  <div
                    className="mt-2.5 p-3 rounded-xl bg-[var(--space-surface-card)] border border-[var(--space-border-default)] space-y-2"
                    data-testid={`admin-report-editor-${r.id}`}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className={adminLabelCls}>Street / estate</label>
                        <input
                          type="text"
                          value={draft.street}
                          onChange={(e) => setDraft({ ...draft, street: e.target.value })}
                          className={adminInputCls}
                          data-testid={`input-edit-street-${r.id}`}
                        />
                      </div>
                      <div>
                        <label className={adminLabelCls}>Reporter name</label>
                        <input
                          type="text"
                          value={draft.reporter_name}
                          onChange={(e) => setDraft({ ...draft, reporter_name: e.target.value })}
                          placeholder="e.g. Tunde A."
                          className={adminInputCls}
                        />
                      </div>
                      {r.report_type === 'flood' ? (
                        <>
                          <div>
                            <label className={adminLabelCls}>When it happened</label>
                            <input
                              type="text"
                              value={draft.event_period}
                              onChange={(e) => setDraft({ ...draft, event_period: e.target.value })}
                              placeholder="e.g. July 2025 rains"
                              className={adminInputCls}
                            />
                          </div>
                          <div>
                            <label className={adminLabelCls}>Severity</label>
                            <select
                              value={draft.severity}
                              onChange={(e) => setDraft({ ...draft, severity: e.target.value })}
                              className={adminInputCls}
                            >
                              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <label className={adminLabelCls}>Avg power per day (hours)</label>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.5"
                              value={draft.avg_daily_hours}
                              onChange={(e) => setDraft({ ...draft, avg_daily_hours: e.target.value })}
                              className={adminInputCls}
                            />
                          </div>
                          <div>
                            <label className={adminLabelCls}>Outage pattern</label>
                            <input
                              type="text"
                              value={draft.outage_pattern}
                              onChange={(e) => setDraft({ ...draft, outage_pattern: e.target.value })}
                              placeholder="e.g. Off most afternoons 12–4pm"
                              className={adminInputCls}
                            />
                          </div>
                          <div>
                            <label className={adminLabelCls}>Observation window</label>
                            <input
                              type="text"
                              value={draft.period}
                              onChange={(e) => setDraft({ ...draft, period: e.target.value })}
                              placeholder="e.g. Jan–Jun 2026"
                              className={adminInputCls}
                            />
                          </div>
                        </>
                      )}
                      <div>
                        <label className={adminLabelCls}>Source</label>
                        <select
                          value={draft.source_type}
                          onChange={(e) => setDraft({ ...draft, source_type: e.target.value })}
                          className={adminInputCls}
                          data-testid={`select-edit-source-${r.id}`}
                        >
                          {SOURCE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={adminLabelCls}>Description</label>
                      <textarea
                        rows={2}
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        className={`${adminInputCls} resize-none`}
                      />
                    </div>
                    <p className={`text-[10px] ${typography.color.muted}`}>
                      Tip: once you have confirmed a seed example, set its source to “Veranda-verified (founder)” and mark it
                      verified — renters then see it as a Veranda-verified report instead of “Seed example — pending
                      verification”.
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => saveEdit(r)}
                        disabled={busy}
                        className={`px-3 py-1.5 rounded-lg text-[11px] flex items-center gap-1 ${tw.button.primary} disabled:opacity-50`}
                        data-testid={`button-report-save-${r.id}`}
                      >
                        <Check className="w-3 h-3" /> Save changes
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={busy}
                        className={`px-3 py-1.5 rounded-lg text-[11px] flex items-center gap-1 ${tw.button.secondary} disabled:opacity-50`}
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function AdminDashboard({
  isEntrepreneur,
  onBack,
}: {
  isEntrepreneur: boolean;
  onBack: () => void;
}) {
  const [authed, setAuthed] = useState<boolean>(() => {
    if (isEntrepreneur) return true;
    try {
      return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // ---- data hooks (only meaningful once authed, but hooks must run unconditionally) ----
  const listingsHook = window.useWorkspaceDB('listings', { shared: true, limit: 1 });
  const accountsHook = window.useWorkspaceDB<RenterAccount>('renter_accounts', {
    shared: true,
    limit: 8,
    orderBy: { column: 'created_at', direction: 'desc' },
  });
  const freeUnlocksHook = window.useWorkspaceDB<AccountUnlock>('account_unlocks', {
    shared: true,
    limit: 1,
    filters: [{ column: 'unlock_type', operator: 'eq', value: 'free' }],
  });
  const subUnlocksHook = window.useWorkspaceDB<AccountUnlock>('account_unlocks', {
    shared: true,
    limit: 1,
    filters: [{ column: 'unlock_type', operator: 'eq', value: 'subscription' }],
  });
  const recentUnlocksHook = window.useWorkspaceDB<AccountUnlock>('account_unlocks', {
    shared: true,
    limit: 12,
    orderBy: { column: 'created_at', direction: 'desc' },
  });

  // ---- subscribers + MRR ----
  const [subCount, setSubCount] = useState<number | null>(null);
  const [subLoadFailed, setSubLoadFailed] = useState(false);
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/crm/subscribers/${WORKSPACE_ID}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && typeof data.activeCount === 'number') {
            setSubCount(data.activeCount);
            return;
          }
        }
        // Fallback: count active subscriptions directly
        const alt = await fetch(`/api/payments/subscriptions?workspaceId=${WORKSPACE_ID}`);
        if (alt.ok) {
          const data = await alt.json();
          if (!cancelled && Array.isArray(data.subscriptions)) {
            setSubCount(data.subscriptions.filter((s: any) => s.status === 'active' || s.status === 'trialing').length);
            return;
          }
        }
        if (!cancelled) setSubLoadFailed(true);
      } catch {
        if (!cancelled) setSubLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const tryAuth = () => {
    if (password === ADMIN_PASSWORD) {
      setAuthed(true);
      setAuthError(null);
      try {
        sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      } catch {}
    } else {
      setAuthError('Wrong password.');
    }
  };

  if (!authed) {
    return (
      <div className="pb-6 max-w-sm mx-auto">
        <button
          onClick={onBack}
          className={`flex items-center gap-1.5 text-sm ${typography.color.secondary} hover:opacity-80 mb-4`}
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className={`${tw.card.default} rounded-2xl p-5 text-center`}>
          <div className={`w-11 h-11 rounded-2xl mx-auto mb-3 flex items-center justify-center ${tw.bg.accent}`}>
            <Lock className={`w-5 h-5 ${tw.icon.primary}`} />
          </div>
          <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>Veranda team access</p>
          <p className={`text-xs mt-1 ${typography.color.muted}`}>Internal dashboard — password required.</p>
          <div className="relative mt-4">
            <KeyRound className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${tw.icon.muted}`} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && tryAuth()}
              placeholder="Team password"
              className={`${tw.input.base} ${tw.input.default} pl-10 text-sm rounded-xl`}
              data-testid="input-admin-password"
            />
          </div>
          {authError && <p className={`text-xs mt-2 ${typography.color.danger}`}>{authError}</p>}
          <button
            onClick={tryAuth}
            className={`mt-3 w-full py-3 rounded-xl text-sm ${tw.button.primary}`}
            data-testid="button-admin-login"
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  const freeCount = freeUnlocksHook.total || 0;
  const paidCount = subUnlocksHook.total || 0;
  const totalUnlocks = freeCount + paidCount;
  const mrrNgn = subCount != null ? subCount * SUBSCRIPTION_PRICE_NGN : null;

  return (
    <div className="pb-6">
      <button
        onClick={onBack}
        className={`flex items-center gap-1.5 text-sm ${typography.color.secondary} hover:opacity-80 mb-3`}
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center gap-2 mb-4">
        <Activity className={`w-5 h-5 ${tw.icon.primary}`} />
        <div>
          <h2 className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>Admin dashboard</h2>
          <p className={`text-[11px] ${typography.color.muted}`}>Internal — not visible to renters without the team password.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={Building2}
          label="Active listings"
          value={listingsHook.total ?? '—'}
          hint="aggregated from the portals"
          loading={listingsHook.loading}
        />
        <StatTile
          icon={Users}
          label="Renter accounts"
          value={accountsHook.total ?? '—'}
          hint="email accounts created"
          loading={accountsHook.loading}
        />
        <StatTile
          icon={CreditCard}
          label="Active subscribers"
          value={subLoadFailed ? '—' : subCount ?? '…'}
          hint={subLoadFailed ? 'could not load from Stripe' : `₦${SUBSCRIPTION_PRICE_NGN.toLocaleString()}/mo each`}
        />
        <StatTile
          icon={TrendingUp}
          label="MRR"
          value={mrrNgn != null ? `₦${mrrNgn.toLocaleString()}` : '—'}
          hint={mrrChargeHint(subCount)}
        />
      </div>

      {/* Unlock breakdown */}
      <div className={`${tw.card.default} rounded-2xl p-4 mt-3`} data-testid="admin-unlock-breakdown">
        <div className="flex items-center gap-2 mb-2.5">
          <Ticket className={`w-4 h-4 ${tw.icon.primary}`} />
          <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
            Report unlocks · {totalUnlocks}
          </p>
        </div>
        {freeUnlocksHook.loading || subUnlocksHook.loading ? (
          <Loader2 className={`w-4 h-4 animate-spin ${tw.icon.muted}`} />
        ) : (
          <>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-[var(--space-surface-muted)]" aria-hidden="true">
              {totalUnlocks > 0 && (
                <>
                  <span
                    className="bg-[var(--space-brand-highlight-500)]"
                    style={{ width: `${(freeCount / totalUnlocks) * 100}%` }}
                  />
                  <span
                    className="bg-[var(--space-brand-primary)]"
                    style={{ width: `${(paidCount / totalUnlocks) * 100}%` }}
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className={`inline-flex items-center gap-1.5 text-xs ${typography.color.secondary}`}>
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--space-brand-highlight-500)]" /> Free · {freeCount}
              </span>
              <span className={`inline-flex items-center gap-1.5 text-xs ${typography.color.secondary}`}>
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--space-brand-primary)]" /> Subscription · {paidCount}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="admin-recent-unlocks">
          <p className={`text-sm mb-2.5 ${typography.weight.semibold} ${typography.color.primary}`}>Recent unlocks</p>
          {recentUnlocksHook.loading ? (
            <Loader2 className={`w-4 h-4 animate-spin ${tw.icon.muted}`} />
          ) : (recentUnlocksHook.data || []).length === 0 ? (
            <p className={`text-xs ${typography.color.muted}`}>No unlocks yet.</p>
          ) : (
            <ul className="space-y-2">
              {(recentUnlocksHook.data || []).map((u) => (
                <li key={u.id} className={`p-2.5 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}>
                  <div className="flex items-center gap-2">
                    <BadgeCheck className={`w-3.5 h-3.5 shrink-0 ${u.unlock_type === 'subscription' ? tw.icon.primary : tw.icon.success}`} />
                    <span className={`min-w-0 flex-1 text-xs truncate ${typography.color.primary}`}>
                      {u.listing_title || u.address || `Listing #${u.listing_id}`}
                    </span>
                    <span className={`${tw.badge.default} ${u.unlock_type === 'subscription' ? tw.badge.primary : tw.badge.neutral}`}>
                      {u.unlock_type}
                    </span>
                  </div>
                  <p className={`text-[10px] mt-1 ${typography.color.muted}`}>
                    {u.account_email} · {areaName(u.area_key)}
                    {u.created_at ? ` · ${new Date(u.created_at).toLocaleString()}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="admin-recent-accounts">
          <p className={`text-sm mb-2.5 ${typography.weight.semibold} ${typography.color.primary}`}>Newest accounts</p>
          {accountsHook.loading ? (
            <Loader2 className={`w-4 h-4 animate-spin ${tw.icon.muted}`} />
          ) : (accountsHook.data || []).length === 0 ? (
            <p className={`text-xs ${typography.color.muted}`}>No renter accounts yet.</p>
          ) : (
            <ul className="space-y-2">
              {(accountsHook.data || []).map((a) => (
                <li key={a.id} className={`p-2.5 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)] flex items-center gap-2`}>
                  <Users className={`w-3.5 h-3.5 shrink-0 ${tw.icon.muted}`} />
                  <span className={`min-w-0 flex-1 text-xs truncate ${typography.color.primary}`}>{a.email}</span>
                  <span className={`text-[10px] shrink-0 ${typography.color.muted}`}>
                    {a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Tenant-report moderation */}
      <TenantReportsPanel />

      <p className={`text-[10px] mt-4 text-center ${typography.color.muted}`}>
        Unlock counts come from the account_unlocks table; subscriber counts come from Stripe via the
        platform. MRR = active subscribers × ₦{SUBSCRIPTION_PRICE_NGN.toLocaleString()}.
      </p>
    </div>
  );
}
