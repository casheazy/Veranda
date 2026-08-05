/**
 * Veranda — account page.
 *
 * Shows the renter's unlock history, free-unlocks-remaining balance,
 * subscription status with a manage/cancel path, and sign-out. Also the
 * discreet entry point to the internal admin dashboard.
 */
import { useState } from 'react';
import {
  BadgeCheck,
  ArrowRight,
  Briefcase,
  CalendarX,
  CheckCircle2,
  CreditCard,
  FileSearch,
  Loader2,
  LogOut,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Ticket,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import {
  AccountUnlock,
  FREE_UNLOCK_LIMIT,
  SUBSCRIPTION_PLAN_NAME,
  SUBSCRIPTION_PRICE_NGN,
  areaName,
} from './types';
import { SubscriptionInfo, isSubscriptionActive, requestBillingPortal } from './account';
import { matchWorkHub } from './commute';
import { EmailOtpSignIn, SubscribeCard } from './ReportGate';

interface AccountPageProps {
  accountEmail: string | null;
  unlocks: AccountUnlock[];
  unlocksLoading: boolean;
  subInfo: SubscriptionInfo | null;
  subLoading: boolean;
  accountError?: string | null;
  onRetryAccount?: () => void;
  isEntrepreneur: boolean;
  /** The renter's saved "where do you work" destination, if any. */
  workDestination?: string | null;
  /** Persist a work destination for this account (commute personalization). */
  onSaveWorkDestination?: (destination: string) => void | Promise<void>;
  onSignedIn: (email: string) => void;
  onSignOut: () => void;
  onOpenUnlock: (unlock: AccountUnlock) => void;
  onOpenAdmin: () => void;
}

/**
 * "Where do you work?" — the account-level home of the commute destination
 * that the Distance-to-work report card personalizes against. Honest by
 * design: the copy promises measured routes only, never estimates.
 */
function WorkDestinationCard({
  workDestination,
  onSave,
}: {
  workDestination: string | null;
  onSave: (destination: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Optimistic value so the card flips to display mode the moment the save
  // lands, before the parent's data hook refresh catches up.
  const [localDest, setLocalDest] = useState<string | null>(null);

  const effectiveDest = localDest ?? workDestination;
  const hub = matchWorkHub(effectiveDest);
  const showForm = editing || !effectiveDest;

  const save = async () => {
    const dest = draft.trim();
    if (!dest || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.resolve(onSave(dest));
      setLocalDest(dest);
      setEditing(false);
      setJustSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'We could not save your workplace. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="card-work-destination">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Briefcase className={`w-4 h-4 ${tw.icon.primary}`} />
          <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>Commute destination</p>
        </div>
        {effectiveDest && !editing && (
          <button
            onClick={() => {
              setDraft(effectiveDest);
              setJustSaved(false);
              setSaveError(null);
              setEditing(true);
            }}
            className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] ${tw.button.secondary}`}
            data-testid="button-edit-work-destination"
          >
            <Pencil className="w-3 h-3" /> Change
          </button>
        )}
      </div>

      {showForm ? (
        <div className="mt-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="Where do you work? e.g. Marina, Lagos Island"
              className={`${tw.input.base} ${tw.input.default} text-xs rounded-xl py-2`}
              data-testid="input-account-work-destination"
            />
            <button
              onClick={save}
              disabled={saving || !draft.trim()}
              className={`shrink-0 px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 ${tw.button.primary} disabled:opacity-50`}
              data-testid="button-account-save-work"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save
            </button>
          </div>
          {editing && (
            <button
              onClick={() => {
                setEditing(false);
                setSaveError(null);
              }}
              className={`mt-1.5 py-1 text-[11px] ${typography.color.muted} underline underline-offset-2`}
            >
              Keep “{effectiveDest}”
            </button>
          )}
          {saveError && (
            <div
              className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-[var(--space-semantic-danger)] bg-[var(--space-semantic-danger-50)] p-2.5"
              role="alert"
              data-testid="work-destination-error"
            >
              <p className={`text-[11px] ${typography.color.danger}`}>{saveError}</p>
              <button
                onClick={save}
                disabled={saving}
                className={`shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] ${tw.button.secondary} disabled:opacity-50`}
                data-testid="button-retry-save-work"
              >
                <RefreshCw className={`w-3 h-3 ${saving ? 'animate-spin' : ''}`} /> Try again
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className={`text-sm mt-2 ${typography.weight.medium} ${typography.color.primary}`} data-testid="text-work-destination">
            {effectiveDest}
          </p>
          {justSaved && (
            <p className={`text-xs mt-1 ${typography.color.success}`}>Saved — your reports will use this destination.</p>
          )}
          {hub && (
            <p className={`text-[11px] mt-1 ${typography.color.muted}`}>
              Matches the {hub.label} work hub — measured area baselines cover it as they land.
            </p>
          )}
        </>
      )}

      <p className={`text-[11px] mt-2 ${typography.color.muted}`}>
        Powers the “Distance to work” card on every report you unlock. We only show real routes
        measured in live Lagos traffic — until your route has been measured, the card stays gray
        rather than guessing.
      </p>
    </div>
  );
}

export default function AccountPage({
  accountEmail,
  unlocks,
  unlocksLoading,
  subInfo,
  subLoading,
  accountError,
  onRetryAccount,
  isEntrepreneur,
  workDestination,
  onSaveWorkDestination,
  onSignedIn,
  onSignOut,
  onOpenUnlock,
  onOpenAdmin,
}: AccountPageProps) {
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalMessage, setPortalMessage] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);

  const freeUsed = unlocks.filter((u) => u.unlock_type === 'free').length;
  const freeLeft = Math.max(0, FREE_UNLOCK_LIMIT - freeUsed);
  const subscribed = isSubscriptionActive(subInfo);

  const openPortal = async () => {
    if (!accountEmail || portalBusy) return;
    setPortalBusy(true);
    setPortalError(null);
    setPortalMessage(null);
    try {
      const msg = await requestBillingPortal(accountEmail);
      if (msg) setPortalMessage(msg);
    } catch (e) {
      setPortalError(e instanceof Error ? e.message : 'Could not open subscription management.');
    } finally {
      setPortalBusy(false);
    }
  };

  if (!accountEmail) {
    return (
      <div className="pb-6 max-w-md mx-auto">
        <div className="flex items-start gap-2.5 mb-4">
          <UserRound className={`w-5 h-5 mt-0.5 shrink-0 ${tw.icon.primary}`} />
          <div>
            <h2 className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>Your account</h2>
            <p className={`text-xs mt-1 ${typography.color.muted}`}>
              Enter your email to see your unlocked reports, your free-report balance and your
              subscription — on any device.
            </p>
          </div>
        </div>
        <div className={`${tw.card.default} rounded-2xl p-4`}>
          <EmailOtpSignIn ctaLabel="Sign in — no password" onSignedIn={onSignedIn} />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${tw.bg.accent}`}>
            <UserRound className={`w-5 h-5 ${tw.icon.primary}`} />
          </span>
          <div className="min-w-0">
            <p className={`text-sm truncate ${typography.weight.semibold} ${typography.color.primary}`}>{accountEmail}</p>
            <p className={`text-[11px] ${typography.color.muted}`}>Veranda renter account</p>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs ${tw.button.ghost}`}
          data-testid="button-sign-out"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>

      {accountError && (
        <div
          className="mb-3 flex items-start gap-3 rounded-2xl border border-[var(--space-semantic-danger)] bg-[var(--space-semantic-danger-50)] p-4"
          role="alert"
          data-testid="account-load-error"
        >
          <TriangleAlert className={`mt-0.5 w-4 h-4 shrink-0 ${typography.color.danger}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-xs ${typography.weight.semibold} ${typography.color.primary}`}>
              Some account details are still syncing.
            </p>
            <p className={`mt-1 text-[11px] ${typography.color.muted}`}>{accountError}</p>
            {onRetryAccount && (
              <button
                onClick={onRetryAccount}
                className={`mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs ${tw.button.secondary}`}
                data-testid="button-retry-account"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry account
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {/* Free-report balance */}
        <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="card-free-balance">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Ticket className={`w-4 h-4 ${tw.icon.primary}`} />
              <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>Free reports</p>
            </div>
            {subscribed ? (
              <span className={`${tw.badge.default} ${tw.badge.success}`}>Unlimited with subscription</span>
            ) : (
              <span className={`${tw.badge.default} ${tw.badge.primary}`}>
                {freeLeft} of {FREE_UNLOCK_LIMIT} remaining
              </span>
            )}
          </div>
          {!subscribed && (
            <div className="flex gap-1.5 mt-3" aria-hidden="true">
              {Array.from({ length: FREE_UNLOCK_LIMIT }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < freeUsed ? 'bg-[var(--space-brand-primary)]' : 'bg-[var(--space-surface-muted)]'
                  }`}
                />
              ))}
            </div>
          )}
          <p className={`text-[11px] mt-2 ${typography.color.muted}`}>
            Free unlocks are lifetime, per account — reopening a report you already unlocked never
            uses another one. Browsing and searching stay free forever.
          </p>
        </div>

        {/* Subscription */}
        <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="card-subscription">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CreditCard className={`w-4 h-4 ${tw.icon.primary}`} />
              <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>Subscription</p>
            </div>
            {subLoading ? (
              <Loader2 className={`w-4 h-4 animate-spin ${tw.icon.muted}`} />
            ) : subscribed && subInfo?.cancelAtPeriodEnd ? (
              <span className={`${tw.badge.default} ${tw.badge.warning} inline-flex items-center gap-1`}>
                <CalendarX className="w-3 h-3" />
                Ends{' '}
                {subInfo.currentPeriodEnd
                  ? new Date(subInfo.currentPeriodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : 'at period end'}
              </span>
            ) : subscribed ? (
              <span className={`${tw.badge.default} ${tw.badge.success} inline-flex items-center gap-1`}>
                <CheckCircle2 className="w-3 h-3" /> Active
              </span>
            ) : subInfo?.status === 'past_due' ? (
              <span className={`${tw.badge.default} ${tw.badge.danger}`}>Payment past due</span>
            ) : subInfo?.status === 'canceled' ? (
              <span className={`${tw.badge.default} ${tw.badge.neutral}`}>Canceled</span>
            ) : (
              <span className={`${tw.badge.default} ${tw.badge.neutral}`}>Not subscribed</span>
            )}
          </div>

          {accountError ? (
            <p className={`text-[11px] mt-2 ${typography.color.muted}`}>
              Retry your account above before starting or changing a subscription, so we can confirm
              your current access first.
            </p>
          ) : subscribed ? (
            <>
              <p
                className={`text-xs mt-2 ${typography.weight.semibold} ${typography.color.primary}`}
                data-testid="subscription-plan-line"
              >
                {SUBSCRIPTION_PLAN_NAME} — ₦{SUBSCRIPTION_PRICE_NGN.toLocaleString()}/month
                {subInfo?.currentPeriodEnd
                  ? ` · ${subInfo.cancelAtPeriodEnd ? 'Access until' : 'Next billing'} ${new Date(
                      subInfo.currentPeriodEnd
                    ).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : ''}
              </p>
              <p className={`text-[11px] mt-1.5 ${typography.color.muted}`}>
                Unlimited one-click report unlocks. Cancel anytime — you keep access until the end of
                the paid period, and every report you've unlocked stays yours.
              </p>
              <button
                onClick={openPortal}
                disabled={portalBusy}
                className={`mt-3 px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 ${tw.button.secondary} disabled:opacity-50`}
                data-testid="button-manage-subscription"
              >
                {portalBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                Manage or cancel subscription
              </button>
              {portalMessage && <p className={`text-xs mt-2 ${typography.color.success}`}>{portalMessage}</p>}
              {portalError && <p className={`text-xs mt-2 ${typography.color.danger}`}>{portalError}</p>}
            </>
          ) : freeLeft === 0 && !subLoading ? (
            <div className="mt-3">
              <SubscribeCard email={accountEmail} compact />
            </div>
          ) : (
            <p className={`text-[11px] mt-2 ${typography.color.muted}`}>
              Nothing to pay while you still have free reports. When they run out, a subscription
              (₦{SUBSCRIPTION_PRICE_NGN.toLocaleString()}/month, cancel anytime) unlocks unlimited reports.
            </p>
          )}
        </div>

        {/* Commute destination */}
        {onSaveWorkDestination && (
          <WorkDestinationCard workDestination={workDestination || null} onSave={onSaveWorkDestination} />
        )}

        {/* Unlock history */}
        <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="card-unlock-history">
          <div className="flex items-center gap-2 mb-2.5">
            <FileSearch className={`w-4 h-4 ${tw.icon.primary}`} />
            <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
              Your unlocked reports · {unlocks.length}
            </p>
          </div>
          {unlocksLoading ? (
            <div className="py-4 text-center">
              <Loader2 className={`w-4 h-4 mx-auto animate-spin ${tw.icon.muted}`} />
            </div>
          ) : unlocks.length === 0 ? (
            <p className={`text-xs ${typography.color.muted}`}>
              No reports unlocked yet. Find a home you like and your first {FREE_UNLOCK_LIMIT} full
              reports are free.
            </p>
          ) : (
            <ul className="space-y-2">
              {unlocks.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => onOpenUnlock(u)}
                    className={`w-full text-left p-3 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)] flex items-center gap-2.5 hover:brightness-[0.98] transition-all`}
                    data-testid={`unlock-history-${u.id}`}
                  >
                    <BadgeCheck className={`w-4 h-4 shrink-0 ${tw.icon.success}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-xs truncate ${typography.weight.medium} ${typography.color.primary}`}>
                        {u.listing_title || u.address || 'Unlocked report'}
                      </span>
                      <span className={`block text-[10px] ${typography.color.muted}`}>
                        {areaName(u.area_key)} · {u.unlock_type === 'subscription' ? 'subscription' : 'free unlock'}
                        {u.created_at ? ` · ${new Date(u.created_at).toLocaleDateString()}` : ''}
                      </span>
                    </span>
                    <ArrowRight className={`w-4 h-4 shrink-0 ${tw.icon.muted}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Internal admin entry — discreet on purpose */}
      <div className="mt-6 text-center">
        <button
          onClick={onOpenAdmin}
          className={`inline-flex items-center gap-1.5 text-[11px] ${typography.color.muted} hover:opacity-80 underline underline-offset-2`}
          data-testid="button-open-admin"
        >
          <ShieldCheck className="w-3 h-3" />
          {isEntrepreneur ? 'Open admin dashboard' : 'Veranda team access'}
        </button>
      </div>
    </div>
  );
}
