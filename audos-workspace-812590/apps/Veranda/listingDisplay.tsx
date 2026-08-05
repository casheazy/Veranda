/**
 * Veranda — presentation layer for scraped listing results.
 *
 * Scraped rows (propertypro.ng / nigeriapropertycentre.com) arrive messy:
 * missing photos, prices stored as strings, null neighborhoods, and
 * agent-pasted descriptions full of noise ("For rent!!!", fancy-unicode
 * fonts, fee breakdowns). Everything in this file is DISPLAY-ONLY cleanup —
 * the NormalizedListing ingestion contract (apps/Veranda/ingestion.ts) and
 * the scraping pipeline are untouched.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ComponentType } from 'react';
import {
  Bath,
  BedDouble,
  Building2,
  ChevronLeft,
  ChevronRight,
  MapPin,
  ShieldCheck,
  Sofa,
  X,
} from 'lucide-react';
import { tw, typography } from '../../lib/colors';
import { Listing, areaName, naira } from './types';

/** On-brand "no photo" illustration (generated asset on the platform CDN). */
const PHOTO_PLACEHOLDER_URL =
  'https://storage.googleapis.com/audos-images/generated-images/agent/workspace-812590/img-1785524222832-ajj58w.png';

const twoLineClamp: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

// ---------------------------------------------------------------------------
// Display-only field cleanup helpers
// ---------------------------------------------------------------------------

export function rentValue(l: Listing): number {
  const v = typeof l.rent_year_ngn === 'string' ? parseFloat(l.rent_year_ngn) : l.rent_year_ngn;
  return v == null || isNaN(v) || v <= 0 ? 0 : v;
}

/**
 * Normalize scraped text for display: collapse whitespace, map fancy-unicode
 * "bold" fonts (𝙇𝙐𝙓𝙐𝙍𝙔 …) back to plain letters, and strip the agent-paste
 * noise most portal listings open with ("For rent!!!", "To let --", …).
 */
export function cleanScrapedText(raw?: string | null): string {
  if (raw == null) return '';
  let t = String(raw);
  if (t === 'null' || t === 'undefined') return '';
  try {
    t = t.normalize('NFKC');
  } catch {
    /* older engines without unicode normalization — use text as-is */
  }
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:for\s+(?:rent|lease|sale)|to\s+let|now\s+letting)\b[\s!:;.,"'@–—-]*/i, '');
  t = t.replace(/^[-–—•*!"'\s]+/, '').replace(/[,\s]+$/, '');
  if (t && /[a-z]/.test(t.charAt(0))) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function bedsLabel(b?: number | null): string | null {
  if (b == null) return null;
  if (b === 0) return 'Studio';
  return `${b} bed`;
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  'mini-flat': 'Mini flat',
  apartment: 'Apartment',
  duplex: 'Duplex',
  terrace: 'Terrace',
  house: 'House',
  bungalow: 'Bungalow',
  'self-contain': 'Self-contain',
  studio: 'Studio',
};

function propertyTypeLabel(t?: string | null): string | null {
  const key = (t || '').toLowerCase().trim();
  if (!key) return null;
  return PROPERTY_TYPE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' ');
}

const PORTAL_LABELS: Record<string, string> = {
  propertypro: 'propertypro.ng',
  nigeriapropertycentre: 'nigeriapropertycentre.com',
  jiji: 'jiji.ng',
  seed: 'Sample listing',
  manual: 'Curated',
};

function portalLabel(p?: string | null): string | null {
  const key = (p || '').toLowerCase().trim();
  if (!key) return null;
  return PORTAL_LABELS[key] || key;
}

/**
 * One clear location line: "<street / neighborhood>, <covered area>".
 * Falls back to the first address segment when the scrape has no
 * neighborhood, and drops it again when it just repeats the area name.
 */
export function locationLabel(l: Listing): string {
  const area = areaName(l.area_key);
  let local = cleanScrapedText(l.neighborhood);
  if (!local && l.address) local = cleanScrapedText(String(l.address).split(',')[0]);
  if (local && (local.toLowerCase() === area.toLowerCase() || area.toLowerCase().includes(local.toLowerCase()))) {
    local = '';
  }
  return local ? `${local}, ${area}` : area;
}

// ---------------------------------------------------------------------------
// Listing photos — swipeable carousel with graceful fallbacks
// (never a broken-image icon; a single photo renders without carousel chrome)
// ---------------------------------------------------------------------------

/** Hide the horizontal scrollbar on the snap track (webkit needs a real rule). */
const CAROUSEL_TRACK_CSS = '.veranda-photo-track::-webkit-scrollbar{display:none}';

const MAX_CAROUSEL_PHOTOS = 8;

/**
 * Collect every usable photo URL for a listing.
 *
 * The scraper (server hook `veranda-scrape-listings`) stores each listing's
 * FULL photo gallery as a JSON-array string in `image_url` (full-size URLs,
 * ~8 photos on average), so most cards render the swipeable carousel. This
 * also understands a plain URL string, an `image_urls` json array on the row,
 * and several URLs separated by commas / whitespace / pipes — seed rows and
 * older data keep working.
 */
export function listingImageUrls(listing: Listing): string[] {
  const collected: string[] = [];
  const pushUrl = (value: string) => {
    const s = value.trim();
    if (/^https?:\/\//i.test(s) && !collected.includes(s)) collected.push(s);
  };
  const expand = (value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(expand);
      return;
    }
    if (typeof value !== 'string') return;
    const s = value.trim();
    if (!s || s === 'null' || s === 'undefined') return;
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          parsed.forEach(expand);
          return;
        }
      } catch {
        /* not a JSON array — fall through to the delimiter split */
      }
    }
    s.split(/[\s,|]+/).forEach(pushUrl);
  };
  expand((listing as { image_urls?: unknown }).image_urls);
  expand(listing.image_url);
  return collected.slice(0, MAX_CAROUSEL_PHOTOS);
}

