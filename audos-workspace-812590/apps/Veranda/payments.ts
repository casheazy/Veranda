import type { ReportUnlock } from './types';

/**
 * Check Stripe for every pending unlock and promote paid ones.
 * Returns true when at least one unlock flipped to paid (callers refresh).
 */
export async function finalizePendingUnlocks(pending: ReportUnlock[]): Promise<boolean> {
  const db = (window as any).__workspaceDb;
  if (!db || pending.length === 0) return false;
  let changed = false;
  for (const u of pending) {
    if (!u.stripe_session_id) continue;
    try {
      const res = await fetch(`/api/payments/status/${encodeURIComponent(u.stripe_session_id)}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.paymentStatus === 'paid' || data?.status === 'complete') {
        await db.from('report_unlocks').update(u.id, {
          status: 'paid',
          paid_at: new Date().toISOString(),
        });
        changed = true;
      }
    } catch {
      // network hiccup — stays pending; user can refresh
    }
  }
  return changed;
}
