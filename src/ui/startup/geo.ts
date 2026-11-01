/**
 * Where to draw each listing on the startup screen's map. Pure: no DOM.
 *
 * Positions come from the geocoding sheet (Property.lat / lng). Until any
 * listing has one (an older server, or the sheet not found), they are guessed
 * from the city word in the listing's name, from a small table of the places
 * that come up most, with a little jitter so a city is a cluster, not a dot.
 */

import type { Property } from '@/core/types';

/** The Philippines, generously: the same box the server keeps coordinates inside. */
export const PH_BOUNDS = { south: 4.5, north: 19.5, west: 116.5, east: 127 } as const;

const LAT_SPAN = PH_BOUNDS.north - PH_BOUNDS.south;
const LNG_SPAN = PH_BOUNDS.east - PH_BOUNDS.west;

/** Width over height of the map: a degree is drawn the same size both ways (equirectangular). */
export const MAP_ASPECT = LNG_SPAN / LAT_SPAN;

/** Where the soft glow sits: just south-east of Metro Manila, so it lies behind the cluster and the land around it. */
export const GLOW_CENTRE = { lat: 14.25, lng: 121.6 } as const;

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The largest map frame of MAP_ASPECT that fits `width` × `height`, centred. */
export function fitMap(width: number, height: number): Frame {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const frameWidth = Math.min(w, h * MAP_ASPECT);
  const frameHeight = frameWidth / MAP_ASPECT;
  return { x: (w - frameWidth) / 2, y: (h - frameHeight) / 2, width: frameWidth, height: frameHeight };
}

/** lat/lng → a point in `frame`: west at the left edge, north at the top. */
export function project(lat: number, lng: number, frame: Frame): { x: number; y: number } {
  return {
    x: frame.x + ((lng - PH_BOUNDS.west) / LNG_SPAN) * frame.width,
    y: frame.y + ((PH_BOUNDS.north - lat) / LAT_SPAN) * frame.height,
  };
}

export function insidePhilippines(lat: number, lng: number): boolean {
  return lat >= PH_BOUNDS.south && lat <= PH_BOUNDS.north && lng >= PH_BOUNDS.west && lng <= PH_BOUNDS.east;
}

/** One dot: where, and how it looks. Size and opacity vary a little, per listing, the same every launch. */
export interface MapPoint {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  /** 0..1: the dot's radius between the smallest and the largest. */
  readonly size: number;
  /** 0.4..0.95. */
  readonly opacity: number;
  /** 0..1: when the dot arrives in the cascade, as a share of the cascade. */
  readonly delay: number;
}

// ------------------------------------------------------------------ the city table

/**
 * Places common in the listings, with the spellings that name them. Metro
 * Manila first, then the provinces around it, then the rest of the country.
 * Positions are each place's centre, roughly.
 */
const CITIES: readonly (readonly [lat: number, lng: number, ...names: string[]])[] = [
  [14.5547, 121.0244, 'makati', 'rockwell', 'legaspi village', 'salcedo village'],
  [14.5764, 121.0851, 'pasig', 'ortigas', 'kapitolyo'],
  [14.5509, 121.0503, 'bgc', 'bonifacio global city', 'fort bonifacio', 'mckinley'],
  [14.5176, 121.0509, 'taguig'],
  [14.676, 121.0437, 'quezon city', 'qc', 'cubao', 'eastwood', 'fairview', 'novaliches'],
  [14.5995, 120.9842, 'manila', 'binondo', 'malate', 'ermita', 'sampaloc', 'tondo', 'sta mesa', 'santa mesa'],
  [14.5794, 121.0359, 'mandaluyong'],
  [14.6019, 121.0355, 'san juan', 'greenhills'],
  [14.4793, 121.0198, 'paranaque', 'bf homes', 'sucat'],
  [14.5378, 121.0014, 'pasay', 'moa'],
  [14.4081, 121.0415, 'muntinlupa', 'alabang', 'filinvest city'],
  [14.4445, 120.9939, 'las pinas'],
  [14.6507, 120.9671, 'caloocan'],
  [14.7011, 120.983, 'valenzuela'],
  [14.6507, 121.1029, 'marikina'],
  [14.5786, 121.1222, 'cainta'],
  [14.5574, 121.1324, 'taytay'],
  [14.5862, 121.1761, 'antipolo'],
  [14.2306, 120.975, 'silang'],
  [14.3294, 120.9367, 'dasmarinas'],
  [14.4297, 120.9367, 'imus'],
  [14.459, 120.929, 'bacoor'],
  [14.3869, 120.8817, 'general trias', 'gen trias'],
  [14.3132, 121.0576, 'carmona'],
  [14.1153, 120.9621, 'tagaytay'],
  [14.3122, 121.1114, 'santa rosa', 'sta rosa'],
  [14.3328, 121.08, 'binan'],
  [14.2117, 121.1653, 'calamba'],
  [14.3595, 121.0473, 'san pedro'],
  [14.2724, 121.1251, 'cabuyao'],
  [14.8527, 120.816, 'malolos'],
  [14.7344, 120.955, 'meycauayan'],
  [14.7578, 120.9483, 'marilao'],
  [14.9547, 120.897, 'baliuag', 'baliwag'],
  [14.8139, 121.0453, 'san jose del monte', 'sjdm'],
  [14.9022, 120.8494, 'pulilan'],
  [15.0286, 120.6898, 'san fernando'],
  [15.145, 120.5887, 'angeles'],
  [15.2216, 120.5736, 'mabalacat'],
  [15.186, 120.547, 'clark'],
  [15.4755, 120.5963, 'tarlac'],
  [14.8292, 120.2828, 'olongapo'],
  [14.8786, 120.235, 'subic'],
  [16.4023, 120.596, 'baguio'],
  [13.7565, 121.0583, 'batangas'],
  [13.9411, 121.1631, 'lipa'],
  [14.1079, 121.1414, 'sto tomas', 'santo tomas'],
  [10.3157, 123.8854, 'cebu'],
  [10.3236, 123.9223, 'mandaue'],
  [10.3103, 123.9494, 'lapu lapu', 'mactan'],
  [7.1907, 125.4553, 'davao'],
  [10.7202, 122.5621, 'iloilo'],
  [10.6765, 122.9509, 'bacolod'],
  [8.4542, 124.6319, 'cagayan de oro', 'cdo'],
  [9.7392, 118.7353, 'puerto princesa', 'palawan'],
];

