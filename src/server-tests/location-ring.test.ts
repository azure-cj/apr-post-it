/**
 * locationRing: the red "approximate area" ellipse for a listing's brochure
 * map (APG GIS's docs/BROCHURE-MAP.md), worked out on the server so the exact
 * point never leaves it. Centred, always, on the listing's pin on the APG map,
 * which Post-It works out as APG GIS's movePin_ does, with the same secret.
 *
 * The oracle below is written again from APG GIS's server/Feed.gs (movePin_)
 * and the brief (draws, highlightFor's publicPin branch, ellipseRing, inside),
 * on Node's own crypto and unsigned bytes, not on the harness's fake.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeHmacSha256Signature } from './harness';
import { CASA, createWorld, LOT_9, TOWER, type Listing, type World } from './world';

const SECRET = 'apg-test-secret';
const GEO_HEADERS = ['FolderId', 'Property', 'Query', 'Lat', 'Lng', 'GeoStatus', 'Checked'];
const REFUSED = { ok: false } as const;

type LngLat = [number, number];
type Reply = Record<string, unknown>;

interface Highlight {
  readonly center: LngLat;
  readonly semiMajor: number;
  readonly semiMinor: number;
  readonly tilt: number;
}

// ------------------------------------------------------------------ the oracle

/** APG GIS's movePin_ (server/Feed.gs): the public pin, [lat, lng]. */
function apgPin(lat: number, lng: number, id: string, wide: boolean, secret: string): [number, number] {
  const [uAngle, uDist] = draws(id, secret);
  const angle = uAngle! * 2 * Math.PI;
  const moved = wide ? 200 + uDist! * 350 : 80 + uDist! * 140;
  const dLat = (moved * Math.cos(angle)) / 111320;
  const dLng = (moved * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [Math.round((lat + dLat) * 1e4) / 1e4, Math.round((lng + dLng) * 1e4) / 1e4];
}

/** The brief's draws(): four numbers in [0, 1). */
function draws(id: string, secret: string): number[] {
  const b = createHmac('sha256', secret).update(id).digest();
  return [0, 2, 4, 6].map((i) => b.readUInt16BE(i) / 65536);
}

const M_PER_DEG = 111_320;
const rad = (d: number): number => (d * Math.PI) / 180;

function metres(a: LngLat, b: LngLat): [number, number] {
  return [(b[0] - a[0]) * M_PER_DEG * Math.cos(rad(a[1])), (b[1] - a[1]) * M_PER_DEG];
}

function shift(p: LngLat, east: number, north: number): LngLat {
  return [p[0] + east / (M_PER_DEG * Math.cos(rad(p[1]))), p[1] + north / M_PER_DEG];
}

/** APG GIS's kinds: a warehouse is the only `wide` one. */
const isWarehouse = (category: string): boolean => category.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() === 'WAREHOUSE';

/** The brief's highlightFor with a publicPin, `far` the APG cap (see locationRing_). */
function highlight(id: string, lat: number, lng: number, category: string, reach: number, secret = SECRET): Highlight {
  const wide = isWarehouse(category);
  const [pinLat, pinLng] = apgPin(lat, lng, id, wide, secret);
  const [, , uShape, uTilt] = draws(id, secret);
  const semiMinor = Math.ceil((wide ? 550 : 220) + reach + 50);
  return {
    center: [pinLng, pinLat],
    semiMinor,
    semiMajor: Math.ceil(semiMinor * (1.25 + 0.4 * uShape!)),
    tilt: Math.round(uTilt! * 180),
  };
}

/** The brief's ellipseRing. */
function ellipseRing(h: Highlight, steps = 128): LngLat[] {
  const t = rad(h.tilt);
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const x = h.semiMajor * Math.cos(a);
    const y = h.semiMinor * Math.sin(a);
    ring.push(shift(h.center, x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)));
  }
  ring.push(ring[0]!);
  return ring;
}

/** The brief's inside(): is a point inside the ellipse? */
function inside(h: Highlight, q: LngLat): boolean {
  const [e, n] = metres(h.center, q);
  const t = rad(h.tilt);
  const x = e * Math.cos(t) + n * Math.sin(t);
  const y = -e * Math.sin(t) + n * Math.cos(t);
  return (x / h.semiMajor) ** 2 + (y / h.semiMinor) ** 2 <= 1;
}

