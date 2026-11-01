import { planForIntern, planQueues, type PlanForInternInput, type PlanInput } from './planner';
import type { DirectoryRow } from './summary';
import type { Assignment, PostLogEntry } from './types';

const DATE = '2026-11-02';
const RULES = { cooldownDays: 7, repostDueDays: 14 };

function prop(id: string, over: Partial<DirectoryRow> = {}): DirectoryRow {
  return {
    id,
    name: `Listing ${id}`,
    category: 'CONDO',
    listingType: 'FOR SALE',
    subCategory: '',
    photoCount: 3,
    hasIssues: false,
    ...over,
  };
}

function posted(propertyId: string, date: string, over: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    date,
    time: '09:00',
    type: 'Group post',
    title: `Listing ${propertyId}`,
    status: 'Posted',
    fbAccount: 'APG Homes',
    postLink: 'https://fb.com/1',
    postedBy: 'Jan',
    propertyId,
    ...over,
  };
}

function queuedFor(assignedTo: string, propertyId: string, over: Partial<Assignment> = {}): Assignment {
  return { date: DATE, assignedTo, propertyName: `Listing ${propertyId}`, propertyId, status: 'Not Shared', ...over };
}

function plan(over: Partial<PlanInput>) {
  return planQueues({
    properties: [],
    posts: [],
    assignments: [],
    interns: ['Jan'],
    perIntern: 20,
    date: DATE,
    rules: RULES,
    keepExisting: false,
    ...over,
  });
}

const ids = (items: readonly { propertyId?: string | undefined }[] | undefined) => (items ?? []).map((i) => i.propertyId);

