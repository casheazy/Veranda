/**
 * Veranda — find, verify and settle into a Lagos home.
 *
 * Two ways in, one report:
 * - VERIFY AN ADDRESS — the renter types the address or area they are about to
 *   pay rent on and gets all five dimensions. Flood, power and network use
 *   area lookups; commute and security stay visibly neutral until measured or
 *   listing-specific data is available. No listing needed.
 * - BROWSE LISTINGS — the aggregated catalog, where opening a home shows the
 *   same five-card report with listing-specific commute and amenities.
 * Tenants grow the crowd layer through the submit-a-report flow, reachable
 * from the nav, the landing page and inside every report.
 *
 * Freemium flows (2026-08 rebuild):
 * - Landing + search + listing browsing are free and unlimited — never gated.
 * - Opening a listing shows photos/info plus a locked verification report.
 * - Unlocking a report needs only an email (lightweight account, one-time
 *   code, no password). Every account gets FREE_UNLOCK_LIMIT lifetime free
 *   unlocks, tracked per account in the account_unlocks table.
 * - After the free unlocks, a monthly subscription (Stripe) unlocks reports
 *   one-click with no counter shown.
 *
 * The listings catalog, scraping pipeline and NormalizedListing schema are
 * untouched — this app reads the same `listings` / `area_profiles` /
 * `tenant_reports` tables the ingestion layer maintains.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  ShieldCheck,
  UserRound,
  ArrowRight,
  Droplets,
  Eye,
  PlusCircle,
  Ticket,
  Wallet,
  Zap,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';
import {
  AREAS,
  AreaKey,
  AreaProfile,
  AccountUnlock,
  BUDGET_PRESETS,
  BudgetRange,
  FREE_UNLOCK_LIMIT,
  Listing,
  RenterAccount,
  SUBSCRIPTION_PRICE_NGN,
  TenantReport,
  areaName,
  budgetAnnualLabel,
  budgetMonthlyLabel,
  budgetRangeLabel,
  detectAreaKey,
  monthlyFromAnnual,
  naira,
  rentInBudget,
} from './types';
import { ensureAreaProfilesSeeded, ensureTenantReportsSeeded } from './seedData';
import {
  CommuteDestination,
  DestinationState,
  RenterDestinationRow,
  SubscriptionInfo,
  checkStripeSessionPaid,
  clearPendingUnlock,
  clearStoredSession,
  destinationStateFromLegacy,
  ensureRenterAccount,
  fetchAccountUnlockAccess,
  fetchSubscriptionStatus,
  isSubscriptionActive,
  normalizeEmail,
  parseDestinationRow,
  readPendingUnlock,
  readStoredSession,
  recordUnlock,
  saveDestinationState,
} from './account';
import { ListingCard, ListingCardSkeleton, cleanScrapedText, rentValue } from './listingDisplay';
import ListingDetail from './ListingDetail';
import AreaReport from './AreaReport';
import SubmitReport from './SubmitReport';
import SampleReport, { SAMPLE_AREA_KEY } from './SampleReport';
import AccountPage from './AccountPage';
import AdminDashboard from './AdminDashboard';

const HERO_IMAGE_URL =
  'https://storage.googleapis.com/audos-images/generated-images/agent/workspace-812590/img-1785716590484-tjvxme.png';

const POPULAR_AREAS: AreaKey[] = ['lekki', 'ajah', 'yaba', 'surulere', 'ikeja', 'victoria-island'];

type View = 'home' | 'browse' | 'verify' | 'submit' | 'account' | 'admin' | 'sample';

interface AreaReportTarget {
  areaKey: AreaKey;
  /** Exactly what the renter typed, so the report echoes it back to them. */
  address: string;
}

