/**
 * How the intern screens say dates, counts and folder names. Always English,
 * whatever the PC's regional settings, as the C# prototype did.
 */

import type { Property } from '@/core/types';
import { categoryLabel } from '../../components';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function utc(iso: string): Date | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** "2026-11-06" → "Thu 6 Nov 2026". Anything else comes back as it was. */
export function longDate(iso: string): string {
  const d = utc(iso);
  return d ? `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : iso;
}

/** "2026-11-06" → "Thu 6 Nov". */
export function shortDate(iso: string): string {
  const d = utc(iso);
  return d ? `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : iso;
}

/** "2026-11-06" → "6 Nov". */
export function dayMonth(iso: string): string {
  const d = utc(iso);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : iso;
}

/** Whole days from one yyyy-MM-dd to another. */
export function daysBetween(from: string, to: string): number {
  const a = utc(from);
  const b = utc(to);
  return a && b ? Math.round((b.getTime() - a.getTime()) / DAY_MS) : 0;
}

/** "today", "yesterday", "3 days ago". */
export function daysAgo(n: number): string {
  if (n <= 0) return 'today';
  return n === 1 ? 'yesterday' : `${n} days ago`;
}

/** "1 photo", "8 photos", "1,474 listings". */
export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-PH')} ${n === 1 ? one : many}`;
}

/** "Jan Dela Cruz" → "Jan". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * A folder name in sentence case: "FOR LEASE/ FOR RENT" → "For lease / for
 * rent". Names that are not shouting are kept as their owner wrote them.
 */
export function folderName(label: string): string {
  const tidy = label.trim().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ');
  const shouting = tidy === tidy.toUpperCase() && /[A-Z]{2}/.test(tidy);
  if (!shouting) return tidy;
  const lower = tidy.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Where a listing sits in the library: "Condo / house and lot · Lot · For sale". */
export function folderLine(p: Pick<Property, 'category' | 'subCategory' | 'listingType'>): string {
  return [categoryLabel(p.category), folderName(p.subCategory), folderName(p.listingType)]
    .filter((part) => part !== '')
    .join(' · ');
}

/** The folder a saved file is in: "C:\…\APG Post-It\Verdant Hills\photo 1.jpg" → "C:\…\APG Post-It\Verdant Hills". */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut > 0 ? path.slice(0, cut) : path;
}

/** The last part of a path, for saying where something went: "Downloads\APG Post-It\Verdant Hills". */
export function friendlyFolder(folder: string): string {
  const at = folder.search(/[\\/]Downloads[\\/]/i);
  return at === -1 ? folder : folder.slice(at + 1);
}