describe('planning queues', () => {
  it('never gives one listing to two interns', () => {
    const properties = Array.from({ length: 50 }, (_, i) => prop(`P${i}`, { category: `C${i % 4}` }));
    const result = plan({ properties, interns: ['Jan', 'Bea', 'Mia'], perIntern: 10 });
    const all = [...result.queues.values()].flatMap((q) => ids(q));

    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);
    expect(result.shortBy).toBe(0);
  });

  it('skips and counts each reason', () => {
    const properties = [
      prop('sold', { availability: 'Sold' }),
      prop('nosep', { hasIssues: true, issues: 'No separator · No photos' }),
      prop('flagged', { hasIssues: true }), // cannot tell which issue: not skipped
      prop('queued'),
      prop('queued2', { name: 'Queued By Name' }),
      prop('recent'),
      prop('old'),
      prop('fresh', { availability: 'Available' }),
    ];
    const result = plan({
      properties,
      posts: [posted('recent', '2026-10-30'), posted('old', '2026-10-01'), posted('', '2026-11-01', { title: 'queued by name' })],
      assignments: [queuedFor('Bea', 'queued'), queuedFor('Bea', '', { propertyName: 'QUEUED BY NAME' })],
    });

    expect(result.skipped).toEqual([
      { reason: 'sold', count: 1 },
      { reason: 'noSeparator', count: 1 },
      { reason: 'held', count: 2 },
      { reason: 'cooldown', count: 1 },
    ]);
    expect(ids(result.queues.get('Jan'))).toEqual(['flagged', 'fresh', 'old']);
  });

  it("reads BuildDirectory.gs's own Issues wording for no separator and no document, in any case", () => {
    const result = plan({
      properties: [
        prop('sep', { hasIssues: true, issues: 'No separator line — the whole document is treated as postable. Check it. · No photos' }),
        prop('sepUpper', { hasIssues: true, issues: 'NO SEPARATOR LINE — the whole document is treated as postable.' }),
        prop('nodoc', { hasIssues: true, issues: 'No document · No photos' }),
        prop('nodocLower', { hasIssues: true, issues: 'no document' }),
        prop('photos', { hasIssues: true, issues: 'No photos' }),
        prop('empty', { hasIssues: true, issues: 'Document is empty above the separator' }),
      ],
    });

    expect(result.skipped).toEqual([
      { reason: 'noSeparator', count: 2 },
      { reason: 'noDocument', count: 2 },
    ]);
    expect(ids(result.queues.get('Jan'))).toEqual(['empty', 'photos']);
  });

  it('counts a pending post toward the cooldown, and lets one outside it through', () => {
    const result = plan({
      properties: [prop('a'), prop('b')],
      posts: [posted('a', '2026-10-27', { status: 'Pending' }), posted('b', '2026-10-26')],
    });
    expect(result.skipped).toEqual([{ reason: 'cooldown', count: 1 }]);
    expect(ids(result.queues.get('Jan'))).toEqual(['b']);
  });

  it('puts never-posted first, then the oldest last post, then by name', () => {
    const properties = [
      prop('x1', { name: 'Zeta' }),
      prop('x2', { name: 'Alpha' }),
      prop('x3', { name: 'Mid' }),
      prop('x4', { name: 'Old' }),
      prop('x5', { name: 'Older' }),
    ];
    const posts = [
      posted('x3', '2026-10-01'),
      posted('x4', '2026-09-01'),
      posted('x4', '2026-10-20'), // its latest counts
      posted('x5', '2026-08-01'),
    ];
    const result = plan({ properties, posts });
    expect(ids(result.queues.get('Jan'))).toEqual(['x2', 'x1', 'x5', 'x3', 'x4']);
  });

  it('gives each intern a mix of categories', () => {
    const properties = [
      ...Array.from({ length: 10 }, (_, i) => prop(`a${i}`, { name: `A ${i}`, category: 'CONDO' })),
      ...Array.from({ length: 10 }, (_, i) => prop(`b${i}`, { name: `B ${i}`, category: 'LOT' })),
      ...Array.from({ length: 10 }, (_, i) => prop(`c${i}`, { name: `C ${i}`, category: 'COMMERCIAL' })),
    ];
    const one = plan({ properties, perIntern: 6 });
    expect(ids(one.queues.get('Jan'))).toEqual(['a0', 'b0', 'c0', 'a1', 'b1', 'c1']);

    const three = plan({ properties, interns: ['Jan', 'Bea', 'Mia'], perIntern: 3 });
    for (const queue of three.queues.values()) {
      const categories = new Set(ids(queue).map((id) => id![0]));
      expect(categories.size).toBe(3);
    }
  });

  it('says how short it fell when there are not enough listings', () => {
    const properties = Array.from({ length: 25 }, (_, i) => prop(`P${i}`));
    const result = plan({ properties, interns: ['Jan', 'Bea'], perIntern: 20 });
    const sizes = [...result.queues.values()].map((q) => q.length);

    expect(sizes.reduce((a, b) => a + b, 0)).toBe(25);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1); // shared, not first come
    expect(result.shortBy).toBe(15);
  });

  it('keeps existing queues first and counts them toward the target', () => {
    const properties = Array.from({ length: 10 }, (_, i) => prop(`P${i}`));
    const assignments = [
      queuedFor('Jan', 'P5', { status: 'Posted' }),
      queuedFor('Jan', 'P7'),
      queuedFor('Jan', 'P1', { date: '2026-11-01', status: 'Posted' }), // another day, posted: no effect
    ];
    const kept = plan({ properties, assignments, perIntern: 4, keepExisting: true });
    expect(kept.queues.get('Jan')).toEqual([
      { propertyName: 'Listing P5', propertyId: 'P5', status: 'Posted' },
      { propertyName: 'Listing P7', propertyId: 'P7', status: 'Not Shared' },
      { propertyName: 'Listing P0', propertyId: 'P0' },
      { propertyName: 'Listing P1', propertyId: 'P1' },
    ]);

    const replaced = plan({ properties, assignments, perIntern: 4, keepExisting: false });
    expect(ids(replaced.queues.get('Jan'))).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(replaced.skipped).toEqual([]);
  });

  it('keeps an older "To post" item as Not Shared, the same thing', () => {
    const properties = [prop('P1'), prop('P2')];
    const old = queuedFor('Jan', 'P1', { status: 'To post' as Assignment['status'] });
    const kept = plan({ properties, assignments: [old], perIntern: 2, keepExisting: true });
    expect(kept.queues.get('Jan')).toEqual([
      { propertyName: 'Listing P1', propertyId: 'P1', status: 'Not Shared' },
      { propertyName: 'Listing P2', propertyId: 'P2' },
    ]);
  });

  it('gives an intern already at the target nothing more', () => {
    const result = plan({
      properties: [prop('a'), prop('b')],
      assignments: [queuedFor('Jan', 'a')],
      perIntern: 1,
      keepExisting: true,
    });
    expect(ids(result.queues.get('Jan'))).toEqual(['a']);
    expect(result.shortBy).toBe(0);
  });

  it('is deterministic whatever order the rows come in', () => {
    const properties = Array.from({ length: 200 }, (_, i) =>
      prop(`P${i}`, { name: `Listing ${i % 37} ${i}`, category: `C${i % 5}` }),
    );
    const posts = Array.from({ length: 100 }, (_, i) => posted(`P${i * 2}`, `2026-0${(i % 9) + 1}-1${i % 10}`));
    const first = plan({ properties, posts, interns: ['Jan', 'Bea', 'Mia'] });
    const again = plan({ properties: [...properties].reverse(), posts: [...posts].reverse(), interns: ['Jan', 'Bea', 'Mia'] });
    expect([...again.queues]).toEqual([...first.queues]);
    expect(again.shortBy).toBe(first.shortBy);
  });

  it('plans 1,500 listings for 20 interns in under 200ms', () => {
    const categories = ['CONDO', 'LOT', 'COMMERCIAL SPACE', 'HOUSE AND LOT', 'WAREHOUSE', 'OFFICE'];
    const properties = Array.from({ length: 1500 }, (_, i) =>
      prop(`F${i}`, {
        name: `Sunrise Homes Blk. ${i % 40}, Lt ${i}`,
        category: categories[i % categories.length]!,
        ...(i % 50 === 0 ? { availability: 'Sold' as const } : {}),
        ...(i % 70 === 0 ? { hasIssues: true, issues: 'No separator' } : {}),
      }),
    );
    const posts = Array.from({ length: 8000 }, (_, i) =>
      posted(i % 3 === 0 ? '' : `F${(i * 7) % 1500}`, `2026-${String((i % 10) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, {
        title: `Sunrise Homes Block ${i % 40} Lot ${(i * 7) % 1500}`,
      }),
    );
    const interns = Array.from({ length: 20 }, (_, i) => `Intern ${i}`);
    const assignments = Array.from({ length: 100 }, (_, i) => queuedFor(interns[i % 20]!, `F${i * 3}`));

    const start = performance.now();
    const result = plan({ properties, posts, assignments, interns, keepExisting: true });
    const took = performance.now() - start;

    const all = [...result.queues.values()].flatMap((q) => ids(q));
    expect(new Set(all).size).toBe(all.length);
    expect(took).toBeLessThan(200);
  });

  it('refuses a date that is not yyyy-MM-dd', () => {
    expect(() => plan({ date: '11/2/2026' })).toThrow();
  });
});

describe('held listings in the plan (v5)', () => {
  it('skips a listing held by anyone on any date, the intern being planned included, as held', () => {
    const properties = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => prop(id));
    const result = plan({
      properties,
      interns: ['Jan'],
      assignments: [
        queuedFor('Bea', 'A', { date: '2026-10-20' }), // Bea's, weeks ago, still open
        queuedFor('Jan', 'B', { date: '2026-11-05' }), // Jan's own, another day
        queuedFor('Bea', '', { propertyName: 'listing c', date: '2026-10-01', status: 'To post' as Assignment['status'] }),
        queuedFor('Bea', 'D', { date: '2026-10-20', status: 'Posted' }), // released
        queuedFor('Bea', 'E', { date: '2026-10-20', status: 'Pending' }), // released
      ],
    });

    expect(ids(result.queues.get('Jan'))).toEqual(['D', 'E', 'F']);
    expect(result.skipped).toEqual([{ reason: 'held', count: 3 }]);
  });

  it("frees the planned intern's own rows for the date when they are replaced, not when kept", () => {
    const properties = [prop('A'), prop('B')];
    const assignments = [queuedFor('Jan', 'A')];

    expect(ids(plan({ properties, assignments, perIntern: 2 }).queues.get('Jan'))).toEqual(['A', 'B']);
    const kept = plan({ properties, assignments, perIntern: 2, keepExisting: true });
    expect(ids(kept.queues.get('Jan'))).toEqual(['A', 'B']);
    expect(kept.skipped).toEqual([{ reason: 'held', count: 1 }]);
  });
});

describe('planForIntern (Assign 20)', () => {
  function forIntern(over: Partial<PlanForInternInput>) {
    return planForIntern({
      properties: [],
      posts: [],
      assignments: [],
      intern: 'Jan',
      count: 20,
      date: DATE,
      rules: RULES,
      ...over,
    });
  }

  const properties = [
    prop('c1', { category: 'CONDO' }),
    prop('c2', { category: 'CONDO' }),
    prop('c3', { category: 'CONDO' }),
    prop('w1', { category: 'WAREHOUSE' }),
    prop('w2', { category: 'Warehouse' }),
    prop('l1', { category: 'LOT' }),
  ];
  const posts = [
    posted('c1', '2026-09-01'),
    posted('w1', '2026-08-01'),
    posted('l1', '2026-10-01'),
    posted('c3', '2026-10-30'), // in cooldown
  ];

  it('puts never posted first, then the longest since posted, with a mix of categories', () => {
    const picked = forIntern({ properties, posts });

    // Categories by their best listing: CONDO (c2, never), WAREHOUSE (w2, never), LOT.
    expect(ids(picked)).toEqual(['c2', 'w2', 'l1', 'c1', 'w1']);
    expect(picked[0]).toEqual({ propertyName: 'Listing c2', propertyId: 'c2' });
  });

  it('takes at most count', () => {
    expect(ids(forIntern({ properties, posts, count: 2 }))).toEqual(['c2', 'w2']);
    expect(forIntern({ properties, posts, count: 0 })).toEqual([]);
  });

  it('takes one category alone, in priority order, compared as names are', () => {
    expect(ids(forIntern({ properties, posts, category: 'warehouse' }))).toEqual(['w2', 'w1']);
    expect(ids(forIntern({ properties, posts, category: 'Condo', count: 1 }))).toEqual(['c2']);
  });

  it('skips held listings, the day\'s other queues, its own queue and what is excluded', () => {
    const picked = forIntern({
      properties,
      posts,
      assignments: [
        queuedFor('Bea', 'c2', { date: '2026-10-01' }), // held by Bea
        queuedFor('Mia', 'w2', { status: 'Posted' }), // in Mia's queue that day
        queuedFor('Jan', 'l1', { status: 'Pending' }), // already in Jan's queue that day
      ],
      exclude: [{ propertyName: 'Listing c1' }], // on screen, not saved yet
    });
    expect(ids(picked)).toEqual(['w1']);
  });

  it('refuses a date that is not yyyy-MM-dd', () => {
    expect(() => forIntern({ date: '11/2/2026' })).toThrow();
  });
});