/** On-brand placeholder when a listing has no loadable photo. */
function NoPhotoFallback({ heightClass }: { heightClass: string }) {
  const [placeholderFailed, setPlaceholderFailed] = useState(false);

  if (placeholderFailed) {
    // Last-resort fallback if even the CDN illustration cannot load.
    return (
      <div
        className={`w-full ${heightClass} flex flex-col items-center justify-center gap-1.5 bg-[linear-gradient(135deg,var(--space-brand-primary-50),var(--space-surface-accent-soft))]`}
        role="img"
        aria-label="No photo available for this listing"
      >
        <Building2 className={`w-8 h-8 ${tw.icon.muted}`} aria-hidden="true" />
        <span className={`text-[11px] ${typography.color.muted}`}>No photo from this listing</span>
      </div>
    );
  }

  return (
    <div className={`relative w-full ${heightClass} bg-[var(--space-surface-accent-soft)]`}>
      <img
        src={PHOTO_PLACEHOLDER_URL}
        alt="No photo available for this listing"
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setPlaceholderFailed(true)}
      />
      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/45 text-white backdrop-blur-sm">
        No photo from listing
      </span>
    </div>
  );
}

/** Single listing photo with graceful fallback (used by ReportView's hero). */
export function ListingPhoto({
  listing,
  alt,
  heightClass = 'h-40 sm:h-44',
}: {
  listing: Listing;
  alt?: string;
  heightClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = listingImageUrls(listing)[0] || '';

  if (!src || failed) return <NoPhotoFallback heightClass={heightClass} />;

  return (
    <img
      src={src}
      alt={alt || 'Listing photo'}
      className={`w-full ${heightClass} object-cover`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Swipeable photo carousel for listing cards.
 * - 0 photos → on-brand placeholder; 1 photo → plain image, no carousel UI.
 * - 2+ photos → native scroll-snap swipe (mobile), hover arrows (desktop),
 *   tappable dot indicators and a photo counter.
 * - Broken photos are dropped from the deck silently; the first photo loads
 *   eagerly while later slides mount lazily as the user approaches them.
 * - Tapping a photo opens a full-screen lightbox.
 */
export function ListingPhotoCarousel({
  listing,
  alt,
  heightClass = 'h-40 sm:h-44',
}: {
  listing: Listing;
  alt?: string;
  heightClass?: string;
}) {
  const allUrls = useMemo(() => listingImageUrls(listing), [listing]);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const photos = useMemo(
    () => allUrls.filter((u) => !failedUrls.includes(u)),
    [allUrls, failedUrls]
  );

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  // Highest slide index whose <img> is mounted (current slide + one ahead).
  const [revealed, setRevealed] = useState(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // If a broken photo was dropped from the deck, keep the position valid.
  useEffect(() => {
    if (index > photos.length - 1) {
      const next = Math.max(0, photos.length - 1);
      setIndex(next);
      const el = trackRef.current;
      if (el) el.scrollTo({ left: next * el.clientWidth });
    }
  }, [photos.length, index]);

  if (photos.length === 0) return <NoPhotoFallback heightClass={heightClass} />;

  const label = alt || 'Listing photo';

  const markFailed = (url: string) =>
    setFailedUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(i, photos.length - 1));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setIndex(clamped);
    setRevealed((r) => Math.max(r, clamped + 1));
  };

  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.max(0, Math.min(Math.round(el.scrollLeft / el.clientWidth), photos.length - 1));
    setIndex((prev) => (prev === i ? prev : i));
    setRevealed((r) => Math.max(r, i + 1));
  };

  return (
    <div
      className={`relative w-full ${heightClass} group overflow-hidden`}
      data-testid={`photo-carousel-${listing.id}`}
    >
      <style>{CAROUSEL_TRACK_CSS}</style>

      {photos.length === 1 ? (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="block w-full h-full cursor-zoom-in"
          aria-label={`${label} — tap to enlarge`}
        >
          <img
            src={photos[0]}
            alt={label}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable={false}
            onError={() => markFailed(photos[0])}
          />
        </button>
      ) : (
        <>
          <div
            ref={trackRef}
            onScroll={onTrackScroll}
            className="veranda-photo-track flex w-full h-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
            aria-roledescription="carousel"
            aria-label={`${label} — ${photos.length} photos`}
          >
            {photos.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="relative w-full h-full shrink-0 snap-center overflow-hidden cursor-zoom-in"
                aria-label={`Photo ${i + 1} of ${photos.length} — tap to enlarge`}
              >
                {i <= revealed ? (
                  <img
                    src={url}
                    alt={`${label} — photo ${i + 1} of ${photos.length}`}
                    className="w-full h-full object-cover"
                    loading={i === 0 ? 'eager' : 'lazy'}
                    draggable={false}
                    onError={() => markFailed(url)}
                  />
                ) : (
                  <span className="block w-full h-full bg-[var(--space-surface-muted)]" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>

          {/* Photo counter */}
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/45 text-white backdrop-blur-sm pointer-events-none">
            {index + 1}/{photos.length}
          </span>

          {/* Desktop arrows — mobile swipes instead */}
          {index > 0 && (
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              aria-label="Previous photo"
              data-testid={`carousel-prev-${listing.id}`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          {index < photos.length - 1 && (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              aria-label="Next photo"
              data-testid={`carousel-next-${listing.id}`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {/* Dot indicators */}
          <div className="absolute bottom-1.5 inset-x-0 flex justify-center pointer-events-none">
            <div className="flex items-center px-0.5 rounded-full bg-black/35 backdrop-blur-sm pointer-events-auto">
              {photos.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => goTo(i)}
                  className="w-6 h-6 flex items-center justify-center"
                  aria-label={`Go to photo ${i + 1} of ${photos.length}`}
                  aria-current={i === index ? 'true' : undefined}
                >
                  <span
                    className={`rounded-full transition-all duration-200 ${
                      i === index ? 'w-2 h-2 bg-white' : 'w-1.5 h-1.5 bg-white/50'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {lightboxOpen && (
        <PhotoLightbox
          photos={photos}
          startIndex={Math.min(index, photos.length - 1)}
          alt={label}
          onClose={() => setLightboxOpen(false)}
          onImageError={markFailed}
        />
      )}
    </div>
  );
}

/** Full-screen photo viewer opened by tapping a listing photo. */
function PhotoLightbox({
  photos,
  startIndex,
  alt,
  onClose,
  onImageError,
}: {
  photos: string[];
  startIndex: number;
  alt: string;
  onClose: () => void;
  onImageError: (url: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(Math.max(0, Math.min(startIndex, photos.length - 1)));

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(i, photos.length - 1));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setIndex(clamped);
  };

  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.max(0, Math.min(Math.round(el.scrollLeft / el.clientWidth), photos.length - 1));
    setIndex((prev) => (prev === i ? prev : i));
  };

  // Open directly on the photo the user tapped.
  useEffect(() => {
    const el = trackRef.current;
    if (el && startIndex > 0) el.scrollTo({ left: startIndex * el.clientWidth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard controls + background scroll lock while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photos.length, onClose]);

  // Keep the position valid if a broken photo gets dropped mid-view; close
  // when nothing loadable is left.
  useEffect(() => {
    if (photos.length === 0) {
      onClose();
      return;
    }
    if (index > photos.length - 1) {
      const next = photos.length - 1;
      setIndex(next);
      const el = trackRef.current;
      if (el) el.scrollTo({ left: next * el.clientWidth });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length, index]);

  if (photos.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — photo viewer`}
      data-testid="photo-lightbox"
    >
      <div className="flex items-center justify-between pl-4 pr-2 pt-2 shrink-0">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 text-white">
          {index + 1} / {photos.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center rounded-full text-white hover:bg-white/10"
          aria-label="Close photo viewer"
          data-testid="button-lightbox-close"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={trackRef}
          onScroll={onTrackScroll}
          className="veranda-photo-track flex w-full h-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {photos.map((url, i) => (
            <div
              key={url}
              className="w-full h-full shrink-0 snap-center flex items-center justify-center p-3"
              onClick={onClose}
            >
              <img
                src={url}
                alt={`${alt} — photo ${i + 1} of ${photos.length}`}
                className="max-w-full max-h-full object-contain"
                loading={i === 0 ? 'eager' : 'lazy'}
                draggable={false}
                onClick={(e) => e.stopPropagation()}
                onError={() => onImageError(url)}
              />
            </div>
          ))}
        </div>

        {photos.length > 1 && index > 0 && (
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {photos.length > 1 && index < photos.length - 1 && (
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Next photo"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {photos.length > 1 ? (
        <div className="shrink-0 flex items-center justify-center pb-4 pt-2">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => goTo(i)}
              className="w-7 h-7 flex items-center justify-center"
              aria-label={`Go to photo ${i + 1} of ${photos.length}`}
              aria-current={i === index ? 'true' : undefined}
            >
              <span
                className={`rounded-full transition-all duration-200 ${
                  i === index ? 'w-2.5 h-2.5 bg-white' : 'w-1.5 h-1.5 bg-white/40'
                }`}
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="shrink-0 pb-4" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fact chip (beds / baths / type / furnished)
// ---------------------------------------------------------------------------

function FactChip({ icon: Icon, label }: { icon?: ComponentType<{ className?: string }>; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] ${typography.weight.medium} bg-[var(--space-surface-muted)] border border-[var(--space-border-default)] ${typography.color.secondary}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Listing card — price + location lead, everything else supports
// ---------------------------------------------------------------------------

export function ListingCard({
  listing,
  matchedMustHaves,
  onVerify,
}: {
  listing: Listing;
  matchedMustHaves: string[];
  onVerify: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const rent = rentValue(listing);
  const beds = bedsLabel(listing.bedrooms);
  const baths = listing.bathrooms != null ? `${listing.bathrooms} bath` : null;
  const type = propertyTypeLabel(listing.property_type);
  const title =
    cleanScrapedText(listing.title) || [beds, type].filter(Boolean).join(' · ') || 'Lagos home';
  const description = cleanScrapedText(listing.description);
  const showToggle = description.length > 140;
  const portal = portalLabel(listing.source_portal);

  return (
    <li
      className={`${tw.card.default} rounded-2xl overflow-hidden`}
      data-testid={`listing-${listing.id}`}
    >
      <div className="relative">
        <ListingPhotoCarousel listing={listing} alt={title} />
        {portal && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/55 text-white backdrop-blur-sm pointer-events-none">
            {portal}
          </span>
        )}
      </div>

      <div className="p-4">
        {/* Price — the headline element */}
        {rent > 0 ? (
          <p
            className={`text-lg leading-tight ${typography.weight.bold} ${typography.color.brand}`}
            data-testid={`price-${listing.id}`}
          >
            {naira(rent)}
            <span className={`text-[11px] ml-0.5 ${typography.weight.medium} ${typography.color.muted}`}>/yr</span>
          </p>
        ) : (
          <p className={`text-sm leading-tight ${typography.weight.semibold} ${typography.color.muted}`}>
            Price on request
          </p>
        )}

        {/* Location — second in the hierarchy */}
        <p className={`flex items-center gap-1 mt-1 text-sm ${typography.weight.medium} ${typography.color.primary}`}>
          <MapPin className={`w-3.5 h-3.5 shrink-0 ${tw.icon.primary}`} aria-hidden="true" />
          <span className="min-w-0 truncate">{locationLabel(listing)}</span>
        </p>

        {/* Title (supporting) */}
        <p className={`mt-1 text-xs truncate ${typography.color.secondary}`}>{title}</p>

        {/* Facts row — omit anything the scrape didn't provide */}
        {(beds || baths || type || listing.furnished) && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {beds && <FactChip icon={BedDouble} label={beds} />}
            {baths && <FactChip icon={Bath} label={baths} />}
            {type && <FactChip label={type} />}
            {listing.furnished ? <FactChip icon={Sofa} label="Furnished" /> : null}
          </div>
        )}

        {/* Description — max 2 lines, clean truncation */}
        {description && (
          <div className="mt-2.5">
            <p
              className={`text-xs leading-relaxed ${typography.color.muted}`}
              style={expanded ? undefined : twoLineClamp}
            >
              {description}
            </p>
            {showToggle && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className={`mt-0.5 py-1 pr-3 text-xs ${typography.weight.medium} ${typography.color.brand} underline underline-offset-2`}
                data-testid={`button-readmore-${listing.id}`}
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}

        {matchedMustHaves.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-2.5">
            {matchedMustHaves.slice(0, 3).map((m) => (
              <span key={m} className={`${tw.badge.default} ${tw.badge.success}`}>
                ✓ {m}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={onVerify}
          className={`mt-3.5 w-full py-3 rounded-xl text-xs flex items-center justify-center gap-1.5 ${tw.button.primary}`}
          data-testid={`button-verify-${listing.id}`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          View home & verification report
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton card shown while listings are being fetched
// ---------------------------------------------------------------------------

export function ListingCardSkeleton() {
  return (
    <li className={`${tw.card.default} rounded-2xl overflow-hidden`} aria-hidden="true">
      <div className="w-full h-40 sm:h-44 animate-pulse bg-[var(--space-surface-muted)]" />
      <div className="p-4 space-y-2.5 animate-pulse">
        <div className="h-5 w-36 rounded-md bg-[var(--space-surface-muted)]" />
        <div className="h-4 w-48 max-w-full rounded-md bg-[var(--space-surface-muted)]" />
        <div className="flex gap-1.5">
          <div className="h-6 w-16 rounded-lg bg-[var(--space-surface-muted)]" />
          <div className="h-6 w-16 rounded-lg bg-[var(--space-surface-muted)]" />
          <div className="h-6 w-20 rounded-lg bg-[var(--space-surface-muted)]" />
        </div>
        <div className="h-3 w-full rounded bg-[var(--space-surface-muted)]" />
        <div className="h-3 w-3/4 rounded bg-[var(--space-surface-muted)]" />
        <div className="h-11 w-full rounded-xl bg-[var(--space-surface-muted)]" />
      </div>
    </li>
  );
}
