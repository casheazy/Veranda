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
    // shared: true — row updates are session-scoped by default, and the row
    // may have been created in another browser session (another device).
    try {
      await db.from('renter_accounts', { shared: true }).update(existing.id, {
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

// ---------------------------------------------------------------------------
// Commute destinations — labelled, up to MAX_COMMUTE_DESTINATIONS per account
//
// The commute card is not workplace-only: a destination is ANY place the
// renter goes often (office, school, market, church, family), saved with a
// short label the renter chooses ("Work", "School", "Mum's place").
//
// STORAGE (renter_destinations table, INSERT-ONLY snapshots):
// WorkspaceDB row updates are session-scoped — an `update()` fired from a
// browser session other than the one that created the row silently matches
// nothing. That is exactly how the original renter_accounts.work_destination
// save broke for renters returning on a new device/session: the update
// missed, the read-back verification saw the old value, and the renter got
// "We could not save your workplace." Snapshots dodge the problem entirely:
// every save INSERTS a new row holding the full destinations array +
// active_index, and readers take the newest row per account_email (shared
// read), so the latest snapshot wins from any device. Superseded rows are
// pruned best-effort and are harmless when pruning is skipped.
// ---------------------------------------------------------------------------

export interface CommuteDestination {
  /** Short renter-chosen label, e.g. "Work", "School", "Mum's place". */
  label: string;
  /** The address or area the renter commutes to. */
  address: string;
}

export interface DestinationState {
  destinations: CommuteDestination[];
  /** Index of the destination currently shown on report commute cards. */
  activeIndex: number;
}

export const MAX_COMMUTE_DESTINATIONS = 3;

/** Row shape of the insert-only `renter_destinations` snapshot table. */
export interface RenterDestinationRow {
  id: number;
  account_email: string;
  destinations?: CommuteDestination[] | string | null;
  active_index?: number | null;
  created_at?: string;
}

function cleanDestination(dest: CommuteDestination): CommuteDestination {
  return {
    label: (dest.label || '').trim().replace(/\s+/g, ' '),
    address: (dest.address || '').trim().replace(/\s+/g, ' '),
  };
}

/** Parse a snapshot row. Returns null for a missing or unreadable row. */
export function parseDestinationRow(
  row: RenterDestinationRow | null | undefined
): DestinationState | null {
  if (!row) return null;
  let raw: unknown = row.destinations;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const list = Array.isArray(raw)
    ? (raw as CommuteDestination[])
        .filter((d) => !!d && typeof d.address === 'string')
        .map(cleanDestination)
        .filter((d) => d.address.length > 0)
        .slice(0, MAX_COMMUTE_DESTINATIONS)
    : [];
  const activeIndex = Math.min(
    Math.max(Number(row.active_index) || 0, 0),
    Math.max(list.length - 1, 0)
  );
  return { destinations: list, activeIndex };
}

/**
 * Wrap a legacy renter_accounts.work_destination value as a single "Work"
 * destination, so accounts from before the snapshot table still see their
 * saved workplace. The first snapshot save takes over from there.
 */
export function destinationStateFromLegacy(
  workDestination?: string | null
): DestinationState | null {
  const address = (workDestination || '').trim();
  if (!address) return null;
  return { destinations: [{ label: 'Work', address }], activeIndex: 0 };
}

function validateDestinationState(state: DestinationState): DestinationState {
  const destinations = state.destinations.map(cleanDestination);
  if (destinations.length > MAX_COMMUTE_DESTINATIONS) {
    throw new Error(
      `You can save up to ${MAX_COMMUTE_DESTINATIONS} destinations — remove one before adding another.`
    );
  }
  for (const dest of destinations) {
    if (dest.label.length < 1 || dest.label.length > 40) {
      throw new Error(
        "Give the destination a short label (1–40 characters) — e.g. Work, School or Mum's place."
      );
    }
    if (dest.address.length < 3 || dest.address.length > 160) {
      throw new Error(
        'That address looks too short — enter the address or area, e.g. "Marina, Lagos Island".'
      );
    }
  }
  const activeIndex = Math.min(
    Math.max(state.activeIndex, 0),
    Math.max(destinations.length - 1, 0)
  );
  return { destinations, activeIndex };
}

function sameDestinationState(a: DestinationState, b: DestinationState): boolean {
  return (
    a.activeIndex === b.activeIndex &&
    a.destinations.length === b.destinations.length &&
    a.destinations.every(
      (d, i) => d.label === b.destinations[i].label && d.address === b.destinations[i].address
    )
  );
}

async function fetchLatestDestinationRow(
  db: any,
  email: string
): Promise<RenterDestinationRow | null> {
  const { data } = await db
    .from('renter_destinations', { shared: true })
    .eq('account_email', normalizeEmail(email))
    .orderBy('id', 'desc')
    .limit(1)
    .get();
  return (data && data[0]) || null;
}

/** Read the saved destinations (falling back to the legacy work_destination). */
export async function fetchDestinationState(email: string): Promise<DestinationState | null> {
  const db = await getWorkspaceDb();
  const parsed = parseDestinationRow(await fetchLatestDestinationRow(db, email));
  if (parsed) return parsed;
  const account = await findRenterAccount(db, email);
  return destinationStateFromLegacy(account?.work_destination);
}

/**
 * Persist the account's destinations by INSERTING a new snapshot row (see the
 * section comment above for why updates are never used). The save is verified
 * by reading the snapshot back before success is reported, and every failure
 * path throws a message that says what actually went wrong.
 */
export async function saveDestinationState(email: string, state: DestinationState): Promise<void> {
  const clean = validateDestinationState(state);
  let db: any;
  try {
    db = await getWorkspaceDb();
  } catch {
    throw new Error('The data connection is still starting up — give it a second and try again.');
  }
  const normalized = normalizeEmail(email);

  let previousId = 0;
  try {
    previousId = (await fetchLatestDestinationRow(db, normalized))?.id || 0;
  } catch {
    /* read-before-write is best-effort */
  }

  try {
    // `destinations` is a JSON column, so the value MUST be pre-serialised
    // with JSON.stringify. Passing the raw JS array made the platform bind it
    // as a Postgres ARRAY literal ({"..."}), which the json column rejects
    // with "invalid input syntax for type json" — the exact save failure
    // renters hit. A JSON string is accepted, and parseDestinationRow()
    // handles reading the column back as either a string or a parsed array.
    // { shared: true } puts the snapshot in the shared pool (session_id =
    // NULL), matching the shared reads below and letting the best-effort
    // pruning delete superseded rows from any device/session.
    await db.from('renter_destinations', { shared: true }).insert({
      account_email: normalized,
      destinations: JSON.stringify(clean.destinations),
      active_index: clean.activeIndex,
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    throw new Error(
      `Your destination could not be written to your renter profile${detail}. Check your connection and try again.`
    );
  }

  // Verify the snapshot actually landed — this row is what every report (on
  // any device) reads, so a save is only a save once it is readable.
  let confirmed = false;
  for (const delayMs of [0, 150, 400]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const row = await fetchLatestDestinationRow(db, normalized);
    if (row && row.id !== previousId) {
      const saved = parseDestinationRow(row);
      if (saved && sameDestinationState(saved, clean)) {
        confirmed = true;
        break;
      }
    }
  }
  if (!confirmed) {
    throw new Error(
      'The save was sent but could not be confirmed in your renter profile, so it may not have persisted. Please try again.'
    );
  }

  // Best-effort extras — never fail a confirmed save over them:
  // 1 · mirror the active address into the legacy renter_accounts column so
  //     anything still reading work_destination stays coherent;
  // 2 · prune superseded snapshot rows (snapshots insert shared, so shared
  //     deletes can remove them from any session; any legacy session-tagged
  //     row that refuses to delete sits harmlessly behind the newest row).
  try {
    const account = await ensureRenterAccount(normalized);
    await db.from('renter_accounts', { shared: true }).update(account.id, {
      work_destination: clean.destinations[clean.activeIndex]?.address || null,
      last_seen_at: new Date().toISOString(),
    });
  } catch {
    /* legacy mirror only */
  }
  try {
    const { data } = await db
      .from('renter_destinations', { shared: true })
      .eq('account_email', normalized)
      .orderBy('id', 'desc')
      .limit(25)
      .get();
    const rows: RenterDestinationRow[] = Array.isArray(data) ? data : [];
    const newestId = rows[0]?.id || 0;
    for (const row of rows) {
      if (row.id === newestId) continue;
      try {
        await db.from('renter_destinations', { shared: true }).delete(row.id);
      } catch {
        /* cross-session rows won't delete — fine */
      }
    }
  } catch {
    /* pruning is optional */
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