/** Is a point inside the ring as drawn, the polygon itself? Ray casting, in metres around the centre. */
function insideRing(ring: readonly LngLat[], center: LngLat, q: LngLat): boolean {
  const [qx, qy] = metres(center, q);
  const pts = ring.map((p) => metres(center, p));
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > qy !== yj > qy && qx < ((xj - xi) * (qy - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ------------------------------------------------------------------ the world

const SHED: Listing = {
  id: 'F-wh',
  name: 'Laguna Warehouse',
  docId: 'D-wh',
  category: 'WAREHOUSE',
  listingType: 'FOR LEASE',
  doc: ['FOR LEASE: Warehouse, Binan', '---', 'Owner: Mr. Tan 0917 222 3333'],
  photos: ['P-wh-1'],
};

interface Place {
  readonly listing: Listing;
  readonly lat: number;
  readonly lng: number;
  /** The checker's Size (sqm). */
  readonly size?: string;
}

const PLACES: readonly Place[] = [
  { listing: CASA, lat: 14.586213, lng: 121.176147, size: '120' },
  { listing: SHED, lat: 14.3071, lng: 121.0612, size: '2,500' },
  { listing: LOT_9, lat: 14.6, lng: 120.5, size: '787,374' },
  { listing: TOWER, lat: 14.5869, lng: 121.0614, size: '85.5' },
];

/**
 * A world with these listings in the directory, the Geo tab (those `located`)
 * and the checker, and PIN_SECRET set (null: not set).
 */
function setUp(places: readonly Place[] = PLACES, secret: string | null = SECRET, located = (_p: Place): boolean => true): World {
  const w = createWorld({ listings: places.map((p) => p.listing) });
  if (secret !== null) w.project.properties.set('PIN_SECRET', secret);
  w.directory
    .addSheet('Geo', GEO_HEADERS, { rows: places.length + 10 })
    .type(...places.filter(located).map((p) => [p.listing.id, p.listing.name, '', String(p.lat), String(p.lng), 'ok', '2026-11-20 10:00']));
  w.publishChecker(places.map((p) => ({ id: p.listing.id, name: p.listing.name, size: p.size ?? '' })));
  return w;
}

function ring(w: World, id: string, who: 'jan' | 'maria' = 'jan'): Reply {
  return w.call(who, 'locationRing', { id });
}

function highlightOf(reply: Reply): Highlight {
  return {
    center: reply['center'] as LngLat,
    semiMajor: reply['semiMajor'] as number,
    semiMinor: reply['semiMinor'] as number,
    tilt: reply['tilt'] as number,
  };
}

// ------------------------------------------------------------------ the fake's HMAC

describe('Utilities.computeHmacSha256Signature, faked', () => {
  // RFC 4231, test case 2.
  const RFC_4231 = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
  const hex = (bytes: readonly number[]): string => bytes.map((b) => (b & 255).toString(16).padStart(2, '0')).join('');

  it('gives the HMAC\'s 32 bytes, signed as Java\'s bytes are', () => {
    const bytes = computeHmacSha256Signature('what do ya want for nothing?', 'Jefe');

    expect(hex(bytes)).toBe(RFC_4231);
    expect(bytes.slice(0, 2)).toEqual([0x5b, 0xdc - 256]);
    expect(bytes.every((b) => Number.isInteger(b) && b >= -128 && b <= 127)).toBe(true);
  });

  it('is the one the script gets, and takes byte arrays too', () => {
    const w = createWorld();
    const text = w.project.evaluate("Utilities.computeHmacSha256Signature('what do ya want for nothing?', 'Jefe')") as number[];
    const bytes = w.project.evaluate(
      "Utilities.computeHmacSha256Signature([119,104,97,116,32,100,111,32,121,97,32,119,97,110,116,32,102,111,114,32,110,111,116,104,105,110,103,63], [74,101,102,101])",
    ) as number[];

    expect(hex(text)).toBe(RFC_4231);
    expect(bytes).toEqual(text);
  });

  it('refuses text with bytes, as Apps Script has no such overload', () => {
    expect(() => computeHmacSha256Signature('a', [1, 2])).toThrow(/don't match the method signature/);
  });
});

// ------------------------------------------------------------------ the ring

describe('locationRing', () => {
  it('is centred on the APG map\'s pin for the listing: worked out by hand for one id and secret', () => {
    const w = setUp();

    // HMAC-SHA256("F-casa", SECRET) starts 74 0c 4b 97 0b 03 01 69: moved 121.3 m at 163 degrees.
    expect(ring(w, CASA.id)).toMatchObject({ ok: true, center: [121.1765, 14.5852], semiMinor: 310, semiMajor: 393, tilt: 1 });
    // A warehouse: moved 200-550 m, so the ring is wider (8d 17 26 2e 07 ce 7f cd: 252.2 m).
    expect(ring(w, SHED.id)).toMatchObject({ ok: true, center: [121.0605, 14.305], semiMinor: 640, semiMajor: 808, tilt: 90 });
  });

  it.each(PLACES.map((p) => [p.listing.name, p] as const))('%s: the centre is APG GIS\'s movePin_, and the ring the brief\'s', (_name, place) => {
    const w = setUp();
    const reply = ring(w, place.listing.id);
    const wide = isWarehouse(place.listing.category);
    const [lat, lng] = apgPin(place.lat, place.lng, place.listing.id, wide, SECRET);

    expect(reply['ok']).toBe(true);
    expect(reply['center']).toEqual([lng, lat]);
    expect(reply['ring']).toEqual(ellipseRing(highlightOf(reply)));
  });

  it('is closed: 129 points, the last the first again', () => {
    const w = setUp();
    const points = ring(w, CASA.id)['ring'] as LngLat[];

    expect(points).toHaveLength(129);
    expect(points[128]).toEqual(points[0]);
    expect(new Set(points.slice(0, 128).map((p) => p.join(','))).size).toBe(128);
    for (const p of points) {
      expect(p).toHaveLength(2);
      expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
    }
  });

  it('is the same every time, for anyone, and in another execution', () => {
    const first = ring(setUp(), CASA.id);
    const w = setUp();

    expect(ring(w, CASA.id)).toEqual(first);
    expect(ring(w, CASA.id, 'maria')).toEqual(first);
    w.project.cache.clear();
    expect(ring(w, CASA.id)).toEqual(first);
  });

  it('moves with the secret: another secret, another centre', () => {
    const ours = ring(setUp(), CASA.id);
    const theirs = ring(setUp(PLACES, 'another-secret'), CASA.id);

    expect(theirs['ok']).toBe(true);
    expect(theirs['center']).not.toEqual(ours['center']);
    const [lat, lng] = apgPin(14.586213, 121.176147, CASA.id, false, 'another-secret');
    expect(theirs['center']).toEqual([lng, lat]);
  });

  it('reads PIN_SECRET as APG GIS\'s, without stray spaces around it', () => {
    expect(ring(setUp(PLACES, `  ${SECRET}\n`), CASA.id)).toEqual(ring(setUp(), CASA.id));
  });

  it('is the same size wherever the point is: the size never gives the point away', () => {
    const here = ring(setUp([{ listing: CASA, lat: 14.586213, lng: 121.176147 }]), CASA.id);
    const there = ring(setUp([{ listing: CASA, lat: 10.3157, lng: 123.8854 }]), CASA.id);

    expect(there['center']).not.toEqual(here['center']);
    expect([there['semiMinor'], there['semiMajor'], there['tilt']]).toEqual([here['semiMinor'], here['semiMajor'], here['tilt']]);
  });

  it('sends nothing but the ring, its centre, its size and its tilt: never the exact point', () => {
    const w = setUp();
    const text = w.project.postText({ action: 'locationRing', id: CASA.id, key: 'key-jan' });
    const reply = JSON.parse(text) as Reply;

    expect(Object.keys(reply).sort()).toEqual(['center', 'ok', 'ring', 'semiMajor', 'semiMinor', 'tilt']);
    expect(text).not.toContain('14.586213');
    expect(text).not.toContain('121.176147');
    expect(text).not.toContain('14.5862,');
    expect(text).not.toContain('121.1761,');
    expect(text).not.toMatch(/lat|lng|point|size|kind/i);
  });

  describe('its size', () => {
    const at = (category: string, size: string): Reply => {
      const listing: Listing = { ...LOT_9, id: 'F-x', name: 'X', docId: 'D-x', category };
      return ring(setUp([{ listing, lat: 14.6, lng: 120.5, size }]), 'F-x');
    };

    it('a building reaches 40 m: 220 + 40 + 50', () => {
      expect(at('OFFICE SPACE', '85.5')['semiMinor']).toBe(310);
      expect(at('CONDO / HOUSE AND LOT', '787,374')['semiMinor']).toBe(310);
      expect(at('COMMERCIAL SPACE', '')['semiMinor']).toBe(310);
    });

    it('land reaches as far as a circle of its area, from the checker\'s Size', () => {
      // 787,374 sqm reaches 500.6 m: APG moves a lot's pin up to 220 m, as it has no land kind.
      expect(at('LOT', '787,374')['semiMinor']).toBe(Math.ceil(220 + Math.sqrt(787374 / Math.PI) + 50));
      expect(at('LOT ONLY', '2.5 ha')['semiMinor']).toBe(Math.ceil(220 + Math.sqrt(25000 / Math.PI) + 50));
      expect(at('Raw land', '12,000 sqm')['semiMinor']).toBe(Math.ceil(220 + Math.sqrt(12000 / Math.PI) + 50));
    });

    it('a warehouse too, from its 550 m', () => {
      expect(at('WAREHOUSE', '150-245, 30,000')['semiMinor']).toBe(Math.ceil(550 + Math.sqrt(30395 / Math.PI) + 50));
    });

    it('never less than one building', () => {
      expect(at('LOT', '120')['semiMinor']).toBe(310);
      expect(at('WAREHOUSE', '2,500 m2')['semiMinor']).toBe(640);
    });

    it.each([[''], ['n/a'], ['0'], ['TBA'], ['99999999999']])('a size it can\'t read (%j) reaches 500 m, to err large', (size) => {
      expect(at('LOT', size)['semiMinor']).toBe(220 + 500 + 50);
      expect(at('WAREHOUSE', size)['semiMinor']).toBe(550 + 500 + 50);
    });

    it('and when the checker can\'t be read', () => {
      const w = setUp();
      w.project.web.fail(w.checkerUrl);
      w.project.cache.clear();

      expect(ring(w, LOT_9.id)['semiMinor']).toBe(220 + 500 + 50);
      expect(ring(w, CASA.id)['semiMinor']).toBe(310);
    });

    it('the long axis is 1.25 to 1.65 times the short one', () => {
      for (const p of PLACES) {
        const r = ring(setUp(), p.listing.id);
        const ratio = (r['semiMajor'] as number) / (r['semiMinor'] as number);
        expect(ratio).toBeGreaterThanOrEqual(1.25);
        expect(ratio).toBeLessThanOrEqual(1.65 + 1 / (r['semiMinor'] as number));
      }
    });
  });

  it('holds the exact point and the whole lot, for many ids, kinds, sizes and places', () => {
    // A seeded generator: the same listings on every run.
    let seed = 0x5eed;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    const CATEGORIES = ['CONDO / HOUSE AND LOT', 'COMMERCIAL SPACE', 'OFFICE SPACE', 'WAREHOUSE', 'LOT', 'LOT ONLY', 'Condo', 'House & Lot'];
    const SIZES: readonly (readonly [string, number | null])[] = [
      ['', null], ['120', 120], ['787,374', 787374], ['2.5 ha', 25000], ['150-245', 395], ['160.63, 370', 530.63], ['n/a', null],
    ];
    const places: (Place & { readonly sqm: number | null })[] = [];
    for (let i = 0; i < 300; i++) {
      const category = pick(CATEGORIES);
      let [size, sqm] = pick(SIZES);
      if (random() < 0.4) {
        sqm = Math.round(random() * 3_000_000) + 1;
        size = sqm.toLocaleString('en-US');
      }
      const id = `F-${Math.floor(random() * 1e12).toString(36)}-${i}`;
      places.push({
        listing: { ...CASA, id, name: `Listing ${i}`, docId: `D-${i}`, category },
        lat: 5 + random() * 14,
        lng: 117 + random() * 9.5,
        size,
        sqm,
      });
    }
    const w = setUp(places);

    for (const p of places) {
      const lot = isWarehouse(p.listing.category) || /^LOT/.test(p.listing.category);
      const reach = !lot ? 40 : p.sqm === null ? 500 : Math.max(40, Math.sqrt(p.sqm / Math.PI));
      const reply = ring(w, p.listing.id);
      const h = highlightOf(reply);
      const exact: LngLat = [p.lng, p.lat];
      const where = `${p.listing.id} (${p.listing.category}, ${p.size})`;

      expect(reply['ok'], where).toBe(true);
      expect(h, where).toEqual(highlight(p.listing.id, p.lat, p.lng, p.listing.category, reach));
      expect(inside(h, exact), where).toBe(true);
      expect(insideRing(reply['ring'] as LngLat[], h.center, exact), where).toBe(true);
      // The lot, as a circle of its reach around the point: inside the ring as drawn.
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI;
        const edge = shift(exact, reach * Math.sin(a), reach * Math.cos(a));
        expect(insideRing(reply['ring'] as LngLat[], h.center, edge), `${where}, edge ${k}`).toBe(true);
      }
      // Never the point itself at the centre.
      expect(Math.hypot(...metres(exact, h.center)), where).toBeGreaterThan(70);
    }
  });

  // ---------------------------------------------------------------- refusals

  it('is refused, with reason no-secret, when PIN_SECRET is not set, and never makes one', () => {
    for (const secret of [null, '', '   ']) {
      const w = setUp(PLACES, secret);
      const reply = ring(w, CASA.id);

      expect(reply).toEqual({
        ok: false,
        reason: 'no-secret',
        error: "The location map isn't set up yet. Ask your admin.",
        message: "The location map isn't set up yet. Ask your admin.",
      });
      expect(w.project.properties.get('PIN_SECRET') ?? '').toBe(secret ?? '');
    }
  });

  it('is refused, with reason no-position, when the listing has no position', () => {
    const w = setUp(PLACES, SECRET, (p) => p.listing !== TOWER);

    expect(ring(w, TOWER.id)).toEqual({
      ok: false,
      reason: 'no-position',
      error: 'This listing has no map position yet.',
      message: 'This listing has no map position yet.',
    });
    expect(ring(w, CASA.id)['ok']).toBe(true);
  });

  it('or when the geocoding sheet is missing', () => {
    const w = createWorld();
    w.project.properties.set('PIN_SECRET', SECRET);

    expect(ring(w, CASA.id)).toMatchObject({ ...REFUSED, reason: 'no-position' });
    w.project.configure({ GEO_SHEET_ID: 'missing' });
    w.project.cache.clear();
    expect(ring(w, CASA.id)).toMatchObject({ ...REFUSED, reason: 'no-position' });
  });

  it('or when its position is not a number inside the Philippines', () => {
    const w = setUp([{ listing: CASA, lat: 35.68, lng: 139.69 }]);

    expect(ring(w, CASA.id)).toMatchObject({ ...REFUSED, reason: 'no-position' });
  });

  it('is refused, with reason not-found, for a folder the directory does not have', () => {
    const w = setUp();

    expect(ring(w, 'F-nowhere')).toMatchObject({ ...REFUSED, reason: 'not-found', error: "That listing isn't in the directory." });
  });

  it('needs an id, and a key that works', () => {
    const w = setUp();

    expect(w.call('jan', 'locationRing')).toEqual({ ok: false, error: 'missing: id' });
    expect(ring(w, ` ${CASA.id} `)).toEqual(ring(w, CASA.id));
    expect(w.call('gone', 'locationRing', { id: CASA.id })).toMatchObject({ ok: false, error: 'unauthorized' });
  });
});
