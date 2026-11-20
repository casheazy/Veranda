/**
 * "My list" — homes a renter saves to compare side by side.
 * Stored on this device (localStorage), capped at MAX_SHORTLIST. Kept as full
 * Listing objects so a saved home reopens without another fetch.
 */
import { useEffect, useState } from 'react';
import type { Listing } from './types';

const KEY = 'veranda_shortlist_v1';
const EVENT = 'veranda:shortlist-changed';
export const MAX_SHORTLIST = 10;

export function readShortlist(): Listing[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: Listing[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked — the list just won't persist */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

export function toggleShortlist(listing: Listing): boolean {
  const list = readShortlist();
  const exists = list.some((l) => l.id === listing.id);
  if (exists) {
    write(list.filter((l) => l.id !== listing.id));
    return false;
  }
  if (list.length >= MAX_SHORTLIST) {
    throw new Error(`Your list holds up to ${MAX_SHORTLIST} homes. Remove one first.`);
  }
  write([...list, listing]);
  return true;
}

export function removeFromShortlist(id: number) {
  write(readShortlist().filter((l) => l.id !== id));
}

export function useShortlist(): Listing[] {
  const [list, setList] = useState<Listing[]>(() => readShortlist());
  useEffect(() => {
    const sync = () => setList(readShortlist());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return list;
}
