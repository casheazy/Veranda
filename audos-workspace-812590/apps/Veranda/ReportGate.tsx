/**
 * Veranda — report unlock gate (the freemium core).
 *
 * Order of states for a locked report:
 *  1. Not signed in → teaser + email step (creates/recognizes the lightweight
 *     account; one-time code only when this device hasn't verified the email).
 *  2. Signed in, free unlocks remaining → "X of 5 free reports remaining" +
 *     one-click unlock. No payment screen while free unlocks remain.
 *  3. Signed in, free unlocks exhausted, no subscription → subscribe card
 *     (only shown at this moment — never gates browsing or searching).
 *  4. Subscribed → one-click unlock with no counter and no friction.
 */
import { useMemo, useState } from 'react';
import {
  Droplets,
  Zap,
  Shield,
  MapPin,
  Wifi,
  Lock,
  Unlock as UnlockIcon,
  Loader2,
  Mail,
  KeyRound,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  CreditCard,
  Ticket,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';
import {
  AreaKey,
  AreaProfile,
  Listing,
  TenantReport,
  FREE_UNLOCK_LIMIT,
  SUBSCRIPTION_PLAN_NAME,
  SUBSCRIPTION_PRICE_NGN,
  areaName,
  subscriptionCharge,
} from './types';
import {
  checkEmailVerified,
  ensureRenterAccount,
  isValidEmail,
  normalizeEmail,
  readStoredSession,
  registerSession,
  savePendingUnlock,
  sendOtp,
  startSubscriptionCheckout,
  verifyOtp,
  writeStoredSession,
} from './account';

function redirectTo(url: string) {
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url;
      return;
    }
  } catch {
    /* cross-origin iframe — fall through */
  }
  window.location.href = url;
}

// ---------------------------------------------------------------------------
// Email + one-time-code sign-in (shared with the Account page)
// ---------------------------------------------------------------------------

