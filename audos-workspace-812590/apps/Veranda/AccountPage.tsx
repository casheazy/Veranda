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
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Trash2,
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
import {
  CommuteDestination,
  MAX_COMMUTE_DESTINATIONS,
  SubscriptionInfo,
  isSubscriptionActive,
  requestBillingPortal,
} from './account';
import { matchWorkHub } from './commute';
import { EmailOtpSignIn, SubscribeCard } from './ReportGate';
import { DestinationEditor } from './ReportView';

interface AccountPageProps {
  accountEmail: string | null;
  unlocks: AccountUnlock[];
  unlocksLoading: boolean;
  subInfo: SubscriptionInfo | null;
  subLoading: boolean;
  accountError?: string | null;
  onRetryAccount?: () => void;
  isEntrepreneur: boolean;
  /** The renter's saved commute destinations (label + address). */
  destinations?: CommuteDestination[];
  /** Index of the destination report commute cards currently show. */
  activeDestinationIndex?: number;
  /** Persist a destination: index null appends, a number replaces. Throws on failure. */
  onSaveDestination?: (dest: CommuteDestination, index: number | null) => void | Promise<void>;
  /** Switch which saved destination reports show. Throws on failure. */
  onSelectDestination?: (index: number) => void | Promise<void>;
  /** Remove a saved destination. Throws on failure. */
  onDeleteDestination?: (index: number) => void | Promise<void>;
  onSignedIn: (email: string) => void;
  onSignOut: () => void;
  onOpenUnlock: (unlock: AccountUnlock) => void;
  onOpenAdmin: () => void;
}

/**
 * "Commute destinations" — the account-level home of the labelled places the
 * commute card can route to (work, school, market, church, family). Up to
 * MAX_COMMUTE_DESTINATIONS per account; the active one is what every report's
 * commute card shows, and it can also be switched right on the card. Honest
 * by design: the copy promises measured routes only, never estimates.
 */
function CommuteDestinationsCard({
  destinations,
  activeIndex,
  onSave,
  onSelect,
  onDelete,
}: {
  destinations: CommuteDestination[];
  activeIndex: number;
  onSave: (dest: CommuteDestination, index: number | null) => void | Promise<void>;
  onSelect?: (index: number) => void | Promise<void>;
  onDelete?: (index: number) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  const runRowAction = async (index: number, fn: () => void | Promise<void>) => {
    setActionError(null);
    setJustSaved(false);
    setBusyIndex(index);
    try {
      await Promise.resolve(fn());
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'That change could not be saved — please try again.'
      );
    } finally {
      setBusyIndex(null);
    }
  };

  const hub = matchWorkHub(destinations[activeIndex]?.address);

  return (
    <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="card-commute-destinations">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Briefcase className={`w-4 h-4 ${tw.icon.primary}`} />
          <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
            Commute destinations
            {destinations.length > 0 ? ` · ${destinations.length} of ${MAX_COMMUTE_DESTINATIONS}` : ''}
          </p>
        </div>
        {destinations.length > 0 && destinations.length < MAX_COMMUTE_DESTINATIONS && editing === null && (
          <button
            onClick={() => {
              setJustSaved(false);
              setActionError(null);
              setEditing('new');
            }}
            className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] ${tw.button.secondary}`}
            data-testid="button-add-destination-account"
          >
            <PlusCircle className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {justSaved && (
        <p className={`text-xs mt-2 ${typography.color.success}`} data-testid="account-destination-saved-note">
          Saved — your reports will use your destinations.
        </p>
      )}
      {actionError && (
        <p className={`text-xs mt-2 ${typography.color.danger}`} role="alert" data-testid="destination-action-error">
          {actionError}
        </p>
      )}

      {destinations.length === 0 && editing === null ? (
        <>
          <p className={`text-xs mt-2 ${typography.color.muted}`}>
            Where do you commute to? Save any place you go often — your office, school, market,
            church or a family house — with a short label, and every report's commute card shows
            the real Lagos route to it.
          </p>
          <DestinationEditor
            onSave={async (dest) => {
              await Promise.resolve(onSave(dest, null));
              setJustSaved(true);
            }}
          />
        </>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {destinations.map((dest, i) => (
            <li
              key={`${dest.label}-${i}`}
              className={`p-3 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}
              data-testid={`destination-row-${i}`}
            >
              {editing === i ? (
                <DestinationEditor
                  initial={dest}
                  onSave={async (next) => {
                    await Promise.resolve(onSave(next, i));
                    setEditing(null);
                    setJustSaved(true);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs ${typography.weight.semibold} ${typography.color.primary}`}>
                      {dest.label}
                    </span>
                    {i === activeIndex ? (
                      <span className={`${tw.badge.default} ${tw.badge.primary}`}>Shown on reports</span>
                    ) : onSelect ? (
                      <button
                        onClick={() => runRowAction(i, () => onSelect(i))}
                        disabled={busyIndex != null}
                        className={`${tw.badge.default} ${tw.badge.neutral} hover:brightness-95 disabled:opacity-50`}
                        data-testid={`button-activate-destination-${i}`}
                      >
                        Show on reports
                      </button>
                    ) : null}
                    {busyIndex === i && <Loader2 className={`w-3 h-3 animate-spin ${tw.icon.muted}`} />}
                  </div>
                  <p className={`text-xs mt-1 ${typography.color.secondary}`} data-testid={`destination-address-${i}`}>
                    {dest.address}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      onClick={() => {
                        setJustSaved(false);
                        setActionError(null);
                        setEditing(i);
                      }}
                      disabled={busyIndex != null}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1 ${tw.button.secondary} disabled:opacity-50`}
                      data-testid={`button-edit-destination-${i}`}
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    {onDelete && (
                      <button
                        onClick={() => runRowAction(i, () => onDelete(i))}
                        disabled={busyIndex != null}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1 ${tw.button.ghost} disabled:opacity-50`}
                        data-testid={`button-remove-destination-${i}`}
                      >
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
          {editing === 'new' && (
            <li className={`p-3 rounded-xl ${tw.bg.muted} border border-[var(--space-border-default)]`}>
              <DestinationEditor
                saveLabel="Add"
                onSave={async (dest) => {
                  await Promise.resolve(onSave(dest, null));
                  setEditing(null);
                  setJustSaved(true);
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          )}
        </ul>
      )}

      {hub && (
        <p className={`text-[11px] mt-2 ${typography.color.muted}`}>
          Your report destination matches the {hub.label} work hub — exact property routes take
          priority, with this measured area baseline as fallback.
        </p>
      )}

      <p className={`text-[11px] mt-2 ${typography.color.muted}`}>
        Powers the commute card on every report you unlock — save up to {MAX_COMMUTE_DESTINATIONS}{' '}
        places (work, school, market, church, family) and switch between them right on the card.
        Veranda checks Lagos public transport first — BRT, bus, ferry and rail where available —
        then adds a driving fallback for coverage gaps.
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
  destinations,
  activeDestinationIndex,
  onSaveDestination,
  onSelectDestination,
  onDeleteDestination,
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

        {/* Commute destinations */}
        {onSaveDestination && (
          <CommuteDestinationsCard
            destinations={destinations || []}
            activeIndex={activeDestinationIndex ?? 0}
            onSave={onSaveDestination}
            onSelect={onSelectDestination}
            onDelete={onDeleteDestination}
          />
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