interface CityName {
  readonly pattern: string;
  readonly lat: number;
  readonly lng: number;
}

/** Every spelling, as " word word ", so a match is whole words. */
const CITY_NAMES: readonly CityName[] = CITIES.flatMap(([lat, lng, ...names]) =>
  names.map((name) => ({ pattern: ` ${name} `, lat, lng })),
);

/** "Sta. Rosa, Laguna" → " santa rosa laguna ": lower case, no accents, words only. */
function words(text: string): string {
  const plain = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .replace(/[^\p{L}\p{Nd}]+/gu, ' ')
    .trim();
  return ` ${plain} `;
}

/**
 * The place a listing's text names, or null. When it names more than one
 * ("Sto. Tomas, Batangas"), the last wins: the city usually ends the name;
 * at the same place, the longest spelling ("san jose del monte").
 */
export function cityOf(text: string): { lat: number; lng: number } | null {
  const haystack = words(text);
  let best: CityName | null = null;
  let bestEnd = -1;
  for (const city of CITY_NAMES) {
    const at = haystack.lastIndexOf(city.pattern);
    if (at === -1) continue;
    const end = at + city.pattern.length;
    if (end > bestEnd || (end === bestEnd && best !== null && city.pattern.length > best.pattern.length)) {
      best = city;
      bestEnd = end;
    }
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}

// ------------------------------------------------------------------ the points

/** A number from 0 to 1 for `text` and `salt`, the same every time. */
export function unit(text: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** About ±3 km: enough that one city's listings read as a cluster. */
const JITTER_DEGREES = 0.03;

/** Where a listing is, guessed from its city (the checker's City first, then its name), or null. */
export function guessPosition(p: Pick<Property, 'id' | 'name' | 'city'>): { lat: number; lng: number } | null {
  const city = (p.city ? cityOf(p.city) : null) ?? cityOf(p.name);
  if (!city) return null;
  // Two uniforms summed: more listings near the centre than at the edge.
  const dLat = (unit(p.id, 1) + unit(p.id, 2) - 1) * JITTER_DEGREES;
  const dLng = (unit(p.id, 3) + unit(p.id, 4) - 1) * JITTER_DEGREES;
  return { lat: city.lat + dLat, lng: city.lng + dLng };
}

function pointOf(p: Pick<Property, 'id'>, lat: number, lng: number): MapPoint {
  return { id: p.id, lat, lng, size: unit(p.id, 5), opacity: 0.4 + 0.55 * unit(p.id, 6), delay: unit(p.id, 7) };
}

/**
 * The dots for these listings. The geocoding sheet's positions when any
 * listing has one; otherwise each listing's city, guessed, leaving out the
 * listings that name no known place. Empty when nothing can be placed.
 */
export function plotPoints(properties: readonly Pick<Property, 'id' | 'name' | 'city' | 'lat' | 'lng'>[]): MapPoint[] {
  const placed: MapPoint[] = [];
  for (const p of properties) {
    if (typeof p.lat === 'number' && typeof p.lng === 'number' && insidePhilippines(p.lat, p.lng)) {
      placed.push(pointOf(p, p.lat, p.lng));
    }
  }
  if (placed.length > 0) return placed;
  const guessed: MapPoint[] = [];
  for (const p of properties) {
    const at = guessPosition(p);
    if (at) guessed.push(pointOf(p, at.lat, at.lng));
  }
  return guessed;
}