export function EmailOtpSignIn({
  ctaLabel = 'Continue',
  helperText,
  onSignedIn,
}: {
  ctaLabel?: string;
  helperText?: string;
  onSignedIn: (email: string) => void;
}) {
  const { setSessionId } = useSpaceRuntime();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(() => readStoredSession()?.email || '');
  const [code, setCode] = useState('');
  const [sessionUuid, setSessionUuid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finishSignIn = async (normalized: string, wsid: string) => {
    writeStoredSession(normalized, wsid);
    setSessionId(wsid);
    // Authentication is already complete. A transient profile-write failure
    // must not invalidate the verified session; App provisions/retries the row.
    try {
      await ensureRenterAccount(normalized);
    } catch {}
    onSignedIn(normalized);
  };

  const submitEmail = async () => {
    setError(null);
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    const normalized = normalizeEmail(email);
    setBusy(true);
    try {
      const wsid = await registerSession(normalized);
      setSessionUuid(wsid);
      const previouslyVerified = await checkEmailVerified(normalized);
      const storedEmail = normalizeEmail(readStoredSession()?.email || '');
      if (previouslyVerified && storedEmail === normalized) {
        // Returning renter on a device that already knows this email — instant.
        await finishSignIn(normalized, wsid);
        return;
      }
      await sendOtp(normalized, wsid);
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError(null);
    if (!sessionUuid) {
      setStep('email');
      return;
    }
    if (code.trim().length < 4) {
      setError('Enter the code from your email.');
      return;
    }
    setBusy(true);
    try {
      const normalized = normalizeEmail(email);
      await verifyOtp(normalized, code.trim(), sessionUuid);
      await finishSignIn(normalized, sessionUuid);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid or expired code.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <div data-testid="otp-code-step">
        <p className={`text-xs ${typography.color.secondary}`}>
          We sent a one-time code to <span className={typography.weight.semibold}>{normalizeEmail(email)}</span>. No
          password — ever.
        </p>
        <div className="relative mt-2.5">
          <KeyRound className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${tw.icon.muted}`} />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitCode()}
            placeholder="Enter code"
            maxLength={8}
            className={`${tw.input.base} ${tw.input.default} pl-10 text-sm rounded-xl tracking-widest`}
            data-testid="input-otp-code"
          />
        </div>
        {error && <p className={`text-xs mt-2 ${typography.color.danger}`}>{error}</p>}
        <button
          onClick={submitCode}
          disabled={busy}
          className={`mt-3 w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.primary} disabled:opacity-50`}
          data-testid="button-verify-code"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Verify & continue
        </button>
        <button
          onClick={() => {
            setStep('email');
            setCode('');
            setError(null);
          }}
          className={`mt-2 w-full py-1.5 text-xs ${typography.color.muted} underline underline-offset-2`}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div data-testid="otp-email-step">
      {helperText && <p className={`text-xs mb-2.5 ${typography.color.secondary}`}>{helperText}</p>}
      <div className="relative">
        <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${tw.icon.muted}`} />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitEmail()}
          placeholder="you@example.com"
          className={`${tw.input.base} ${tw.input.default} pl-10 text-sm rounded-xl`}
          data-testid="input-account-email"
        />
      </div>
      {error && <p className={`text-xs mt-2 ${typography.color.danger}`}>{error}</p>}
      <button
        onClick={submitEmail}
        disabled={busy}
        className={`mt-3 w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.primary} disabled:opacity-50`}
        data-testid="button-continue-email"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        {ctaLabel}
      </button>
      <p className={`text-[10px] mt-2 text-center ${typography.color.muted}`}>
        No password — we'll email you a one-time code if this device doesn't know you yet.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscribe card — shown ONLY once the 5 free unlocks are exhausted
// ---------------------------------------------------------------------------

export function SubscribeCard({
  email,
  listing,
  areaKey,
  address,
  compact = false,
}: {
  email: string;
  listing?: Listing | null;
  areaKey?: AreaKey;
  address?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const charge = subscriptionCharge();

  const subscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      if (areaKey && address) {
        savePendingUnlock({
          kind: listing?.id != null ? 'listing' : 'area',
          listingId: listing?.id ?? null,
          areaKey,
          address,
          title: listing?.title || address,
        });
      }
      const url = await startSubscriptionCheckout(email);
      redirectTo(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start checkout — please try again.');
      setBusy(false);
    }
  };

  return (
    <div className={`${tw.card.default} rounded-2xl p-4`} data-testid="subscribe-card">
      {!compact && (
        <>
          <div className="flex items-center gap-2">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tw.bg.accent}`}>
              <Sparkles className={`w-4 h-4 ${tw.icon.primary}`} />
            </span>
            <div>
              <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
                You've used all {FREE_UNLOCK_LIMIT} free reports
              </p>
              <p className={`text-[11px] ${typography.color.muted}`}>Browsing stays free — always.</p>
            </div>
          </div>
          <div className="my-3 border-t border-[var(--space-border-default)]" />
        </>
      )}
      <p className={`text-[11px] uppercase tracking-wide ${typography.weight.semibold} ${typography.color.brand}`} data-testid="subscribe-plan-name">
        {SUBSCRIPTION_PLAN_NAME}
      </p>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <p className={`text-2xl ${typography.weight.bold} ${typography.color.brand}`}>
          ₦{SUBSCRIPTION_PRICE_NGN.toLocaleString()}
        </p>
        <p className={`text-xs ${typography.color.muted}`}>/month · cancel anytime</p>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {[
          'Unlimited verification reports — one click, no counter',
          'All five dimensions: flood, power, commute, network, security',
          'Ask the report assistant anything, on every unlocked home',
        ].map((line) => (
          <li key={line} className={`flex items-start gap-2 text-xs ${typography.color.secondary}`}>
            <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tw.icon.success}`} />
            {line}
          </li>
        ))}
      </ul>
      <button
        onClick={subscribe}
        disabled={busy}
        className={`mt-4 w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.primary} disabled:opacity-50`}
        data-testid="button-subscribe"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
        Subscribe for ₦{SUBSCRIPTION_PRICE_NGN.toLocaleString()}/month
      </button>
      <p className={`text-[10px] mt-2 text-center ${typography.color.muted}`}>
        Secure Stripe card checkout — {charge.note}.
        {areaKey && address ? ' You\u2019ll come straight back to this report.' : ''}
      </p>
      {error && <p className={`text-xs mt-2 text-center ${typography.color.danger}`}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The locked-report panel
// ---------------------------------------------------------------------------

type LockedDimension = { icon: typeof Droplets; label: string };

/** Every report preview shows the same five dimensions. There is deliberately
 * no two-card address variant: unavailable data stays visible as a gray card. */
const LOCKED_DIMENSIONS: LockedDimension[] = [
  { icon: Droplets, label: 'Flood risk' },
  { icon: Zap, label: 'Grid power' },
  { icon: MapPin, label: 'Commute Intelligence' },
  { icon: Wifi, label: 'Network coverage' },
  { icon: Shield, label: 'Security' },
];

interface ReportGateProps {
  /** Omitted for an address/area report, which has no listing behind it. */
  listing?: Listing | null;
  areaKey: AreaKey;
  address: string;
  profile: AreaProfile | undefined;
  reports: TenantReport[];
  accountEmail: string | null;
  freeUsed: number;
  subscribed: boolean;
  /** True while unlock rows / subscription status are still loading. */
  accountLoading: boolean;
  /** A failed history/subscription read shows a retry notice without replacing the report action. */
  accountError?: string | null;
  onRetryAccount?: () => void;
  onSignedIn: (email: string) => void;
  /** Perform the unlock (parent decides free vs subscription). */
  onUnlock: () => Promise<void>;
}

export default function ReportGate({
  listing,
  areaKey,
  address,
  profile,
  reports,
  accountEmail,
  freeUsed,
  subscribed,
  accountLoading,
  accountError,
  onRetryAccount,
  onSignedIn,
  onUnlock,
}: ReportGateProps) {
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const freeLeft = Math.max(0, FREE_UNLOCK_LIMIT - freeUsed);

  const teaserFlags = useMemo(() => {
    let flags = 0;
    const floodClass = profile?.flood_zone_class;
    if (floodClass === 'high' || floodClass === 'moderate') flags += 1;
    const band = profile?.disco_band;
    if (band && band !== 'A') flags += 1;
    if (
      reports.some(
        (r) => r.area_key === areaKey && (r.severity === 'waist' || r.severity === 'severe')
      )
    )
      flags += 1;
    return Math.max(flags, 1);
  }, [profile, reports, areaKey]);

  const areaReportCount = useMemo(
    () => reports.filter((r) => r.area_key === areaKey).length,
    [reports, areaKey]
  );

  const doUnlock = async () => {
    if (unlocking) return;
    setUnlocking(true);
    setError(null);
    try {
      await onUnlock();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unlock — please try again.');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div data-testid="report-gate">
      {/* Free preview */}
      <div className={`${tw.card.default} rounded-2xl p-4 mb-3`}>
        <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>Free preview</p>
        <p className={`text-sm mt-1.5 leading-relaxed ${typography.color.secondary}`}>
          Our lookups checked this address against the {areaName(areaKey)} flood-zone classification
          and its official electricity tariff band — and found{' '}
          <span className={`${typography.weight.semibold} text-[var(--space-semantic-warning-700)]`}>
            {teaserFlags} signal{teaserFlags > 1 ? 's' : ''} you should see before you sign anything
          </span>
          .{areaReportCount > 0 ? ` Backed by ${areaReportCount} tenant report${areaReportCount > 1 ? 's' : ''} on the ground.` : ''}{' '}
          The full report always includes all five cards: flood, power, commute, network and security.
        </p>
      </div>

      {/* Blurred locked cards behind the unlock panel */}
      <div className="relative">
        <div className="blur-[6px] select-none pointer-events-none space-y-2.5" aria-hidden="true">
          <div className="h-28 rounded-2xl bg-[var(--space-surface-muted)] border border-[var(--space-border-default)]" />
          {LOCKED_DIMENSIONS.map(({ icon: Icon, label }) => (
            <div key={label} className={`${tw.card.default} rounded-2xl p-4`}>
              <div className="flex items-center gap-3">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tw.bg.accent}`}>
                  <Icon className={`w-[18px] h-[18px] ${tw.icon.primary}`} />
                </span>
                <div className="flex-1">
                  <p className={`text-[10px] uppercase tracking-wide ${typography.color.muted}`}>{label}</p>
                  <div className="h-3.5 w-40 max-w-full rounded bg-[var(--space-surface-muted)] mt-1.5" />
                </div>
                <span className={`${tw.badge.default} ${tw.badge.neutral}`}>•••••</span>
              </div>
            </div>
          ))}
        </div>

        {/* Unlock overlay */}
        <div className="absolute inset-0 flex items-start justify-center p-3 pt-6">
          <div className={`${tw.card.elevated} p-5 w-full max-w-sm`}>
            {accountEmail && !accountLoading && accountError && (
              <div
                className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] p-3"
                role="status"
                data-testid="report-account-sync-notice"
              >
                <p className={`text-[11px] leading-relaxed ${typography.color.muted}`}>
                  Some access details are still syncing. You can continue below or retry the refresh.
                </p>
                {onRetryAccount && (
                  <button
                    onClick={onRetryAccount}
                    className={`shrink-0 px-3 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 ${tw.button.secondary}`}
                    data-testid="button-retry-report-account"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
              </div>
            )}
            {!accountEmail ? (
              <>
                <div className={`w-11 h-11 rounded-2xl mb-3 flex items-center justify-center ${tw.bg.accent}`}>
                  <Lock className={`w-5 h-5 ${tw.icon.primary}`} />
                </div>
                <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
                  Unlock the full verification report
                </p>
                <p className={`text-xs mt-1.5 mb-3.5 ${typography.color.muted}`}>
                  Every renter gets {FREE_UNLOCK_LIMIT} full reports free — flood, power, commute,
                  network & security for this address. Just your email; it also brings back any report you've already unlocked, on any
                  device.
                </p>
                <EmailOtpSignIn ctaLabel="Continue — it's free" onSignedIn={onSignedIn} />
              </>
            ) : accountLoading ? (
              <div className="py-8 text-center">
                <Loader2 className={`w-5 h-5 mx-auto animate-spin ${tw.icon.primary}`} />
                <p className={`text-xs mt-2 ${typography.color.muted}`}>Checking your unlocks…</p>
              </div>
            ) : subscribed ? (
              <>
                <div className={`w-11 h-11 rounded-2xl mb-3 flex items-center justify-center ${tw.bg.accent}`}>
                  <UnlockIcon className={`w-5 h-5 ${tw.icon.primary}`} />
                </div>
                <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
                  Included in your subscription
                </p>
                <p className={`text-xs mt-1.5 ${typography.color.muted}`}>
                  Signed in as {accountEmail}. One click and the full report is yours.
                </p>
                <button
                  onClick={doUnlock}
                  disabled={unlocking}
                  className={`mt-4 w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.primary} disabled:opacity-50`}
                  data-testid="button-unlock-subscribed"
                >
                  {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <UnlockIcon className="w-4 h-4" />}
                  Unlock this report
                </button>
                {error && <p className={`text-xs mt-2 ${typography.color.danger}`}>{error}</p>}
              </>
            ) : freeLeft > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${tw.bg.accent}`}>
                    <Ticket className={`w-5 h-5 ${tw.icon.primary}`} />
                  </div>
                  <span className={`${tw.badge.default} ${tw.badge.primary}`} data-testid="free-unlock-counter">
                    {freeLeft} of {FREE_UNLOCK_LIMIT} free reports remaining
                  </span>
                </div>
                <p className={`text-sm mt-3 ${typography.weight.semibold} ${typography.color.primary}`}>
                  Use a free report on this {listing?.id != null ? 'home' : 'address'}?
                </p>
                <p className={`text-xs mt-1.5 ${typography.color.muted}`}>
                  Signed in as {accountEmail}. Unlocked reports stay yours forever — reopening one never
                  costs another unlock.
                </p>
                <button
                  onClick={doUnlock}
                  disabled={unlocking}
                  className={`mt-4 w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.primary} disabled:opacity-50`}
                  data-testid="button-unlock-free"
                >
                  {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <UnlockIcon className="w-4 h-4" />}
                  Unlock free report
                </button>
                {error && <p className={`text-xs mt-2 ${typography.color.danger}`}>{error}</p>}
              </>
            ) : (
              <SubscribeCard
                email={accountEmail}
                listing={listing}
                areaKey={areaKey}
                address={address}
              />
            )}
          </div>
        </div>

        {/* Spacer so the overlay never overflows the five-card blurred stack. */}
        <div className="h-24" aria-hidden="true" />
      </div>
    </div>
  );
}
