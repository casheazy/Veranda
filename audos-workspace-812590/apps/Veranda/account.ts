/**
 * Veranda — lightweight renter accounts (email + one-time code, no password)
 * and subscription helpers for the freemium model.
 *
 * Identity model:
 * - The account IS the verified email. Verification uses the platform's
 *   session-management OTP flow (register session → send code → verify code).
 * - Once verified on a device, the session (email + workspaceSessionId) is
 *   stored in the same localStorage key the shell uses
 *   (`space_session_<spaceId>`), so the shell, Settings and this app agree.
 * - Free-unlock usage is derived from the `account_unlocks` table (one row per
 *   unlocked listing per account), never from a mutable counter.
 */

import { subscriptionCharge } from './types';

export const WORKSPACE_ID = '85d8606a-de71-4f05-b2b5-23980bd71b87';

export const PENDING_UNLOCK_KEY = 'veranda_pending_unlock_v1';

export interface PendingUnlock {
  /** 'listing' unlocks a home's full report; 'area' unlocks an address/area report. */
  kind?: 'listing' | 'area';
  listingId?: number | null;
  areaKey: string;
  address: string;
  title: string;
  savedAt: number;
}

export interface StoredSpaceSession {
  id?: string;
  sessionId?: string;
  workspaceSessionId?: string;
  email?: string;
  timestamp?: number;
  createdAt?: string;
}

export interface SubscriptionInfo {
  status: string; // active | trialing | trial | trial_expired | canceled | past_due | not_registered | registered | ...
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  subscriptionId: string | null;
}

export function isSubscriptionActive(info: SubscriptionInfo | null): boolean {
  if (!info) return false;
  return info.status === 'active' || info.status === 'trial' || info.status === 'trialing';
}

function getSpaceId(): string {
  return (window.__SPACE_ID__ as string) || 'workspace-812590';
}

function getAppId(): string {

  return (window.__APP_ID__ || window.__SPACE_ID__ || getSpaceId()) as string;
}

function sessionKey(): string {
  return `space_session_${getSpaceId()}`;
}

export function readStoredSession(): StoredSpaceSession | null {
  try {
    const raw = localStorage.getItem(sessionKey());
    return raw ? (JSON.parse(raw) as StoredSpaceSession) : null;
  } catch {
    return null;
  }
}

