/**
 * The flyer (1.1.8): what goes on it, read from the text Copy takes, never
 * from below the line. Pure: no DOM.
 *
 * A post looks like this (the real ones vary a lot, so every part is optional):
 *
 *   COMMERCIAL-INDUSTRIAL WAREHOUSE FOR SALE / LEASE – LIIP, MAMPLASAN, BIÑAN, LAGUNA
 *   Property Details:
 *   • Lot Area: 2,277 sqm
 *   • For Sale: ₱120,000,000 Gross
 *   • For Lease: ₱250/sqm
 *   • With 3-storey office building
 *   Property Highlights:
 *   • With strong water source
 *   Contact Alpha Premier Realty …
 *   realty@alphapremiergroup.com
 *   0927 555 5803 | 0915 888 9482
 */

import type { Property } from './types';

export type FlyerDeal = 'Sale or lease' | 'For lease' | 'For sale';
export const FLYER_DEALS: readonly FlyerDeal[] = ['Sale or lease', 'For lease', 'For sale'];

/** A price, shortened for a picture: "₱120M" "to buy", "₱250" "per sqm". */
export interface FlyerPrice {
  readonly amount: string;
  readonly unit: string;
}

export interface FlyerContent {
  /** What it is, for the heading: "Warehouse". */
  readonly kind: string;
  readonly deal: FlyerDeal;
  /** A sentence for Big photo: the post's first line, minus the deal and the place. */
  readonly title: string;
  /** "2,277", without the unit. */
  readonly size: string | null;
  readonly sizeLabel: 'Lot area' | 'Floor area';
  readonly lease: FlyerPrice | null;
  readonly sale: FlyerPrice | null;
  /** Where, as the post's first line names it: "LIIP, Mamplasan, Biñan, Laguna". */
  readonly place: string | null;
  /** The last two parts of `place`, for small spaces: "Biñan, Laguna". */
  readonly shortPlace: string | null;
  /** Bullets that aren't a size or a price, Highlights first. */
  readonly highlights: readonly string[];
  readonly email: string | null;
  readonly numbers: readonly string[];
}