function listingMatchesKeyword(l: Listing, kw: string): boolean {
  if (!kw) return true;
  const hay = [l.title, l.description, l.neighborhood, l.address, l.property_type, areaName(l.area_key)]
    .filter(Boolean)
    .join(' • ')
    .toLowerCase();
  return kw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

export default function VerandaApp() {
  const { mode } = useSpaceRuntime();
  const isEntrepreneur = mode === 'entrepreneur';

  // ---------------- account state ----------------
  const [accountEmail, setAccountEmail] = useState<string | null>(() => {
    const stored = readStoredSession();
    return stored?.email ? normalizeEmail(stored.email) : null;
  });
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [accountRetryNonce, setAccountRetryNonce] = useState(0);
  // Set when we've just confirmed a paid checkout session directly with
  // Stripe but the subscription-status endpoint hasn't caught up yet.
  const [subOverride, setSubOverride] = useState(false);

  const subscribed = isSubscriptionActive(subInfo) || subOverride;

  const refreshSub = async (email: string | null) => {
    if (!email) {
      setSubInfo(null);
      setSubError(null);
      return;
    }
    setSubLoading(true);
    setSubError(null);
    try {
      // A just-restored session can race the platform route warming up. Retry
      // short transient failures before surfacing a non-blocking sync notice.
      let latest: SubscriptionInfo | null = null;
      let lastError: unknown = null;
      for (const delayMs of [0, 200, 600]) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        try {
          latest = await fetchSubscriptionStatus(email);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!latest) throw lastError;
      setSubInfo(latest);
    } catch {
      // Keep the previous value, but never silently treat a failed status read
      // as a canceled subscription or invite a duplicate checkout.
      setSubError('Your subscription status could not be refreshed.');
    } finally {
      setSubLoading(false);
    }
  };

  useEffect(() => {
    refreshSub(accountEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountEmail]);

  // ---------------- navigation + browse state ----------------
  const [view, setView] = useState<View>('home');
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [areaReport, setAreaReport] = useState<AreaReportTarget | null>(null);
  const [submitPreset, setSubmitPreset] = useState<AreaKey | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  // Set when a subscription checkout returns to an address report that still
  // needs its unlock row written, once the account data has loaded back in.
  const [pendingAreaUnlock, setPendingAreaUnlock] = useState<AreaReportTarget | null>(null);
  const [areaFilter, setAreaFilter] = useState<AreaKey | null>(null);
  const [keyword, setKeyword] = useState('');
  const [homeQuery, setHomeQuery] = useState('');
  const [bedrooms, setBedrooms] = useState(-1);
  const [budget, setBudget] = useState<BudgetRange | null>(null);

  // Area and budget are resolved server-side. The catalog holds far more homes
  // than one page, so a price cut applied only to the loaded rows would search
  // the newest 100 listings instead of the whole of Lagos.
  const listingFilters = useMemo(() => {
    const filters: Array<{ column: string; operator: string; value: unknown }> = [];
    if (areaFilter) filters.push({ column: 'area_key', operator: 'eq', value: areaFilter });
    if (budget) {
      // A listing with no price can't be budget-checked, so the floor is never 0.
      filters.push({ column: 'rent_year_ngn', operator: 'gte', value: Math.max(budget.min, 1) });
      if (budget.max != null) {
        filters.push({ column: 'rent_year_ngn', operator: 'lte', value: budget.max });
      }
    }
    return filters.length ? filters : undefined;
  }, [areaFilter, budget]);

  // ---------------- data hooks ----------------
  const listingsHook = window.useWorkspaceDB<Listing>('listings', {
    shared: true,
    limit: 100,
    orderBy: { column: 'created_at', direction: 'desc' },
    filters: listingFilters,
  });
  const profilesHook = window.useWorkspaceDB<AreaProfile>('area_profiles', {
    shared: true,
    limit: 50,
  });
  const reportsHook = window.useWorkspaceDB<TenantReport>('tenant_reports', {
    shared: true,
    limit: 100,
    orderBy: { column: 'created_at', direction: 'desc' },
  });
  const unlocksHook = window.useWorkspaceDB<AccountUnlock>('account_unlocks', {
    shared: true,
    limit: 100,
    orderBy: { column: 'created_at', direction: 'desc' },
    filters: [{ column: 'account_email', operator: 'eq', value: accountEmail || '__nobody__' }],
  });
  const accountRowHook = window.useWorkspaceDB<RenterAccount>('renter_accounts', {
    shared: true,
    limit: 1,
    filters: [{ column: 'email', operator: 'eq', value: accountEmail || '__nobody__' }],
  });
  // Newest commute-destinations snapshot for this account. The table is
  // INSERT-ONLY (see account.ts): the latest row per email is the truth, so
  // one ordered row is all the app ever needs.
  const destinationRowsHook = window.useWorkspaceDB<RenterDestinationRow>('renter_destinations', {
    shared: true,
    limit: 1,
    orderBy: { column: 'id', direction: 'desc' },
    filters: [{ column: 'account_email', operator: 'eq', value: accountEmail || '__nobody__' }],
  });

  // Persisted sessions from before renter_accounts was introduced may be
  // valid but have no profile row. Provision those accounts on every fresh
  // load (idempotently) instead of waiting for a workplace save to discover
  // the missing row.
  useEffect(() => {
    if (!accountEmail) return;
    let cancelled = false;
    void ensureRenterAccount(accountEmail)
      .then(() => {
        if (!cancelled) accountRowHook.refresh();
      })
      .catch(() => {
        // Preferences are optional personalization. Saving a workplace has its
        // own retry UI; profile provisioning must not block report access.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountEmail, accountRetryNonce]);

  // Renter preferences are optional report personalization. Their profile row
  // must never block a signed-in renter from generating a verification report.
  // Only unlock history and subscription status affect access decisions.
  const accountAccessError =
    (unlocksHook.error ? 'Your report history could not be refreshed.' : null) || subError;

  const retryAccountLoad = () => {
    setSubError(null);
    setAccountRetryNonce((value) => value + 1);
    accountRowHook.refresh();
    destinationRowsHook.refresh();
    unlocksHook.refresh();
    void refreshSub(accountEmail);
  };

  // Loads a single listing by id when it isn't in the current browse page
  // (returning from Stripe checkout, or opening from unlock history).
  const [loadRequest, setLoadRequest] = useState<{ id: number; autoUnlock: boolean } | null>(null);
  const singleListingHook = window.useWorkspaceDB<Listing>('listings', {
    shared: true,
    limit: 1,
    filters: [{ column: 'id', operator: 'eq', value: loadRequest?.id ?? -1 }],
  });

  const unlocks = unlocksHook.data || [];
  const freeUsed = useMemo(() => unlocks.filter((u) => u.unlock_type === 'free').length, [unlocks]);
  const isUnlocked = (l: Listing) => unlocks.some((u) => u.listing_id === l.id);

  /** Address reports have no listing_id — they are keyed by area + typed address. */
  const isAreaUnlocked = (key: string, address: string) =>
    unlocks.some(
      (u) =>
        u.listing_id == null &&
        u.area_key === key &&
        (u.address || '').trim().toLowerCase() === address.trim().toLowerCase()
    );

  const profileFor = (key: string | null | undefined): AreaProfile | undefined =>
    (profilesHook.data || []).find((p) => p.area_key === key);

  // ---------------- one-time seeding of launch-area verification profiles ----------------
  const seedRanRef = useRef(false);
  useEffect(() => {
    if (seedRanRef.current) return;
    if (profilesHook.loading || profilesHook.error) return;
    seedRanRef.current = true;
    if (profilesHook.total === 0) {
      ensureAreaProfilesSeeded().then((inserted) => {
        if (inserted) profilesHook.refresh();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilesHook.loading]);

  // ---------------- one-time seeding of the launch tenant-report examples ----------------
  const tenantSeedRanRef = useRef(false);
  useEffect(() => {
    if (tenantSeedRanRef.current) return;
    if (reportsHook.loading || reportsHook.error) return;
    tenantSeedRanRef.current = true;
    if (reportsHook.total === 0) {
      ensureTenantReportsSeeded().then((inserted) => {
        if (inserted) reportsHook.refresh();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsHook.loading]);

  // ---------------- return from Stripe subscription checkout ----------------
  const checkoutHandledRef = useRef(false);
  useEffect(() => {
    if (checkoutHandledRef.current) return;
    checkoutHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('veranda_sub') !== 'success') return;
    const stripeSessionId = params.get('session_id');
    // Tidy the URL so refreshes don't re-trigger.
    try {
      params.delete('veranda_sub');
      params.delete('session_id');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    } catch {}
    (async () => {
      if (stripeSessionId && (await checkStripeSessionPaid(stripeSessionId))) {
        setSubOverride(true);
      }
      await refreshSub(accountEmail);
      const pending = readPendingUnlock();
      if (pending && (pending.kind === 'area' || pending.listingId == null)) {
        const target: AreaReportTarget = {
          areaKey: pending.areaKey as AreaKey,
          address: pending.address,
        };
        clearPendingUnlock();
        setAreaReport(target);
        setPendingAreaUnlock(target);
        setView('verify');
      } else if (pending) {
        setView('browse');
        setLoadRequest({ id: pending.listingId as number, autoUnlock: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Complete a pending load request once the row arrives.
  useEffect(() => {
    if (!loadRequest || singleListingHook.loading) return;
    const row = (singleListingHook.data || []).find((l) => l.id === loadRequest.id);
    if (!row) return;
    const finish = async () => {
      if (
        loadRequest.autoUnlock &&
        accountEmail &&
        !unlocks.some((u) => u.listing_id === row.id)
      ) {
        try {
          await recordUnlock({
            email: accountEmail,
            listingId: row.id,
            listingTitle: cleanScrapedText(row.title) || row.address || null,
            areaKey: row.area_key || null,
            address: row.address || row.title || null,
            unlockType: 'subscription',
          });
          unlocksHook.refresh();
        } catch {
          /* the gate will offer unlock again */
        }
      }
      clearPendingUnlock();
      setDetailListing(row);
      setView('browse');
      setLoadRequest(null);
    };
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest, singleListingHook.loading, singleListingHook.data, accountEmail]);

  // ---------------- actions ----------------
  const handleSignedIn = (email: string) => {
    setAccountEmail(email);
  };

  const handleSignOut = () => {
    clearStoredSession();
    setAccountEmail(null);
    setSubInfo(null);
    setSubError(null);
    setSubOverride(false);
  };

  const resolveFreshAccess = async () => {
    if (!accountEmail) throw new Error('Enter your email first.');
    const currentUnlocks = await fetchAccountUnlockAccess(accountEmail);
    const currentFreeUsed = currentUnlocks.filter((unlock) => unlock.unlock_type === 'free').length;
    if (currentFreeUsed < FREE_UNLOCK_LIMIT) {
      return { currentUnlocks, unlockType: 'free' as const };
    }
    if (subscribed) return { currentUnlocks, unlockType: 'subscription' as const };

    // The UI keeps the previous status during a transient refresh failure. Do
    // one authoritative check at click time before denying a paid subscriber.
    const latestSub = await fetchSubscriptionStatus(accountEmail);
    setSubInfo(latestSub);
    setSubError(null);
    if (isSubscriptionActive(latestSub)) {
      return { currentUnlocks, unlockType: 'subscription' as const };
    }
    return { currentUnlocks, unlockType: null };
  };

  const handleUnlock = async (listing: Listing) => {
    if (!accountEmail) throw new Error('Enter your email first.');
    const { currentUnlocks, unlockType } = await resolveFreshAccess();
    if (currentUnlocks.some((unlock) => unlock.listing_id === listing.id)) {
      unlocksHook.refresh();
      return;
    }
    if (!unlockType) throw new Error('No free reports left — subscribe to keep unlocking.');
    await recordUnlock({
      email: accountEmail,
      listingId: listing.id,
      listingTitle: cleanScrapedText(listing.title) || listing.address || null,
      areaKey: listing.area_key || null,
      address: listing.address || listing.title || null,
      unlockType,
    });
    unlocksHook.refresh();
  };

  const recordAreaUnlock = async (
    key: AreaKey,
    address: string,
    unlockType: 'free' | 'subscription'
  ) => {
    if (!accountEmail) throw new Error('Enter your email first.');
    await recordUnlock({
      email: accountEmail,
      listingId: null,
      listingTitle: address,
      areaKey: key,
      address,
      unlockType,
    });
    unlocksHook.refresh();
  };

  const handleUnlockArea = async () => {
    if (!areaReport || !accountEmail) return;
    const { currentUnlocks, unlockType } = await resolveFreshAccess();
    const normalizedAddress = areaReport.address.trim().toLowerCase();
    if (
      currentUnlocks.some(
        (unlock) =>
          unlock.listing_id == null &&
          unlock.area_key === areaReport.areaKey &&
          (unlock.address || '').trim().toLowerCase() === normalizedAddress
      )
    ) {
      unlocksHook.refresh();
      return;
    }
    if (!unlockType) throw new Error('No free reports left — subscribe to keep unlocking.');
    await recordAreaUnlock(areaReport.areaKey, areaReport.address, unlockType);
  };

  // Finish an address-report unlock that was interrupted by Stripe checkout.
  useEffect(() => {
    if (!pendingAreaUnlock || !accountEmail || unlocksHook.loading) return;
    const { areaKey: key, address } = pendingAreaUnlock;
    setPendingAreaUnlock(null);
    if (isAreaUnlocked(key, address)) return;
    recordAreaUnlock(key, address, 'subscription').catch(() => {
      /* the gate stays up and offers the unlock again */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAreaUnlock, accountEmail, unlocksHook.loading]);

  // ---------------- commute destinations (labelled, up to 3) ----------------
  // Optimistic copy of the last saved state so the commute card flips the
  // moment a save is confirmed; the hook refresh catches up behind it. Reset
  // whenever the signed-in account changes.
  const [localDestinationState, setLocalDestinationState] = useState<DestinationState | null>(null);
  useEffect(() => {
    setLocalDestinationState(null);
  }, [accountEmail]);

  const destinationState: DestinationState = localDestinationState ??
    parseDestinationRow((destinationRowsHook.data || [])[0]) ??
    destinationStateFromLegacy((accountRowHook.data || [])[0]?.work_destination) ?? {
      destinations: [],
      activeIndex: 0,
    };
  const destinations = destinationState.destinations;
  const activeDestinationIndex = Math.min(
    Math.max(destinationState.activeIndex, 0),
    Math.max(destinations.length - 1, 0)
  );
  const workDestination = destinations[activeDestinationIndex]?.address || null;

  const persistDestinations = async (state: DestinationState) => {
    if (!accountEmail) throw new Error('Sign in first to save a destination.');
    await saveDestinationState(accountEmail, state);
    setLocalDestinationState(state);
    destinationRowsHook.refresh();
    accountRowHook.refresh();
  };

  /** index null appends (and activates) a destination; a number replaces it. */
  const handleSaveDestination = async (dest: CommuteDestination, index: number | null) => {
    const next = destinations.slice();
    let activeIndex: number;
    if (index == null) {
      next.push(dest);
      activeIndex = next.length - 1;
    } else {
      activeIndex = Math.min(Math.max(index, 0), Math.max(next.length - 1, 0));
      next[activeIndex] = dest;
    }
    await persistDestinations({ destinations: next, activeIndex });
  };

  const handleSelectDestination = async (index: number) => {
    if (index === activeDestinationIndex || !destinations[index]) return;
    await persistDestinations({ destinations, activeIndex: index });
  };

  const handleDeleteDestination = async (index: number) => {
    if (!destinations[index]) return;
    const next = destinations.filter((_, i) => i !== index);
    const activeIndex =
      activeDestinationIndex > index
        ? activeDestinationIndex - 1
        : Math.min(activeDestinationIndex, Math.max(next.length - 1, 0));
    await persistDestinations({ destinations: next, activeIndex });
  };

  const openFromHistory = (u: AccountUnlock) => {
    if (u.listing_id == null) {
      if (u.area_key && u.address) openAreaReport(u.area_key as AreaKey, u.address);
      return;
    }
    const loaded = (listingsHook.data || []).find((l) => l.id === u.listing_id);
    if (loaded) {
      setDetailListing(loaded);
      setView('browse');
    } else {
      setView('browse');
      setLoadRequest({ id: u.listing_id, autoUnlock: false });
    }
  };

  const openAreaReport = (key: AreaKey, address: string) => {
    setDetailListing(null);
    setSearchNotice(null);
    setAreaReport({ areaKey: key, address });
    setView('verify');
  };

  const openSubmitReport = (key?: AreaKey | null) => {
    setDetailListing(null);
    setSubmitPreset(key || null);
    setView('submit');
  };

  /** Free search — the address goes straight to its (gated) verification report. */
  const verifyFromHome = () => {
    const q = homeQuery.trim();
    if (!q) return;
    const detected = detectAreaKey(q);
    if (!detected) {
      setSearchNotice(
        `We don't verify that address yet — Veranda covers ${AREAS.length} Lagos areas so far. Try the area or a landmark near it (Lekki, Surulere, Magodo, Yaba…), or browse listings below.`
      );
      return;
    }
    openAreaReport(detected, q);
  };

  const startBrowseFromHome = () => {
    const q = homeQuery.trim();
    const detected = q ? detectAreaKey(q) : null;
    if (detected) {
      setAreaFilter(detected);
      setKeyword('');
    } else {
      setKeyword(q);
    }
    setDetailListing(null);
    setSearchNotice(null);
    setView('browse');
  };

  const goView = (v: View) => {
    setDetailListing(null);
    if (v !== 'verify') setAreaReport(null);
    setView(v);
  };

  // The unified shell header (Desktop.tsx) renders the Veranda logo as a
  // dropdown-menu trigger; its items navigate this app by dispatching the
  // `audos:app-navigate` window event with a target view.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const target = (e as CustomEvent).detail?.target as View | undefined;
      if (target !== 'home' && target !== 'browse' && target !== 'submit' && target !== 'account') {
        return;
      }
      setDetailListing(null);
      setAreaReport(null);
      if (target === 'submit') setSubmitPreset(null);
      setView(target);
    };
    window.addEventListener('audos:app-navigate', onNavigate);
    return () => window.removeEventListener('audos:app-navigate', onNavigate);
  }, []);

  // The Verify tab owns the search landing, the report it opens and the
  // public sample report reached from the landing page.
  const isTabActive = (tab: View) =>
    tab === 'home' ? view === 'home' || view === 'verify' || view === 'sample' : view === tab;

  // ---------------- browse results ----------------
  const results = useMemo(() => {
    return (listingsHook.data || [])
      .filter((l) => (l.status || 'active') === 'active')
      .filter((l) => listingMatchesKeyword(l, keyword.trim()))
      .filter((l) => (bedrooms < 0 ? true : (l.bedrooms ?? 0) >= bedrooms))
      // The same cut the query already made, so results never disagree with the
      // selected budget while a refetch is in flight.
      .filter((l) => rentInBudget(rentValue(l), budget));
  }, [listingsHook.data, keyword, bedrooms, budget]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // NOTE: the space shell (Desktop.tsx) renders the ONE unified header above
  // this app — the Veranda logo there doubles as a dropdown-menu trigger that
  // navigates here via the `audos:app-navigate` event. The app itself must
  // NOT render a second brand bar (that showed as a duplicated/stacked
  // header). Sign-in and quick navigation live in the bottom tab bar.
  return (
    <div className="min-h-full flex flex-col w-full bg-transparent">
      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pt-4">
        {detailListing ? (
          <ListingDetail
            listing={detailListing}
            profile={profileFor(detailListing.area_key)}
            reports={reportsHook.data || []}
            accountEmail={accountEmail}
            unlocked={isUnlocked(detailListing)}
            freeUsed={freeUsed}
            subscribed={subscribed}
            accountLoading={unlocksHook.loading || subLoading}
            accountError={accountAccessError}
            onRetryAccount={retryAccountLoad}
            workDestination={workDestination}
            destinations={destinations}
            activeDestinationIndex={activeDestinationIndex}
            onSaveDestination={accountEmail ? handleSaveDestination : undefined}
            onSelectDestination={accountEmail ? handleSelectDestination : undefined}
            onBack={() => setDetailListing(null)}
            onSignedIn={handleSignedIn}
            onUnlock={handleUnlock}
            onSubmitReport={(key) => openSubmitReport(key)}
          />
        ) : view === 'verify' && areaReport ? (
          <AreaReport
            areaKey={areaReport.areaKey}
            address={areaReport.address}
            profile={profileFor(areaReport.areaKey)}
            reports={reportsHook.data || []}
            accountEmail={accountEmail}
            unlocked={isAreaUnlocked(areaReport.areaKey, areaReport.address)}
            freeUsed={freeUsed}
            subscribed={subscribed}
            accountLoading={unlocksHook.loading || subLoading}
            accountError={accountAccessError}
            onRetryAccount={retryAccountLoad}
            workDestination={workDestination}
            destinations={destinations}
            activeDestinationIndex={activeDestinationIndex}
            onSaveDestination={accountEmail ? handleSaveDestination : undefined}
            onSelectDestination={accountEmail ? handleSelectDestination : undefined}
            onBack={() => goView('home')}
            onSignedIn={handleSignedIn}
            onUnlock={handleUnlockArea}
            onSubmitReport={() => openSubmitReport(areaReport.areaKey)}
          />
        ) : view === 'submit' ? (
          <SubmitReport presetAreaKey={submitPreset} onSubmitted={() => reportsHook.refresh()} />
        ) : view === 'sample' ? (
          <SampleReport
            profile={profileFor(SAMPLE_AREA_KEY)}
            reports={reportsHook.data || []}
            onBack={() => goView('home')}
            onGetYours={() => goView('home')}
          />
        ) : view === 'home' ? (
          <LandingView
            query={homeQuery}
            onQueryChange={setHomeQuery}
            notice={searchNotice}
            onVerify={verifyFromHome}
            onPickArea={(key) => openAreaReport(key, areaName(key))}
            onBrowseAll={() => {
              setAreaFilter(null);
              setKeyword('');
              setSearchNotice(null);
              setView('browse');
            }}
            onSubmitReport={() => openSubmitReport(null)}
            onSeeSample={() => goView('sample')}
          />
        ) : view === 'account' ? (
          <AccountPage
            accountEmail={accountEmail}
            unlocks={unlocks}
            unlocksLoading={unlocksHook.loading}
            subInfo={subInfo}
            subLoading={subLoading}
            accountError={accountAccessError}
            onRetryAccount={retryAccountLoad}
            isEntrepreneur={isEntrepreneur}
            destinations={destinations}
            activeDestinationIndex={activeDestinationIndex}
            onSaveDestination={accountEmail ? handleSaveDestination : undefined}
            onSelectDestination={accountEmail ? handleSelectDestination : undefined}
            onDeleteDestination={accountEmail ? handleDeleteDestination : undefined}
            onSignedIn={handleSignedIn}
            onSignOut={handleSignOut}
            onOpenUnlock={openFromHistory}
            onOpenAdmin={() => setView('admin')}
          />
        ) : view === 'admin' ? (
          <AdminDashboard isEntrepreneur={isEntrepreneur} onBack={() => setView('account')} />
        ) : (
          <BrowseView
            loading={listingsHook.loading || (loadRequest != null && singleListingHook.loading)}
            results={results}
            areaFilter={areaFilter}
            keyword={keyword}
            bedrooms={bedrooms}
            budget={budget}
            onAreaFilter={setAreaFilter}
            onKeyword={setKeyword}
            onBedrooms={setBedrooms}
            onBudget={setBudget}
            onOpen={(l) => setDetailListing(l)}
          />
        )}
      </div>

      {/* Bottom navigation */}
      {/* Contrast spec: active tab terracotta (--space-brand-primary =
          #C25733) + semibold; inactive tabs a muted warm gray (#A89080) —
          distinct but not harsh; solid cream bar (--space-surface-page =
          #FAF7F2) with a top border + soft shadow lifting it off content. */}
      {!detailListing && view !== 'admin' && (
        <div className="shrink-0 sticky bottom-0 border-t border-[var(--space-border-strong)] bg-[var(--space-surface-page)] shadow-[0_-4px_12px_rgba(45,31,22,0.08)]">
          <div className="grid grid-cols-4">
            {[
              { key: 'home' as View, label: 'Verify', icon: ShieldCheck },
              { key: 'browse' as View, label: 'Browse', icon: Search },
              { key: 'submit' as View, label: 'Report', icon: PlusCircle },
              { key: 'account' as View, label: 'Account', icon: UserRound },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => goView(key)}
                className={`py-2.5 flex flex-col items-center gap-0.5 text-[11px] transition-colors ${
                  isTabActive(key)
                    ? 'text-[var(--space-brand-primary)] font-semibold'
                    : 'text-[#A89080] font-medium hover:text-[var(--space-text-secondary)]'
                }`}
                data-testid={`tab-${key}`}
              >
                <Icon className="w-5 h-5" strokeWidth={isTabActive(key) ? 2.4 : 2} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Landing — free address search first, listings and report submission second
// ---------------------------------------------------------------------------

function LandingView({
  query,
  onQueryChange,
  notice,
  onVerify,
  onPickArea,
  onBrowseAll,
  onSubmitReport,
  onSeeSample,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  notice: string | null;
  onVerify: () => void;
  onPickArea: (key: AreaKey) => void;
  onBrowseAll: () => void;
  onSubmitReport: () => void;
  onSeeSample: () => void;
}) {
  return (
    <div className="pb-6 max-w-2xl mx-auto">
      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden border border-[var(--space-border-default)]">
        <img
          src={HERO_IMAGE_URL}
          alt="Warm illustration of a Lagos residential street"
          className="w-full h-44 sm:h-56 object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <h1 className="text-white text-xl sm:text-2xl font-bold leading-snug drop-shadow">
            Check the address before you hand over the rent.
          </h1>
          <p className="text-white/85 text-xs sm:text-sm mt-1 drop-shadow">
            Type any Lagos address or area to check flood, power, network, security and your commute
            — before you pay, not the July after.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mt-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${tw.icon.muted}`} />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onVerify()}
              placeholder="Enter an address or area — e.g. 12 Bode Thomas, Surulere"
              className={`${tw.input.base} ${tw.input.default} pl-10 text-sm rounded-xl`}
              data-testid="input-home-search"
            />
          </div>
          <button
            onClick={onVerify}
            className={`shrink-0 px-4 rounded-xl text-sm flex items-center gap-1.5 ${tw.button.primary}`}
            data-testid="button-home-search"
          >
            <ShieldCheck className="w-4 h-4" /> Verify
          </button>
        </div>
        {notice && (
          <p className={`text-xs mt-2 ${typography.color.danger}`} data-testid="search-notice">
            {notice}
          </p>
        )}

        {/* Sample report — the no-account, no-payment proof of what a report delivers */}
        <button
          onClick={onSeeSample}
          className="mt-2.5 w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--space-brand-highlight-200)] bg-[var(--space-surface-accent-soft)] hover:brightness-[0.98] transition-all text-left"
          data-testid="button-see-sample-report"
        >
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[var(--space-surface-card)] border border-[var(--space-border-default)]">
            <Eye className={`w-4 h-4 ${tw.icon.primary}`} />
          </span>
          <span className="flex-1 min-w-0">
            <span className={`block text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
              See a sample report →
            </span>
            <span className={`block text-[11px] mt-0.5 leading-relaxed ${typography.color.muted}`}>
              A real report for a Surulere address, fully opened — no account, no payment.
            </span>
          </span>
        </button>

        <p className={`text-[11px] mt-2.5 ${typography.color.muted}`}>Or start from a covered area:</p>
        <div className="flex gap-1.5 mt-1.5 flex-wrap">
          {POPULAR_AREAS.map((key) => (
            <button
              key={key}
              onClick={() => onPickArea(key)}
              className={`px-2.5 py-1.5 rounded-full text-xs border bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary} hover:bg-[var(--space-surface-card-hover)] transition-colors`}
              data-testid={`home-area-${key}`}
            >
              {areaName(key)}
            </button>
          ))}
        </div>
      </div>

      {/* What a report actually contains */}
      <p className={`text-xs mt-5 mb-2 ${typography.weight.semibold} ${typography.color.primary}`}>
        Every report shows all five checks — starting with the two renters ask about most
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className={`${tw.card.default} rounded-2xl p-4`}>
          <div className="flex items-center gap-2">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tw.bg.accent}`}>
              <Droplets className={`w-4 h-4 ${tw.icon.primary}`} />
            </span>
            <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
              “Does this place flood?”
            </p>
          </div>
          <p className={`text-xs mt-2 leading-relaxed ${typography.color.muted}`}>
            The flood-zone classification for the address and a zone map of the streets around it,
            from LASEMA and NiMet advisories — then what tenants actually lived through, with their
            photos and posts attached.
          </p>
        </div>
        <div className={`${tw.card.default} rounded-2xl p-4`}>
          <div className="flex items-center gap-2">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tw.bg.accent}`}>
              <Zap className={`w-4 h-4 ${tw.icon.primary}`} />
            </span>
            <p className={`text-sm ${typography.weight.semibold} ${typography.color.primary}`}>
              “What is the light really like?”
            </p>
          </div>
          <p className={`text-xs mt-2 leading-relaxed ${typography.color.muted}`}>
            The DisCo serving the address, its official NERC band and the hours that band commits to
            — next to the hours tenants on those streets say they actually get.
          </p>
        </div>
      </div>

      {/* How pricing works */}
      <div className={`${tw.card.default} rounded-2xl p-4 mt-3`}>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            {
              icon: Search,
              title: 'Search free, forever',
              body: `Check any address and browse every listing across ${AREAS.length} Lagos areas. No account, no fees.`,
            },
            {
              icon: Ticket,
              title: `${FREE_UNLOCK_LIMIT} free reports on us`,
              body: 'Unlock full verification reports with just your email — no password, no card.',
            },
            {
              icon: Wallet,
              title: 'Then one simple plan',
              body: `₦${SUBSCRIPTION_PRICE_NGN.toLocaleString()}/month for unlimited reports. Cancel anytime.`,
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex sm:block items-start gap-3">
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 sm:mb-2 ${tw.bg.accent}`}>
                <Icon className={`w-4 h-4 ${tw.icon.primary}`} />
              </span>
              <div>
                <p className={`text-xs ${typography.weight.semibold} ${typography.color.primary}`}>{title}</p>
                <p className={`text-[11px] mt-0.5 leading-relaxed ${typography.color.muted}`}>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Secondary paths */}
      <button
        onClick={onBrowseAll}
        className={`mt-4 w-full py-3.5 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.secondary}`}
        data-testid="button-browse-listings"
      >
        Browse Lagos listings <ArrowRight className="w-4 h-4" />
      </button>
      <button
        onClick={onSubmitReport}
        className={`mt-2 w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 ${tw.button.ghost}`}
        data-testid="button-home-submit-report"
      >
        <PlusCircle className="w-4 h-4" /> Lived somewhere in Lagos? Submit a report
      </button>
      <p className={`text-[10px] mt-2 text-center ${typography.color.muted}`}>
        <ShieldCheck className="w-3 h-3 inline mr-1 -mt-0.5" />
        Searching and browsing are free — no sign-up needed until you unlock a report.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse — search + filters + listing grid (always free)
// ---------------------------------------------------------------------------

function BrowseView({
  loading,
  results,
  areaFilter,
  keyword,
  bedrooms,
  budget,
  onAreaFilter,
  onKeyword,
  onBedrooms,
  onBudget,
  onOpen,
}: {
  loading: boolean;
  results: Listing[];
  areaFilter: AreaKey | null;
  keyword: string;
  bedrooms: number;
  budget: BudgetRange | null;
  onAreaFilter: (key: AreaKey | null) => void;
  onKeyword: (kw: string) => void;
  onBedrooms: (b: number) => void;
  onBudget: (b: BudgetRange | null) => void;
  onOpen: (l: Listing) => void;
}) {
  return (
    <div className="pb-6">
      <h2 className={`text-lg ${typography.weight.semibold} ${typography.color.primary}`}>
        {areaFilter ? `Homes in ${areaName(areaFilter)}` : 'Browse Lagos homes'}
      </h2>
      <p className={`text-xs mt-0.5 mb-3 ${typography.color.muted}`}>
        Aggregated from public property portals — browsing is free and unlimited. Open any home to
        see its verification report.
      </p>

      {/* Keyword */}
      <div className="relative mb-2.5">
        <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${tw.icon.muted}`} />
        <input
          type="text"
          value={keyword}
          onChange={(e) => onKeyword(e.target.value)}
          placeholder="Filter by keyword — estate, street, 'gated', 'BQ'…"
          className={`${tw.input.base} ${tw.input.default} pl-10 text-sm rounded-xl`}
          data-testid="input-browse-keyword"
        />
      </div>

      {/* Area chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: 'none' }}>
        <button
          onClick={() => onAreaFilter(null)}
          className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs border transition-all ${
            areaFilter === null
              ? `${tw.button.primary} border-transparent`
              : `bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary}`
          }`}
          data-testid="area-chip-all"
        >
          All areas
        </button>
        {AREAS.map((a) => (
          <button
            key={a.key}
            onClick={() => onAreaFilter(areaFilter === a.key ? null : a.key)}
            className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs border transition-all ${
              areaFilter === a.key
                ? `${tw.button.primary} border-transparent`
                : `bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary}`
            }`}
            data-testid={`area-chip-${a.key}`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {/* Bedrooms */}
      <div className="flex gap-1.5 mt-1 mb-3 flex-wrap">
        {[
          { v: -1, label: 'Any beds' },
          { v: 0, label: 'Studio' },
          { v: 1, label: '1+' },
          { v: 2, label: '2+' },
          { v: 3, label: '3+' },
        ].map(({ v, label }) => (
          <button
            key={v}
            onClick={() => onBedrooms(v)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
              bedrooms === v
                ? `${tw.button.primary} border-transparent`
                : `bg-[var(--space-surface-card)] border-[var(--space-border-default)] ${typography.color.secondary}`
            }`}
            data-testid={`beds-${v}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Budget */}
      <BudgetFilter budget={budget} onBudget={onBudget} />

      {loading ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="browse-skeleton" aria-hidden="true">
          <ListingCardSkeleton />
          <ListingCardSkeleton />
          <ListingCardSkeleton />
          <ListingCardSkeleton />
        </ul>
      ) : results.length === 0 ? (
        <div className="text-center py-14 max-w-xs mx-auto">
          <Search className={`w-8 h-8 mx-auto mb-3 ${tw.icon.muted}`} />
          <p className={`text-sm ${typography.weight.medium} ${typography.color.primary}`}>No homes match</p>
          <p className={`text-xs mt-1.5 ${typography.color.muted}`}>
            {budget
              ? `Nothing in ${budgetRangeLabel(budget)} here yet. Try a wider bracket, another area, or clear the keyword — new listings are aggregated regularly.`
              : 'Try a different area or clear the keyword — new listings are aggregated regularly.'}
          </p>
          {budget && (
            <button
              onClick={() => onBudget(null)}
              className={`mt-3 px-3.5 py-2 rounded-xl text-xs ${tw.button.secondary}`}
              data-testid="button-clear-budget-empty"
            >
              Show any budget
            </button>
          )}
        </div>
      ) : (
        <>
          <p className={`text-[11px] mb-2 ${typography.color.muted}`} data-testid="browse-count">
            {results.length} home{results.length === 1 ? '' : 's'}
            {areaFilter ? ` in ${areaName(areaFilter)}` : ''}
            {keyword.trim() ? ` matching “${keyword.trim()}”` : ''}
            {budget ? ` · ${budgetRangeLabel(budget)}` : ''}
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {results.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                matchedMustHaves={[]}
                onVerify={() => onOpen(listing)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget filter — annual naira, because that is how Lagos landlords quote rent
// ---------------------------------------------------------------------------

/** Accepts what renters actually type: "3,000,000", "₦3m", "500k". */
function parseBudgetAmount(raw: string): number {
  const text = raw.trim().toLowerCase().replace(/[₦,\s]/g, '');
  if (!text) return 0;
  const match = text.match(/^(\d+(?:\.\d+)?)(m|k)?$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return 0;
  const multiplier = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

function BudgetFilter({
  budget,
  onBudget,
}: {
  budget: BudgetRange | null;
  onBudget: (b: BudgetRange | null) => void;
}) {
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');

  // The preset chips and Clear set the same range the boxes do, so mirror the
  // selection back into them — while leaving the renter's own keystrokes alone
  // as long as they still read as the same amount.
  useEffect(() => {
    const nextMin = budget && budget.min > 0 ? String(budget.min) : '';
    const nextMax = budget && budget.max != null ? String(budget.max) : '';
    setMinText((current) =>
      parseBudgetAmount(current) === parseBudgetAmount(nextMin) ? current : nextMin
    );
    setMaxText((current) =>
      parseBudgetAmount(current) === parseBudgetAmount(nextMax) ? current : nextMax
    );
  }, [budget]);

  const commit = (rawMin: string, rawMax: string) => {
    const min = parseBudgetAmount(rawMin);
    const max = parseBudgetAmount(rawMax);
    if (!min && !max) {
      onBudget(null);
      return;
    }
    onBudget({ min, max: max || null });
  };

  const typedMin = parseBudgetAmount(minText);
  const typedMax = parseBudgetAmount(maxText);
  const inverted = typedMin > 0 && typedMax > 0 && typedMax < typedMin;

  const chipClass = (active: boolean) =>
    `shrink-0 px-2.5 py-1.5 rounded-full text-xs border transition-all ${
      active
        ? `${tw.button.primary} border-transparent`
        : `bg-[var(--space-surface-muted)] border-[var(--space-border-default)] ${typography.color.secondary}`
    }`;

  const fields = [
    {
      key: 'min',
      label: 'Min ₦/yr',
      placeholder: 'No minimum',
      value: minText,
      amount: typedMin,
      onChange: (v: string) => {
        setMinText(v);
        commit(v, maxText);
      },
    },
    {
      key: 'max',
      label: 'Max ₦/yr',
      placeholder: 'No maximum',
      value: maxText,
      amount: typedMax,
      onChange: (v: string) => {
        setMaxText(v);
        commit(minText, v);
      },
    },
  ];

  return (
    <div
      className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3 mb-3"
      data-testid="budget-filter"
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={`flex items-center gap-1.5 text-xs ${typography.weight.semibold} ${typography.color.primary}`}
        >
          <Wallet className={`w-3.5 h-3.5 ${tw.icon.primary}`} aria-hidden="true" /> Budget
        </p>
        {budget && (
          <button
            onClick={() => onBudget(null)}
            className={`px-2 py-1 rounded-lg text-[11px] ${typography.weight.medium} ${typography.color.brand} hover:bg-[var(--space-surface-muted)] transition-colors`}
            data-testid="button-clear-budget"
          >
            Clear
          </button>
        )}
      </div>

      {/* Bracket chips — the Lagos rent conversation, one tap each */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1.5 mt-2 -mx-3 px-3"
        style={{ scrollbarWidth: 'none' }}
      >
        <button
          onClick={() => onBudget(null)}
          className={chipClass(budget === null)}
          data-testid="budget-chip-any"
        >
          Any budget
        </button>
        {BUDGET_PRESETS.map((preset) => {
          const active = budget != null && budget.min === preset.min && budget.max === preset.max;
          return (
            <button
              key={preset.key}
              onClick={() => onBudget(active ? null : { min: preset.min, max: preset.max })}
              className={chipClass(active)}
              data-testid={`budget-chip-${preset.key}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Exact amounts, for a renter whose ceiling sits between the brackets */}
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`budget-${field.key}`}
              className={`block text-[10px] uppercase tracking-wide mb-1 ${typography.color.muted}`}
            >
              {field.label}
            </label>
            <input
              id={`budget-${field.key}`}
              type="text"
              inputMode="numeric"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              placeholder={field.placeholder}
              className={`${tw.input.base} ${tw.input.default} px-3 py-2 text-sm rounded-xl`}
              data-testid={`input-budget-${field.key}`}
            />
            <p className={`text-[10px] mt-1 ${typography.color.muted}`}>
              {field.amount > 0 ? `${naira(monthlyFromAnnual(field.amount))}/mo` : '\u00a0'}
            </p>
          </div>
        ))}
      </div>

      {inverted ? (
        <p className={`text-[11px] mt-1 ${typography.color.danger}`} data-testid="budget-summary">
          Your maximum is below your minimum — swap them to see homes again.
        </p>
      ) : budget ? (
        <p className={`text-[11px] mt-1 ${typography.color.secondary}`} data-testid="budget-summary">
          <span className={typography.weight.semibold}>{budgetAnnualLabel(budget)}</span>
          <span className={typography.color.muted}> — {budgetMonthlyLabel(budget)}</span>
        </p>
      ) : (
        <p className={`text-[11px] mt-1 ${typography.color.muted}`} data-testid="budget-summary">
          Any budget. Lagos rent is quoted by the year — tap a bracket or type your own ceiling, and
          we’ll show what it works out to per month.
        </p>
      )}
    </div>
  );
}