export function writeStoredSession(email: string, workspaceSessionId: string): void {
  try {
    const prev = readStoredSession() || {};
    localStorage.setItem(
      sessionKey(),
      JSON.stringify({
        ...prev,
        id: workspaceSessionId,
        sessionId: workspaceSessionId,
        workspaceSessionId,
        email,
        timestamp: Date.now(),
        createdAt: prev.createdAt || new Date().toISOString(),
      })
    );
  } catch {
    /* storage unavailable — session just won't persist */
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(sessionKey());
  } catch {}
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

// ---------------------------------------------------------------------------
// Session-management (register + OTP) API calls
// ---------------------------------------------------------------------------

function getVisitorId(): string | null {
  return document.cookie.match(/audos_vid=([^;]+)/)?.[1] || null;
}

/** Register (idempotent) and get the stable workspaceSessionId for this email. */
export async function registerSession(email: string): Promise<string> {
  const existing = readStoredSession();
  const res = await fetch(`/api/space/${getSpaceId()}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      sessionId: existing?.workspaceSessionId || existing?.sessionId || existing?.id || undefined,
      visitorId: getVisitorId(),
      workspaceId: WORKSPACE_ID,
      metadata: { source: 'veranda-report-unlock' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !(data.workspaceSessionId || data.sessionId)) {
    throw new Error(data.error || 'Could not start sign-in — please try again.');
  }
  return (data.workspaceSessionId || data.sessionId) as string;
}

/** Was this email previously verified anywhere (any device)? */
export async function checkEmailVerified(email: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/otp/space/check-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, email }),
    });
    const data = await res.json();
    return data?.verified === true;
  } catch {
    return false;
  }
}

export async function sendOtp(email: string, sessionUuid: string): Promise<void> {
  const res = await fetch('/api/auth/otp/space/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, workspaceId: WORKSPACE_ID, sessionUuid }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not send the code — please try again.');
  }
}

export async function verifyOtp(email: string, code: string, sessionUuid: string): Promise<void> {
  const res = await fetch('/api/auth/otp/space/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, workspaceId: WORKSPACE_ID, sessionUuid }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success !== true) {
    throw new Error(data.error || 'Invalid or expired code.');
  }
}

// ---------------------------------------------------------------------------
// Renter account rows (WorkspaceDB)
// ---------------------------------------------------------------------------

export interface RenterAccountRow {
  id: number;
  email: string;
  work_destination?: string | null;
}

async function getWorkspaceDb(): Promise<any> {
  // App effects can run a tick before the runtime attaches __workspaceDb,
  // especially immediately after OTP sign-in. Treat that as initialization,
  // not as a failed renter profile refresh.
  for (const delayMs of [0, 75, 200, 500]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const db = (window as any).__workspaceDb;
    if (db) return db;
  }
  throw new Error('Account data is temporarily unavailable.');
}

async function findRenterAccount(db: any, email: string): Promise<RenterAccountRow | null> {
  const { data } = await db
    .from('renter_accounts', { shared: true })
    .eq('email', normalizeEmail(email))
    .limit(1)
    .get();
  return (data && data[0]) || null;
}

/**
 * Idempotently provision the account row used for renter preferences.
 *
 * The old implementation attempted a blind insert and swallowed every error.
 * A genuine insert failure therefore looked identical to the expected unique-
 * email conflict, leaving first-time and legacy renters without a row. Callers
 * then failed later with a dead-end "account could not be loaded" message.
 * Query first, insert only when missing, and verify the row after a possible
 * concurrent insert so subscription and unlock state remain untouched.
 */
export async function ensureRenterAccount(email: string): Promise<RenterAccountRow> {
  const db = await getWorkspaceDb();
  const normalized = normalizeEmail(email);
  const existing = await findRenterAccount(db, normalized);
  if (existing) {
    // This timestamp is useful but must never make a valid account unreadable.
    try {
      await db.from('renter_accounts').update(existing.id, {
        last_seen_at: new Date().toISOString(),
      });
    } catch {}
    return existing;
  }

  try {
    await db.from('renter_accounts').insert({
      email: normalized,
      last_seen_at: new Date().toISOString(),
    });
  } catch (insertError) {
    // Another tab/request may have inserted the unique email between our read
    // and write. Only suppress that error when the row now demonstrably exists.
    const concurrent = await findRenterAccount(db, normalized);
    if (concurrent) return concurrent;
    throw insertError;
  }

  // Re-read instead of depending on an insert response shape. A short retry
  // also covers the platform API returning before a newly inserted row is
  // visible to the shared query.
  for (const delayMs of [0, 150, 400]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const created = await findRenterAccount(db, normalized);
    if (created) return created;
  }

  throw new Error('We could not finish setting up your renter account.');
}

export interface AccountUnlockAccessRow {
  listing_id: number | null;
  area_key: string | null;
  address: string | null;
  unlock_type: 'free' | 'subscription' | string;
}

/** Read the current server-side unlock set before spending a free report. */
export async function fetchAccountUnlockAccess(email: string): Promise<AccountUnlockAccessRow[]> {
  const db = await getWorkspaceDb();
  const { data } = await db
    .from('account_unlocks', { shared: true })
    .eq('account_email', normalizeEmail(email))
    .limit(500)
    .get();
  return Array.isArray(data) ? data : [];
}

export async function recordUnlock(params: {
  email: string;
  /** null for an address/area report, which has no listing behind it. */
  listingId: number | null;
  listingTitle: string | null;
  areaKey: string | null;
  address: string | null;
  unlockType: 'free' | 'subscription';
}): Promise<void> {
  const db = await getWorkspaceDb();
  await db.from('account_unlocks').insert({
    account_email: params.email,
    listing_id: params.listingId,
    listing_title: params.listingTitle,
    area_key: params.areaKey,
    address: params.address,
    unlock_type: params.unlockType,
  });
}

/**
 * Save the renter's "where do you work" destination on their account row,
 * looked up by email (and created via ensureRenterAccount when missing) —
 * safe to call even before the account row has loaded into any hook. The
 * destination powers the report's Distance-to-work card: the commute
 * pipeline measures real routes to it, and the card stays gray until one
 * genuinely lands.
 */
export async function saveWorkDestination(email: string, destination: string): Promise<void> {
  try {
    const db = await getWorkspaceDb();
    const row = await ensureRenterAccount(email);
    await db.from('renter_accounts').update(row.id, {
      work_destination: destination.trim(),
      last_seen_at: new Date().toISOString(),
    });
  } catch {
    throw new Error('We could not save your workplace. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Subscription (Stripe via platform)
// ---------------------------------------------------------------------------

export async function fetchSubscriptionStatus(email: string): Promise<SubscriptionInfo> {
  const res = await fetch(
    `/api/space/${getSpaceId()}/subscription-status?email=${encodeURIComponent(email)}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('Could not check subscription status.');
  const data = await res.json();
  return {
    status: data.status || 'not_registered',
    cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
    currentPeriodEnd: data.currentPeriodEnd || null,
    subscriptionId: data.subscriptionId || null,
  };
}

/**
 * Start the monthly subscription checkout. The amount AND the currency both
 * come from subscriptionCharge() (apps/Veranda/types.ts) so the charge can
 * never drift from the "charged as …" line the renter just read.
 */
export async function startSubscriptionCheckout(email: string): Promise<string> {
  const charge = subscriptionCharge();
  const successUrl = `${window.location.origin}${window.location.pathname}?veranda_sub=success&session_id={CHECKOUT_SESSION_ID}`;
  const res = await fetch('/api/payments/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': getAppId() },
    body: JSON.stringify({
      priceCents: charge.priceCents,
      currency: charge.currency,
      interval: 'month',
      trialDays: 0, // the 5 free unlocks ARE the trial — no additional free period
      customerEmail: email,
      successUrl,
      cancelUrl: window.location.href,
      metadata: { purpose: 'veranda_report_subscription' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.checkoutUrl) throw new Error(data.error || 'Could not start checkout — please try again.');
  return data.checkoutUrl as string;
}

/** Check a Stripe checkout session directly (covers webhook lag on return). */
export async function checkStripeSessionPaid(stripeSessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/payments/status/${encodeURIComponent(stripeSessionId)}`, {
      headers: { 'X-App-Id': getAppId() },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.paymentStatus === 'paid' || data?.status === 'complete';
  } catch {
    return false;
  }
}

/**
 * Ask the platform to email a secure Stripe billing-portal link (manage /
 * cancel subscription). Falls back to the legacy direct-portal endpoint.
 * Returns a user-facing message when the link is emailed, or null when the
 * browser was redirected directly.
 */
export async function requestBillingPortal(email: string): Promise<string | null> {
  const appId = getAppId();
  const res = await fetch('/api/payments/portal/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': appId },
    body: JSON.stringify({ customerEmail: email }),
  });
  if (res.status === 404) {
    const legacy = await fetch('/api/payments/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': appId },
      body: JSON.stringify({
        customerEmail: email,
        returnUrl: window.location.origin + window.location.pathname,
      }),
    });
    const data = await legacy.json().catch(() => ({}));
    if (!legacy.ok || !data.url) throw new Error(data.error || 'Could not open subscription management.');
    window.location.href = data.url;
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not send the secure billing link.');
  return 'Check your inbox — we emailed you a secure link to manage or cancel your subscription.';
}

// ---------------------------------------------------------------------------
// Pending unlock (survives the Stripe checkout round-trip)
// ---------------------------------------------------------------------------

export function savePendingUnlock(p: Omit<PendingUnlock, 'savedAt'>): void {
  try {
    localStorage.setItem(PENDING_UNLOCK_KEY, JSON.stringify({ ...p, savedAt: Date.now() }));
  } catch {}
}

export function readPendingUnlock(): PendingUnlock | null {
  try {
    const raw = localStorage.getItem(PENDING_UNLOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingUnlock;
    // Stale after 45 minutes — a checkout round-trip never takes that long.
    if (!parsed.savedAt || Date.now() - parsed.savedAt > 45 * 60 * 1000) {
      clearPendingUnlock();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingUnlock(): void {
  try {
    localStorage.removeItem(PENDING_UNLOCK_KEY);
  } catch {}
}