const BULLET = /^\s*(?:[•●▪◦‣∙·*✓✔✅➤►▶→-]|\d+[.)])\s*/u;
const PHONE = /(?:\+63|0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** Everything the flyer needs from the text Copy takes, and the listing's own facts where the text says nothing. */
export function flyerContent(
  text: string,
  property: Pick<Property, 'category' | 'listingType' | 'city' | 'size' | 'dealType'> & { readonly subCategory?: string | undefined },
): FlyerContent {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const first = lines.find((l) => l !== '') ?? '';

  // Bullets before any heading count as details; a heading like "Contact us:" ends them.
  let section: 'details' | 'highlights' | 'other' = 'details';
  let size: string | null = null;
  let sizeLabel: FlyerContent['sizeLabel'] = 'Lot area';
  let lease: FlyerPrice | null = null;
  let sale: FlyerPrice | null = null;
  const fromHighlights: string[] = [];
  const fromDetails: string[] = [];

  /** A "Key: value" that is the size or a price: kept, and true. Anything else: false. */
  const fact = (body: string): boolean => {
    const pair = /^([^:]{2,40}):\s*(.+)$/.exec(body);
    if (!pair) return false;
    const key = pair[1]!.toLowerCase();
    const value = pair[2]!.trim();
    if (/lot|land/.test(key) && /area|size/.test(key)) {
      if (size === null) {
        size = sqmOf(value);
        sizeLabel = 'Lot area';
      }
      return true;
    }
    if (/floor|unit|building|gfa|area|size/.test(key) && !/price/.test(key)) {
      if (size === null) {
        size = sqmOf(value);
        sizeLabel = /lot|land/.test(key) ? 'Lot area' : 'Floor area';
      }
      return true;
    }
    if (/sale|selling|price/.test(key) && !/lease|rent/.test(key)) {
      sale ??= priceOf(value, 'sale');
      return true;
    }
    if (/lease|rent|monthly/.test(key)) {
      lease ??= priceOf(value, 'lease');
      return true;
    }
    return false;
  };

  for (const line of lines.slice(lines.indexOf(first) + 1)) {
    if (line === '') continue;
    const bullet = BULLET.test(line);
    if (!bullet) {
      if (/:\s*$/.test(line)) {
        const head = line.toLowerCase();
        section = /highlight|feature|amenit|why|perk/.test(head) ? 'highlights' : /detail|spec|info|about|propert/.test(head) && !/contact|inquir/.test(head) ? 'details' : 'other';
      } else {
        // "Price: ₱4.2M" on a line of its own, with no bullet.
        fact(line);
      }
      continue;
    }
    if (section === 'other') continue;
    const body = line.replace(BULLET, '').trim();
    if (body === '' || /^(?:code|ref(?:erence)?|listing)\s*(?:no\.?|#)?\s*:/i.test(body)) continue;

    if (fact(body)) continue;
    (section === 'highlights' ? fromHighlights : fromDetails).push(sentence(body));
  }

  // "320 sqm lot in Verdant Hills": a size the heading says in passing.
  if (size === null) {
    const m = /([\d,]+(?:\.\d+)?)\s*(?:sqm|sq\.?\s*m\b|m2|m²|square met)/i.exec(first);
    if (m) {
      size = sqmOf(`${m[1]} sqm`);
      sizeLabel = /\blot\b|\bland\b/i.test(first) ? 'Lot area' : 'Floor area';
    }
  }
  if (size === null && property.size) {
    const n = Number(property.size.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) size = n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  const place = placeOf(first) ?? (property.city?.trim() || null);
  const email = EMAIL.exec(text)?.[0] ?? null;
  const numbers = [...new Set((text.match(PHONE) ?? []).map((n) => n.replace(/\s+|-/g, '').replace(/^(\+63|0)(9\d{2})(\d{3})(\d{4})$/, '$1$2 $3 $4')))];

  return {
    kind: kindOf(property.subCategory?.trim() ? property.subCategory : property.category),
    deal: dealOf(`${first} ${property.listingType ?? ''} ${property.dealType ?? ''}`, sale !== null, lease !== null),
    title: titleOf(first),
    size,
    sizeLabel,
    lease,
    sale,
    place,
    shortPlace: place ? place.split(',').map((p) => p.trim()).filter(Boolean).slice(-2).join(', ') : null,
    highlights: [...new Set([...fromHighlights, ...fromDetails])],
    email,
    numbers: numbers.slice(0, 3),
  };
}

/** "COMMERCIAL SPACE" → "Commercial space"; "WAREHOUSE" → "Warehouse". */
export function kindOf(category: string): string {
  const words = category.replace(/_+/g, ' ').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (words === '') return 'Property';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function dealOf(words: string, hasSale: boolean, hasLease: boolean): FlyerDeal {
  const upper = words.toUpperCase();
  const sells = hasSale || /\bSALE\b|\bSELL/.test(upper);
  const leases = hasLease || /\bLEASE\b|\bRENT/.test(upper);
  if (sells && leases) return 'Sale or lease';
  if (sells) return 'For sale';
  return 'For lease';
}

/** The place after the heading's dash: "… – LIIP, MAMPLASAN, BIÑAN, LAGUNA" → "LIIP, Mamplasan, Biñan, Laguna". */
function placeOf(first: string): string | null {
  const m = /\s[–—-]\s(.+)$/.exec(first);
  if (!m) return null;
  return m[1]!
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(titleWords)
    .join(', ') || null;
}

/** The heading without the deal or the place, as a sentence. */
function titleOf(first: string): string {
  const head = first.replace(/\s[–—-]\s.+$/, '');
  const bare = head
    .replace(/\bFOR\s+(?:SALE|LEASE|RENT)(?:\s*(?:\/|OR|AND|&)\s*(?:SALE|LEASE|RENT))*\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const clean = bare.replace(/^[\s:;,–—-]+/, '');
  return sentence(clean === clean.toUpperCase() ? clean.toLowerCase() : clean);
}

/** Title Case for a shouted place, leaving short all-caps names (LIIP, BGC) alone. */
function titleWords(part: string): string {
  if (part !== part.toUpperCase()) return part;
  return part
    .split(/\s+/)
    .map((w) => (w.length <= 4 && /^[A-Z]+$/.test(w) && !COMMON.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Short words in place names that are words, not initials like LIIP or BGC. */
const COMMON = new Set(['CITY', 'BAY', 'PARK', 'SAN', 'STA', 'STO', 'NEW', 'OLD', 'WEST', 'EAST', 'BAGO', 'ROAD', 'AVE', 'ST', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'NG', 'SUR', 'ROSA', 'CRUZ', 'LIPA', 'NAGA', 'IBA', 'TAAL', 'ORMOC', 'DAET', 'BOAC', 'BAIS', 'SILANG', 'CAVITE']);

function sentence(s: string): string {
  const t = s.replace(/[.;]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "2,277 sqm" → "2,277"; "about 1.2 hectares" → "12,000". */
function sqmOf(value: string): string | null {
  const m = /([\d,]+(?:\.\d+)?)\s*(ha|hectares?|sq\.?\s*m|sqm|m2|m²)?/i.exec(value);
  if (!m) return null;
  let n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2] && /^ha|hectare/i.test(m[2])) n *= 10_000;
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** "₱120,000,000 Gross" → ₱120M to buy; "₱250/sqm" → ₱250 per sqm; "Php 85,000 per month" → ₱85K a month. */
export function priceOf(value: string, deal: 'sale' | 'lease'): FlyerPrice | null {
  const m = /(?:₱|php|p)\s*([\d,]+(?:\.\d+)?)\s*(m(?:illion)?|k)?\b|([\d,]+(?:\.\d+)?)\s*(m(?:illion)?|k)?\s*(?:pesos|php)/i.exec(value);
  if (!m) return null;
  let n = Number((m[1] ?? m[3])!.replace(/,/g, ''));
  const scale = (m[2] ?? m[4] ?? '').toLowerCase();
  if (scale.startsWith('m')) n *= 1_000_000;
  else if (scale === 'k') n *= 1_000;
  if (!Number.isFinite(n) || n <= 0) return null;

  const lower = value.toLowerCase();
  const unit = /\/\s*sq|per\s*sq|\/\s*m2|per\s*m2/.test(lower)
    ? 'per sqm'
    : /\/\s*mo|per\s*mo|month/.test(lower)
      ? 'a month'
      : deal === 'sale'
        ? 'to buy'
        : '';
  return { amount: `₱${short(n)}`, unit };
}

function short(n: number): string {
  const trim = (x: number) => (Math.round(x * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 10_000) return `${trim(n / 1_000)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------- pages

/** How many photos and highlights each look's first page takes. */
export const LOOKS = {
  framed: { name: 'Framed', photos: 3, highlights: 4 },
  big: { name: 'Big photo', photos: 1, highlights: 4 },
  light: { name: 'Light', photos: 2, highlights: 0 },
} as const;
export type FlyerLook = keyof typeof LOOKS;

/** On each later page. */
export const PER_PAGE_CHOICES = [2, 3, 4, 6] as const;
export type PerPage = (typeof PER_PAGE_CHOICES)[number];

/** The photos after the flyer's own, spread evenly over as few pages as hold them at `per` a page. */
export function laterPages<T>(picked: readonly T[], look: FlyerLook, per: number): T[][] {
  const rest = picked.slice(Math.min(LOOKS[look].photos, picked.length));
  const n = Math.ceil(rest.length / per);
  const pages: T[][] = [];
  for (let p = 0, i = 0; p < n; p++) {
    const size = Math.ceil((rest.length - i) / (n - p));
    pages.push(rest.slice(i, i + size));
    i += size;
  }
  return pages;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where n photos (one to six) go in a box, each layout made for wide photos. */
export function rects(n: number, x: number, y: number, w: number, h: number, g: number): Rect[] {
  const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
  const w2 = (w - g) / 2;
  const w3 = (w - 2 * g) / 3;
  if (n <= 1) return [R(x, y, w, h)];
  if (n === 2) {
    const h2 = (h - g) / 2;
    return [R(x, y, w, h2), R(x, y + h2 + g, w, h2)];
  }
  if (n === 3) {
    const t = (h - g) * 0.56;
    const b = h - g - t;
    return [R(x, y, w, t), R(x, y + t + g, w2, b), R(x + w2 + g, y + t + g, w2, b)];
  }
  if (n === 4) {
    const h2 = (h - g) / 2;
    return [0, 1, 2, 3].map((i) => R(x + (i % 2) * (w2 + g), y + Math.floor(i / 2) * (h2 + g), w2, h2));
  }
  if (n === 5) {
    const h2 = (h - g) / 2;
    return [R(x, y, w2, h2), R(x + w2 + g, y, w2, h2), ...[0, 1, 2].map((i) => R(x + i * (w3 + g), y + h2 + g, w3, h2))];
  }
  const h3 = (h - 2 * g) / 3;
  return [0, 1, 2, 3, 4, 5].slice(0, n).map((i) => R(x + (i % 2) * (w2 + g), y + Math.floor(i / 2) * (h3 + g), w2, h3));
}
