import { describe, expect, it } from 'vitest';
import { cityOf, fitMap, guessPosition, MAP_ASPECT, plotPoints, project, PH_BOUNDS } from './geo';
import { greetingFor, longDay, startupStats } from './words';
import type { User } from '@/core/types';

describe('the projection (lat/lng → x/y)', () => {
  const frame = { x: 10, y: 20, width: 210, height: 300 };

  it('puts the north-west corner top left and the south-east corner bottom right', () => {
    expect(project(PH_BOUNDS.north, PH_BOUNDS.west, frame)).toEqual({ x: 10, y: 20 });
    expect(project(PH_BOUNDS.south, PH_BOUNDS.east, frame)).toEqual({ x: 220, y: 320 });
  });

  it('is linear in both directions (equirectangular)', () => {
    const middle = project((PH_BOUNDS.north + PH_BOUNDS.south) / 2, (PH_BOUNDS.west + PH_BOUNDS.east) / 2, frame);
    expect(middle.x).toBeCloseTo(115);
    expect(middle.y).toBeCloseTo(170);
    // Manila sits west of the middle and north of it.
    const manila = project(14.5995, 120.9842, frame);
    expect(manila.x).toBeCloseTo(10 + ((120.9842 - 116.5) / 10.5) * 210);
    expect(manila.y).toBeCloseTo(20 + ((19.5 - 14.5995) / 15) * 300);
  });

  it('fits the largest frame of the map\'s shape, centred', () => {
    expect(MAP_ASPECT).toBeCloseTo(10.5 / 15);
    const tall = fitMap(683, 745);
    expect(tall.height).toBeCloseTo(745);
    expect(tall.width).toBeCloseTo(745 * MAP_ASPECT);
    expect(tall.x).toBeCloseTo((683 - tall.width) / 2);
    expect(tall.y).toBe(0);

    const narrow = fitMap(300, 745);
    expect(narrow.width).toBeCloseTo(300);
    expect(narrow.height).toBeCloseTo(300 / MAP_ASPECT);
    expect(narrow.y).toBeCloseTo((745 - narrow.height) / 2);

    expect(fitMap(0, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('the city fallback', () => {
  it('finds the city word in a listing name, whatever its accents and punctuation', () => {
    expect(cityOf('Kapitolyo Ground Floor Retail, Pasig')).toEqual({ lat: 14.5764, lng: 121.0851 });
    expect(cityOf('3BR Townhouse in Las Piñas')).toEqual({ lat: 14.4445, lng: 120.9939 });
    expect(cityOf('Lot for sale, Sta. Rosa, Laguna')).toEqual({ lat: 14.3122, lng: 121.1114 });
    expect(cityOf('Warehouse — Parañaque')).toEqual(cityOf('warehouse paranaque'));
    expect(cityOf('BGC Uptown Office 18F')).toEqual({ lat: 14.5509, lng: 121.0503 });
  });

  it('matches whole words only', () => {
    expect(cityOf('Imusan Heights')).toBeNull();
    expect(cityOf('Manilaview Tower')).toBeNull();
  });

  it('prefers the place named last, then the longest spelling', () => {
    expect(cityOf('San Jose del Monte house')).toEqual({ lat: 14.8139, lng: 121.0453 });
    expect(cityOf('Near Makati, in Mandaluyong')).toEqual({ lat: 14.5794, lng: 121.0359 });
  });

  it('jitters each listing a little around its city, the same way every time', () => {
    const a = guessPosition({ id: 'A', name: 'Office, Makati' })!;
    const b = guessPosition({ id: 'B', name: 'Office, Makati' })!;
    expect(a).toEqual(guessPosition({ id: 'A', name: 'Office, Makati' }));
    expect(a).not.toEqual(b);
    for (const p of [a, b]) {
      expect(Math.abs(p.lat - 14.5547)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(p.lng - 121.0244)).toBeLessThanOrEqual(0.03);
    }
  });

  it("uses the checker's City before the name", () => {
    const p = guessPosition({ id: 'A', name: 'Unit 12B, Tower 3', city: 'Cebu City' })!;
    expect(Math.abs(p.lat - 10.3157)).toBeLessThanOrEqual(0.03);
  });
});

describe('plotPoints', () => {
  it("uses the geocoding sheet's positions when any listing has one, and only those", () => {
    const points = plotPoints([
      { id: 'A', name: 'Somewhere, Makati', lat: 10.3, lng: 123.9 },
      { id: 'B', name: 'Office, Pasig' },
    ]);
    expect(points.map((p) => [p.id, p.lat, p.lng])).toEqual([['A', 10.3, 123.9]]);
  });

  it('falls back to the cities, leaving out listings that name none', () => {
    const points = plotPoints([
      { id: 'A', name: 'Office, Pasig' },
      { id: 'B', name: 'Somewhere nobody knows' },
      { id: 'C', name: 'Condo, Cebu' },
    ]);
    expect(points.map((p) => p.id)).toEqual(['A', 'C']);
  });

  it('is empty when nothing can be placed', () => {
    expect(plotPoints([{ id: 'B', name: 'Somewhere nobody knows' }])).toEqual([]);
    expect(plotPoints([])).toEqual([]);
  });

  it('varies the dots a little: size 0–1, opacity 0.4–0.95', () => {
    const points = plotPoints(Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, name: 'Makati' })));
    for (const p of points) {
      expect(p.size).toBeGreaterThanOrEqual(0);
      expect(p.size).toBeLessThan(1);
      expect(p.opacity).toBeGreaterThanOrEqual(0.4);
      expect(p.opacity).toBeLessThanOrEqual(0.95);
    }
    expect(new Set(points.map((p) => p.size.toFixed(2))).size).toBeGreaterThan(20);
  });
});

describe('the greeting', () => {
  const at = (manila: string) => Date.parse(`${manila}+08:00`);

  it('says morning, afternoon or evening by the clock in Manila, with the first name', () => {
    expect(greetingFor(at('2026-11-01T05:00:00'), 'Maria Santos')).toBe('Good morning, Maria');
    expect(greetingFor(at('2026-11-01T11:59:00'), 'Maria Santos')).toBe('Good morning, Maria');
    expect(greetingFor(at('2026-11-01T12:00:00'), 'Maria Santos')).toBe('Good afternoon, Maria');
    expect(greetingFor(at('2026-11-01T17:59:00'), 'Jan Dela Cruz')).toBe('Good afternoon, Jan');
    expect(greetingFor(at('2026-11-01T18:00:00'), 'Jan Dela Cruz')).toBe('Good evening, Jan');
    expect(greetingFor(at('2026-11-01T23:30:00'), 'Jan Dela Cruz')).toBe('Good evening, Jan');
  });

  it('dates the day in Manila, whatever the zone of this PC', () => {
    expect(longDay(at('2026-11-01T00:30:00'))).toBe('Sunday, 1 November'); // still 31 Oct in UTC
    expect(longDay(at('2026-10-31T10:00:00'))).toBe('Saturday, 31 October');
  });
});

describe('the cards', () => {
  const NOW = Date.parse('2026-10-31T10:00:00+08:00');
  const admin: User = { name: 'Maria Santos', role: 'Admin', fbAccounts: [] };
  const intern: User = { name: 'Jan Dela Cruz', role: 'Intern', fbAccounts: [] };
  const post = (date: string, status: 'Posted' | 'Pending', postedBy: string) => ({
    date, status, postedBy, time: '10:00', type: '', title: 'x', fbAccount: '', postLink: '', propertyId: '',
  });
  const posts = [
    post('2026-10-30', 'Posted', 'Jan Dela Cruz'),
    post('2026-10-30', 'Posted', 'Paolo Reyes'),
    post('2026-10-30', 'Pending', 'Jan Dela Cruz'),
    post('2026-10-29', 'Posted', 'Jan Dela Cruz'),
    post('2026-10-31', 'Pending', 'Paolo Reyes'),
  ];
  const assignments = [
    { date: '2026-10-31', assignedTo: 'Jan Dela Cruz', propertyName: 'a', propertyId: 'a', status: 'Not Shared' as const },
    { date: '2026-10-31', assignedTo: 'Jan Dela Cruz', propertyName: 'b', propertyId: 'b', status: 'Pending' as const },
    { date: '2026-10-31', assignedTo: 'Jan Dela Cruz', propertyName: 'c', propertyId: 'c', status: 'Posted' as const },
    { date: '2026-10-30', assignedTo: 'Jan Dela Cruz', propertyName: 'd', propertyId: 'd', status: 'Not Shared' as const },
  ];

  it("gives an admin the listings, everyone's posts yesterday and everyone's pending", () => {
    expect(startupStats({ user: admin, listings: 1474, posts, assignments: null, now: NOW })).toEqual([
      { label: 'listings', value: 1474 },
      { label: 'posted yesterday', value: 2 },
      { label: 'pending', value: 2 },
    ]);
  });

  it('gives an intern their queue today, and their own posts yesterday and pending', () => {
    expect(startupStats({ user: intern, listings: 1474, posts, assignments, now: NOW })).toEqual([
      { label: 'in your queue today', value: 2 },
      { label: 'posted yesterday', value: 1 },
      { label: 'pending', value: 1 },
    ]);
  });

  it('gives nobody signed in only the listings, and nothing without a list', () => {
    expect(startupStats({ user: null, listings: 1474, posts: null, assignments: null, now: NOW })).toEqual([
      { label: 'listings', value: 1474 },
    ]);
    expect(startupStats({ user: null, listings: null, posts: null, assignments: null, now: NOW })).toEqual([]);
  });

  it('leaves a number out (null) until it has been read', () => {
    expect(startupStats({ user: intern, listings: null, posts: null, assignments: null, now: NOW }).map((s) => s.value)).toEqual([
      null,
      null,
      null,
    ]);
  });
});
