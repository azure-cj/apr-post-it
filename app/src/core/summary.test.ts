import { describe, expect, it } from 'vitest';
import { lastPostedOn } from './cooldown';
import {
  activeInterns,
  addDays,
  ago,
  assignRules,
  daysBetween,
  docHealth,
  firstName,
  internDays,
  isDate,
  lastPostOf,
  longDate,
  matchPasted,
  moveEntry,
  newestFirst,
  pastedLines,
  peopleIn,
  plural,
  postingProblem,
  readIssues,
  sameQueue,
  samePerson,
  searchProperties,
  shortDate,
  summarizeDay,
  type HealthSource,
  type TeamMember,
} from './summary';
import type { Assignment, AssignmentStatus, PostLogEntry, PostStatus, Property } from './types';

// TestApp.Today in the C# tests: Thu 29 Oct 2026.
const TODAY = '2026-10-29';
const TOMORROW = '2026-10-30';
const JAN = 'Jan Dela Cruz';
const MIKA = 'Mika Reyes';
const BEA = 'Bea Lim';
const RULES = { cooldownDays: 7, repostDueDays: 14 };

/** TestApp.AddProperty: the C# id was "Category/Name". */
function property(name: string, category = 'Lot'): Property {
  return { id: `${category}/${name}`, name, category, listingType: '', subCategory: '', photoCount: 4, hasIssues: false };
}

interface PostOptions {
  readonly status?: PostStatus;
  readonly by?: string;
  readonly time?: string;
  readonly account?: string;
  readonly id?: string;
}

/** TestApp.AddPost: a row logged `daysAgo` days before today, by Jan at 09:00 unless said. */
function post(title: string, daysAgo: number, o: PostOptions = {}): PostLogEntry {
  const status = o.status ?? 'Posted';
  return {
    date: addDays(TODAY, -daysAgo),
    time: o.time ?? '09:00',
    type: 'Lot',
    title,
    status,
    fbAccount: o.account ?? 'APG Homes Cavite',
    postLink: status === 'Posted' ? `https://www.facebook.com/groups/test/posts/${daysAgo}${title.length}/` : '',
    postedBy: o.by ?? JAN,
    propertyId: o.id ?? '',
  };
}

/** ManagerTestKit.SetQueue: a saved queue, in posting order. */
function queue(who: string, date: string, ...items: (readonly [string, AssignmentStatus])[]): Assignment[] {
  return items.map(([propertyName, status]) => ({ date, assignedTo: who, propertyName, propertyId: '', status }));
}

const TEAM: readonly TeamMember[] = [
  { name: 'Maria Santos', role: 'Admin' },
  { name: JAN, role: 'Intern' },
  { name: MIKA, role: 'Intern' },
];

// ------------------------------------------------------------------ dates and words

describe('dates and words', () => {
  it('counts whole calendar days across a month end, a year end and a leap day', () => {
    expect(addDays(TODAY, 1)).toBe(TOMORROW);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays(TODAY, -29)).toBe('2026-09-30');
    expect(daysBetween('2026-10-27', TODAY)).toBe(2);
    expect(daysBetween(TODAY, '2026-10-27')).toBe(-2);
  });

  it('says dates in English, the way the screens show them', () => {
    expect(longDate(TODAY)).toBe('Thu 29 Oct 2026');
    expect(longDate(TOMORROW)).toBe('Fri 30 Oct 2026');
    expect(shortDate('2026-11-03')).toBe('Tue 3 Nov');
  });

  it('knows a real yyyy-MM-dd day from anything else', () => {
    expect(isDate(TODAY)).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('29/10/2026')).toBe(false);
    expect(isDate('')).toBe(false);
    expect(() => addDays('soon', 1)).toThrow(/yyyy-MM-dd/);
  });

  it('names people and counts things plainly', () => {
    expect(firstName('Jan Dela Cruz')).toBe('Jan');
    expect(firstName('  Mika  ')).toBe('Mika');
    expect(samePerson(' jan dela cruz', 'Jan Dela Cruz ')).toBe(true);
    expect(samePerson('Jan', 'Jan Dela Cruz')).toBe(false);
    expect(plural(1, 'listing', 'listings')).toBe('1 listing');
    expect(plural(1474, 'listing', 'listings')).toBe('1,474 listings');
    expect(plural(0, 'listing', 'listings')).toBe('0 listings');
    expect(ago(0)).toBe('today');
    expect(ago(-2)).toBe('today');
    expect(ago(1)).toBe('1 day ago');
    expect(ago(32)).toBe('32 days ago');
  });
});

// ------------------------------------------------------------------ the post history

describe('the post history', () => {
  it('agrees with cooldown.ts on every listing, ids or no ids', () => {
    const properties: Property[] = [
      property('Verdant Hills Lot 12'),
      { ...property('Casa Amara House & Lot'), id: 'folder-casa' },
      { ...property('Old Name Tower'), id: 'folder-renamed', name: 'New Name Tower' },
      { ...property('No Id Lot 4'), id: '' },
      property('Never Posted Lot 1'),
    ];
    const posts: PostLogEntry[] = [
      post('Verdant Hills Lot 12', 20),
      post('verdant hills lot 12', 3, { status: 'Pending' }),
      post('Casa Amara House and Lot', 9),
      post('Casa Amara House & Lot', 2, { id: 'some-other-folder' }),
      post('Old Name Tower', 1, { id: 'folder-renamed' }),
      post('No Id Lot 4', 5, { id: 'anything' }),
      post('No Id Lot 4', 8),
      { ...post('Verdant Hills Lot 12', 0), date: '2026-02-30' },
      { ...post('Verdant Hills Lot 12', 0), date: '' },
    ];
    for (const p of properties) expect(lastPostOf(posts, p)?.date, p.name).toBe(lastPostedOn(posts, p));
    expect(lastPostOf(posts, properties[2]!)?.date).toBe(addDays(TODAY, -1)); // a renamed folder keeps its history
    expect(lastPostOf(posts, properties[1]!)?.date).toBe(addDays(TODAY, -9)); // another folder's row is not this one's
  });

  it('picks the latest row, and the later one in the sheet on a tie', () => {
    const posts = [post('A Lot', 2, { time: '10:00', by: JAN }), post('A Lot', 2, { time: '15:30', by: MIKA }), post('A Lot', 2, { time: '15:30', by: BEA })];
    expect(lastPostOf(posts, property('A Lot'))?.postedBy).toBe(BEA);
    expect(newestFirst(posts).map((p) => p.postedBy)).toEqual([BEA, MIKA, JAN]);
  });
});

// ------------------------------------------------------------------ the day (TrackerServiceTests)

describe('summarizeDay — ported from TrackerServiceTests', () => {
  it('summarises the day', () => {
    const properties = [
      'Verdant Hills Lot 12', 'Verdant Hills Lot 3', 'Mabini Commercial Space', 'Seaside Residences 2BR',
      'Sta. Rosa Lot 22', 'Antipolo Ridge Lot 18', 'Casa Amara House & Lot',
    ].map((name) => property(name));
    const posts = [
      post('Verdant Hills Lot 12', 26),
      post('Verdant Hills Lot 3', 21),
      post('Mabini Commercial Space', 32),
      post('Mabini Commercial Space', 45),
      post('Antipolo Ridge Lot 18', 0, { time: '11:36', by: MIKA }),
      post('Verdant Hills Lot 3', 0, { time: '10:17' }),
      post('Casa Amara House & Lot', 0, { status: 'Pending', time: '10:31' }),
      post('Casa Amara House & Lot', 3, { status: 'Pending', time: '15:00', by: BEA }),
    ];
    const assignments = [
      ...queue(JAN, TODAY, ['Casa Amara House & Lot', 'Pending'], ['Verdant Hills Lot 3', 'Posted'], ['Seaside Residences 2BR', 'To post']),
      ...queue(MIKA, TODAY, ['Antipolo Ridge Lot 18', 'Posted']),
      ...queue(BEA, TOMORROW, ['Sta. Rosa Lot 22', 'To post']),
    ];
    const team = [...TEAM, { name: BEA, role: 'Intern' as const }, { name: 'Aaron Idle', role: 'Intern' as const }];

    const d = summarizeDay({ date: TODAY, posts, assignments, properties, team, settings: RULES });

    expect(d.date).toBe(TODAY);
    expect(d.postedToday).toBe(2);
    expect(d.pending).toBe(2); // every Pending row, any date
    expect(d.posts.map((p) => p.time).join(',')).toBe('11:36,10:31,10:17');

    expect(d.interns.map((i) => `${i.name}:${i.total}/${i.posted}/${i.pending}/${i.toPost}`).join(',')).toBe(
      'Jan Dela Cruz:3/1/1/1,Mika Reyes:1/1/0/0,Aaron Idle:0/0/0/0,Bea Lim:0/0/0/0',
    );
    expect(d.interns.map((i) => i.done)).toEqual([false, true, false, false]);
    expect(d.internsAssigned).toBe(2);
    expect(d.internsDone).toBe(1);

    // Never posted first by name, with whose queue has it; then due, longest since first.
    expect(d.neverPosted.map((a) => `${a.property.name}|${a.queuedFor ?? 'not assigned'}`)).toEqual([
      'Seaside Residences 2BR|Jan Dela Cruz',
      'Sta. Rosa Lot 22|not assigned', // Bea has it tomorrow, not today
    ]);
    expect(d.dueForRepost.map((a) => `${a.property.name}|${a.daysSince}`)).toEqual([
      'Mabini Commercial Space|32',
      'Verdant Hills Lot 12|26',
    ]);
    expect(d.dueForRepost[0]?.lastPosted).toBe('2026-09-27');
    expect(d.repostDueDays).toBe(14);
  });

  it('lists every listing as never posted when the tracker is empty, and only interns', () => {
    const d = summarizeDay({
      date: TODAY,
      posts: [],
      assignments: [],
      properties: [property('B Lot'), property('A Lot')],
      team: TEAM,
      settings: RULES,
    });

    expect(d.postedToday).toBe(0);
    expect(d.internsAssigned).toBe(0);
    expect(d.interns.map((i) => i.name)).toEqual([JAN, MIKA]); // interns only, by name
    expect(d.neverPosted.map((a) => a.property.name)).toEqual(['A Lot', 'B Lot']);
    expect(d.dueForRepost).toEqual([]);
  });

  it('still shows someone with a queue who is not on the team list, and leaves out a revoked intern without one', () => {
    const d = summarizeDay({
      date: TODAY,
      posts: [],
      assignments: queue('Paolo Santos', TODAY, ['A Lot', 'To post']),
      properties: [property('A Lot')],
      team: [...TEAM, { name: 'Gone Intern', role: 'Intern', active: false }],
      settings: RULES,
    });
    expect(d.interns.map((i) => i.name)).toEqual(['Paolo Santos', JAN, MIKA]);
    expect(d.neverPosted[0]?.queuedFor).toBe('Paolo Santos');
  });
});

describe('summarizeDay — the tracker screen (TrackerViewModelTests)', () => {
  const properties = [
    'Verdant Hills Lot 12', 'Verdant Hills Lot 3', 'Mabini Commercial Space', 'Seaside Residences 2BR',
    'Sta. Rosa Lot 22', 'Antipolo Ridge Lot 18', 'Casa Amara House & Lot', 'Greenfield Farm Lot',
    'Imus Townhomes Phase 2', 'Lakeshore Villas Unit 7',
  ].map((name) => property(name));
  const posts = [
    post('Verdant Hills Lot 12', 26),
    post('Verdant Hills Lot 3', 21),
    post('Mabini Commercial Space', 32),
    post('Antipolo Ridge Lot 18', 0, { time: '11:36', by: MIKA, account: 'APG Properties PH' }),
    post('Verdant Hills Lot 3', 0, { time: '10:17' }),
    post('Casa Amara House & Lot', 0, { status: 'Pending', time: '10:31' }),
  ];
  const assignments = [
    ...queue(JAN, TODAY, ['Casa Amara House & Lot', 'Pending'], ['Verdant Hills Lot 3', 'Posted'], ['Seaside Residences 2BR', 'To post']),
    ...queue(MIKA, TODAY, ['Antipolo Ridge Lot 18', 'Posted']),
  ];
  const team = [...TEAM, { name: BEA, role: 'Intern' as const }];
  const day = (date: string, extra: PostLogEntry[] = []) =>
    summarizeDay({ date, posts: [...posts, ...extra], assignments, properties, team, settings: RULES });

  it('gives the numbers for the tiles', () => {
    const d = day(TODAY);
    expect([d.postedToday, d.pending, d.internsDone, d.internsAssigned]).toEqual([2, 1, 1, 2]);
    expect(d.dueForRepost.length).toBe(2);
    expect(d.neverPosted.length).toBe(5);
  });

  it("lists the day's rows newest first, pending ones without a link", () => {
    const [posted, pending] = day(TODAY).posts;
    expect(posted?.title).toBe('Antipolo Ridge Lot 18');
    expect(posted?.postedBy).toBe(MIKA);
    expect(posted?.fbAccount).toBe('APG Properties PH');
    expect(posted?.postLink).not.toBe('');
    expect(pending?.status).toBe('Pending');
    expect(pending?.postLink).toBe('');
  });

  it("shows each intern's progress: assigned first, done when nothing is left", () => {
    const [jan, mika, bea] = day(TODAY).interns;
    expect(jan).toEqual({ name: JAN, total: 3, posted: 1, pending: 1, toPost: 1, done: false });
    expect(mika).toEqual({ name: MIKA, total: 1, posted: 1, pending: 0, toPost: 0, done: true });
    expect(bea).toEqual({ name: BEA, total: 0, posted: 0, pending: 0, toPost: 0, done: false });
  });

  it('lists what needs attention: never posted by name, then due longest first', () => {
    const d = day(TODAY);
    expect(d.neverPosted.map((a) => a.property.name)).toEqual([
      'Greenfield Farm Lot', 'Imus Townhomes Phase 2', 'Lakeshore Villas Unit 7', 'Seaside Residences 2BR', 'Sta. Rosa Lot 22',
    ]);
    expect(d.neverPosted[3]?.queuedFor).toBe(JAN);
    expect(d.neverPosted[0]?.queuedFor).toBeUndefined();
    expect(d.dueForRepost.map((a) => `${a.property.name} ${a.daysSince}`)).toEqual(['Mabini Commercial Space 32', 'Verdant Hills Lot 12 26']);
  });

  it('shows another day as that day', () => {
    const yesterday = day('2026-10-28', [post('Mabini Commercial Space', 1, { time: '16:05', by: MIKA })]);
    expect(yesterday.posts.map((p) => p.time)).toEqual(['16:05']);
    expect(yesterday.postedToday).toBe(1);
    expect(yesterday.internsAssigned).toBe(0);

    const tomorrow = day(TOMORROW);
    expect(tomorrow.posts).toEqual([]);
    expect(tomorrow.postedToday).toBe(0);
  });

  it('gives an empty day plainly', () => {
    const d = summarizeDay({ date: TODAY, posts: [], assignments: [], properties: [], team: TEAM, settings: RULES });
    expect(d.posts).toEqual([]);
    expect(d.neverPosted).toEqual([]);
    expect(d.dueForRepost).toEqual([]);
    expect(d.interns[0]?.total).toBe(0);
  });
});

// ------------------------------------------------------------------ building a queue (AssignmentServiceTests)

/** ManagerTestKit.NewApp: Lot 12 due (20 days), Lot 7 in cooldown (2 days), Lot 3 recent (10 days), Seaside and Casa Amara never. */
const LISTINGS: readonly Property[] = [
  property('Casa Amara House & Lot', 'House & Lot'),
  property('Seaside Residences 2BR', 'Condo'),
  property('Verdant Hills Lot 3'),
  property('Verdant Hills Lot 7'),
  property('Verdant Hills Lot 12'),
];
const HISTORY: readonly PostLogEntry[] = [post('Verdant Hills Lot 12', 20), post('Verdant Hills Lot 7', 2), post('Verdant Hills Lot 3', 10)];
const named = (name: string): Property => LISTINGS.find((p) => p.name === name)!;

function rules(intern: string, date: string, assignments: readonly Assignment[] = [], posts: readonly PostLogEntry[] = HISTORY) {
  return assignRules({ intern, date, today: TODAY, posts, assignments, properties: LISTINGS, settings: RULES });
}

describe('assignRules — ported from AssignmentServiceTests', () => {
  it('starts the draft from the saved queue: pending first, then to post in order, then posted', () => {
    const assignments = [
      ...queue(JAN, TODAY,
        ['Verdant Hills Lot 3', 'Posted'],
        ['Seaside Residences 2BR', 'To post'],
        ['Casa Amara House & Lot', 'Pending'],
        ['Verdant Hills Lot 12', 'To post'],
        ['Folder Since Deleted', 'To post']),
      ...queue(MIKA, TODAY, ['Verdant Hills Lot 7', 'To post']),
    ];

    const r = rules('jan dela cruz', TODAY, assignments);

    expect(r.saved.map((e) => e.propertyName).join(',')).toBe(
      'Casa Amara House & Lot,Seaside Residences 2BR,Verdant Hills Lot 12,Folder Since Deleted,Verdant Hills Lot 3',
    );
    expect(r.saved[0]?.property?.id).toBe('House & Lot/Casa Amara House & Lot');
    expect(r.saved[3]?.property).toBeUndefined(); // its folder has gone
    expect(r.saved.map((e) => r.statusOf(e.key))).toEqual(['Pending', 'To post', 'To post', 'To post', 'Posted']);
    expect(r.saved.map((e) => r.isStarted(e.key))).toEqual([true, false, false, false, true]);
    expect(rules(JAN, TOMORROW, assignments).saved).toEqual([]);
  });

  it('explains why a listing can or cannot be added', () => {
    const r = rules(JAN, TODAY, queue(MIKA, TODAY, ['Seaside Residences 2BR', 'To post']));

    const never = r.check(named('Casa Amara House & Lot'));
    expect(never).toMatchObject({ canAdd: true, due: true, reason: '' });
    expect(never.lastPost).toBeUndefined();

    const due = r.check(named('Verdant Hills Lot 12'));
    expect(due).toMatchObject({ canAdd: true, due: true });
    expect(due.lastPost?.date).toBe('2026-10-09');

    const recent = r.check(named('Verdant Hills Lot 3'));
    expect(recent).toMatchObject({ canAdd: true, due: false });
    expect(recent.lastPost?.date).toBe('2026-10-19');

    const cooling = r.check(named('Verdant Hills Lot 7'));
    expect(cooling).toMatchObject({ canAdd: false, block: 'cooldown', nextAllowed: '2026-11-03', daysLeft: 5 });
    expect(cooling.reason).toBe('Posted 2 days ago by Jan. It can go in a queue from Tue 3 Nov.');

    const taken = r.check(named('Seaside Residences 2BR'));
    expect(taken).toMatchObject({ canAdd: false, block: 'otherQueue', holder: MIKA });
    expect(taken.reason).toBe("Already in Mika's queue for Thu 29 Oct.");

    expect(rules(MIKA, TODAY, queue(MIKA, TODAY, ['Seaside Residences 2BR', 'To post'])).check(named('Seaside Residences 2BR')).canAdd).toBe(true); // her own queue
    expect(rules(JAN, TOMORROW, queue(MIKA, TODAY, ['Seaside Residences 2BR', 'To post'])).check(named('Seaside Residences 2BR')).canAdd).toBe(true); // another day
  });

  it("judges the cooldown against the queue's day, and says when it was posted against today", () => {
    const fourDaysOn = rules(JAN, addDays(TODAY, 4)).check(named('Verdant Hills Lot 7'));
    expect(fourDaysOn).toMatchObject({ canAdd: false, nextAllowed: '2026-11-03', daysLeft: 1 });
    expect(fourDaysOn.reason).toBe('Posted 2 days ago by Jan. It can go in a queue from Tue 3 Nov.');

    const free = rules(JAN, addDays(TODAY, 5)).check(named('Verdant Hills Lot 7'));
    expect(free).toMatchObject({ canAdd: true, due: false, reason: '' });
  });

  it("names the other intern in full when they share a first name with this one's", () => {
    const r = rules(JAN, TODAY, queue('Jan Reyes', TODAY, ['Seaside Residences 2BR', 'To post']));
    expect(r.check(named('Seaside Residences 2BR')).reason).toBe("Already in Jan Reyes's queue for Thu 29 Oct.");
  });

  it('gives search results with their check', () => {
    const r = rules(JAN, TODAY);
    const found = searchProperties(LISTINGS, 'verdant');
    expect(found.map((p) => `${p.name}:${r.check(p).canAdd}`).join(',')).toBe(
      'Verdant Hills Lot 3:true,Verdant Hills Lot 7:false,Verdant Hills Lot 12:true',
    );
    expect(r.check(found[1]!).block).toBe('cooldown');
  });

  it('cleans, matches and checks a pasted list', () => {
    const pasted =
      '1. Verdant Hills Lot 12\r\n2) verdant hils lot 3\n- Nonexistent Place\n\n   \n• Verdant Hills Lot 12\n* Casa Amara House and Lot\n– Verdant Hills Lot 7\n';

    const matches = matchPasted(pasted, LISTINGS);

    expect(matches.map((m) => m.typed).join('|')).toBe(
      'Verdant Hills Lot 12|verdant hils lot 3|Nonexistent Place|Casa Amara House and Lot|Verdant Hills Lot 7',
    );
    expect(matches.map((m) => m.kind).join(',')).toBe('exact,suggestion,notFound,exact,exact');
    expect(matches[1]?.property?.name).toBe('Verdant Hills Lot 3');
    expect(matches[2]?.property).toBeUndefined();
    expect(matches[3]?.property?.name).toBe('Casa Amara House & Lot');

    const r = rules(JAN, TODAY);
    expect(r.check(matches[3]!.property!).canAdd).toBe(true);
    expect(r.check(matches[4]!.property!).block).toBe('cooldown');
  });

  it('never suggests a listing with a different lot number', () => {
    const [match] = matchPasted('Verdant Hills Lot 13', LISTINGS);
    expect(match?.kind).toBe('notFound');
  });

  it('keeps saved statuses, adds new items as to post, and drops removed ones', () => {
    const assignments = [
      ...queue(MIKA, TODAY, ['Verdant Hills Lot 3', 'To post']),
      ...queue(JAN, TODAY, ['Verdant Hills Lot 7', 'Posted'], ['Seaside Residences 2BR', 'To post']),
    ];
    const r = rules(JAN, TODAY, assignments);

    const result = r.validate(
      ['casa amara house & lot', 'Verdant Hills Lot 12', 'Verdant Hills Lot 7', 'Verdant Hills Lot 12', ' '].map(r.entryNamed),
    );

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.items.map((i) => `${i.propertyName}:${i.status}`).join(',')).toBe(
      'Casa Amara House & Lot:To post,Verdant Hills Lot 12:To post,Verdant Hills Lot 7:Posted',
    );
    expect(result.items[0]?.propertyId).toBe('House & Lot/Casa Amara House & Lot');
  });

  it("refuses unknown names, listings in their cooldown, and someone else's", () => {
    const r = rules(JAN, TODAY, queue(MIKA, TODAY, ['Seaside Residences 2BR', 'To post']));

    const unknown = r.validate(['Verdant Hills Lot 12', 'Nowhere Lot 1 '].map(r.entryNamed));
    expect(unknown.ok).toBe(false);
    expect(unknown.problems).toEqual(['No listing is called “Nowhere Lot 1”. Check the spelling, or find it by searching.']);

    expect(r.validate([r.entryNamed('Verdant Hills Lot 7')]).problems).toEqual([
      "Verdant Hills Lot 7 can't go in this queue. Posted 2 days ago by Jan. It can go in a queue from Tue 3 Nov.",
    ]);
    expect(r.validate([r.entryNamed('Seaside Residences 2BR')]).problems).toEqual([
      "Seaside Residences 2BR can't go in this queue. Already in Mika's queue for Thu 29 Oct.",
    ]);
  });

  it('saves the status the sheet has now, not the one the draft started with', () => {
    const before = rules(JAN, TODAY, queue(JAN, TODAY, ['Verdant Hills Lot 12', 'To post']));
    const draft = [...before.saved];
    // Meanwhile Jan posts it: the sheet says Posted.
    const after = rules(JAN, TODAY, queue(JAN, TODAY, ['Verdant Hills Lot 12', 'Posted']), [...HISTORY, post('Verdant Hills Lot 12', 0)]);
    expect(after.validate(draft).items.map((i) => i.status)).toEqual(['Posted']);
  });
});

describe('the draft — ported from AssignViewModelTests', () => {
  it("judges a candidate against the queue's day: tomorrow by default", () => {
    const r = rules(JAN, TOMORROW, queue(MIKA, TOMORROW, ['Seaside Residences 2BR', 'To post']));
    expect(r.check(named('Verdant Hills Lot 7'))).toMatchObject({ canAdd: false, daysLeft: 4, nextAllowed: '2026-11-03' });
    expect(r.check(named('Seaside Residences 2BR')).reason).toBe("Already in Mika's queue for Fri 30 Oct.");
    expect(rules(JAN, '2026-10-31').check(named('Verdant Hills Lot 7')).daysLeft).toBe(3);
  });

  it('reorders with up and down, and never past either end', () => {
    const r = rules(JAN, TOMORROW);
    const draft = ['Seaside Residences 2BR', 'Verdant Hills Lot 12', 'Verdant Hills Lot 3'].map((n) => r.entryFor(named(n)));
    const names = (list: readonly { propertyName: string }[]) => list.map((e) => e.propertyName).join(',');

    const down = moveEntry(draft, 0, 1);
    expect(names(down)).toBe('Verdant Hills Lot 12,Seaside Residences 2BR,Verdant Hills Lot 3');
    const up = moveEntry(down, 2, 1);
    expect(names(up)).toBe('Verdant Hills Lot 12,Verdant Hills Lot 3,Seaside Residences 2BR');
    expect(names(moveEntry(up, 0, -1))).toBe(names(up));
    expect(names(moveEntry(up, 2, 3))).toBe(names(up));
    expect(moveEntry(up, 0, 0)).not.toBe(up); // a copy, never the same array
  });

  it('is dirty when the names or their order differ from the saved queue', () => {
    const r = rules(JAN, TOMORROW, queue(JAN, TOMORROW, ['Seaside Residences 2BR', 'To post'], ['Verdant Hills Lot 12', 'To post']));
    expect(sameQueue(r.saved, [...r.saved])).toBe(true);
    const swapped = moveEntry(r.saved, 0, 1);
    expect(sameQueue(r.saved, swapped)).toBe(false); // order counts
    expect(sameQueue(r.saved, moveEntry(swapped, 0, 1))).toBe(true);
    expect(sameQueue(r.saved, [...r.saved, r.entryFor(named('Verdant Hills Lot 3'))])).toBe(false);
  });

  it('finds the same listing by its folder id however it was added', () => {
    const r = rules(JAN, TOMORROW, queue(JAN, TOMORROW, ['seaside residences 2br', 'To post']));
    expect(r.saved[0]?.key).toBe(r.entryFor(named('Seaside Residences 2BR')).key);
    expect(r.entryNamed('Seaside Residences 2BR').key).toBe(r.saved[0]?.key);
  });
});

describe('pastedLines', () => {
  it('drops numbers, bullets and blank lines, and keeps a number that is part of the name', () => {
    expect(pastedLines('1. A\n2) B\n- C\n* D\n• E\n– F\n— G\n\n  \n10.H\n1.5 Hectare Farm Lot\n3 Bedroom Condo')).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', '1.5 Hectare Farm Lot', '3 Bedroom Condo',
    ]);
    expect(pastedLines('')).toEqual([]);
  });
});

describe('peopleIn', () => {
  it('names everyone who has had a queue or logged a post, once each', () => {
    const names = peopleIn(
      [...queue(MIKA, TODAY, ['A', 'To post']), ...queue('jan dela cruz', TOMORROW, ['B', 'To post'])],
      [post('A', 1, { by: JAN }), post('B', 2, { by: BEA }), post('C', 3, { by: ' ' })],
    );
    expect(names).toEqual([BEA, 'jan dela cruz', MIKA]);
  });
});

// ------------------------------------------------------------------ doc health

describe('doc health', () => {
  it("reads the directory's Issues column, worst first", () => {
    expect(readIssues('No document · No photos')).toEqual([
      { kind: 'noDocument', text: 'No document' },
      { kind: 'noPhotos', text: 'No photos' },
    ]);
    expect(readIssues('No photos · No separator line — the whole document is treated as postable. Check it.').map((i) => i.kind)).toEqual([
      'noSeparator',
      'noPhotos',
    ]);
    expect(readIssues('Could not read document: Word file — enable the Drive advanced service, or save it as a Google Doc')).toEqual([
      { kind: 'wordFile', text: 'Could not read document: Word file — enable the Drive advanced service, or save it as a Google Doc' },
    ]);
    expect(readIssues('Document is empty above the separator\nCould not open folder: Access denied')).toEqual([
      { kind: 'other', text: 'Document is empty above the separator · Could not open folder: Access denied' },
    ]);
    expect(readIssues('')).toEqual([]);
    expect(readIssues('  ·  ')).toEqual([]);
  });

  it('groups listings by problem, worst first, each by name, saying what else is wrong', () => {
    const rows: HealthSource[] = [
      { id: '1', name: 'Casa Amara House & Lot', category: 'CONDO / HOUSE AND LOT', issues: 'No photos' },
      { id: '2', name: 'Verdant Hills Lot 7', category: 'COMMERCIAL SPACE', issues: 'No separator line — the whole document is treated as postable. Check it. · No photos' },
      { id: '3', name: 'Mabini Commercial Space', category: 'COMMERCIAL SPACE', issues: 'No document · No photos' },
      { id: '4', name: 'Sta. Rosa Lot 22', category: 'WAREHOUSE', issues: 'Could not read document: Word file — save it as a Google Doc' },
      { id: '5', name: 'Antipolo Ridge Lot 18', category: 'OFFICE SPACE', issues: 'Document is empty above the separator' },
      { id: '6', name: 'Seaside Residences 2BR', category: 'OFFICE SPACE', issues: '' },
      { id: '7', name: 'Greenfield Farm Lot', category: 'WAREHOUSE', hasIssues: true },
      { id: '8', name: 'Lakeshore Villas Unit 7', category: 'WAREHOUSE', hasIssues: false, issues: '   ' },
    ];

    const health = docHealth(rows);

    expect(health.groups.map((g) => `${g.kind}: ${g.items.map((i) => i.name).join(', ')}`)).toEqual([
      'noSeparator: Verdant Hills Lot 7',
      'noDocument: Mabini Commercial Space',
      'wordFile: Sta. Rosa Lot 22',
      'other: Antipolo Ridge Lot 18, Greenfield Farm Lot',
      'noPhotos: Casa Amara House & Lot, Mabini Commercial Space, Verdant Hills Lot 7',
    ]);
    expect(health.listings).toBe(6);
    expect(health.blocked).toBe(3);
    expect(health.groups[0]?.items[0]?.also).toEqual(['noPhotos']);
    expect(health.groups[4]?.items[2]?.also).toEqual(['noSeparator']);
    expect(health.groups[3]?.items[1]?.detail).toBe(''); // flagged, but the list did not say why
  });

  it('works from the list as it is today, where only the flag says something is wrong', () => {
    const health = docHealth([{ ...property('A Lot'), hasIssues: true }, property('B Lot')]);
    expect(health.listings).toBe(1);
    expect(health.blocked).toBe(0);
    expect(health.groups.map((g) => g.kind)).toEqual(['other']);
  });

  it("says what stops a listing being posted, and nothing for a problem that doesn't", () => {
    expect(postingProblem({ issues: 'No photos · No separator line — the whole document is treated as postable. Check it.' })).toBe('noSeparator');
    expect(postingProblem({ issues: 'No document · No photos' })).toBe('noDocument');
    expect(postingProblem({ issues: 'Could not read document: Word file — save it as a Google Doc' })).toBe('wordFile');
    expect(postingProblem({ issues: 'No photos' })).toBeUndefined();
    expect(postingProblem({ issues: 'Document is empty above the separator' })).toBeUndefined();
    expect(postingProblem(property('A Lot'))).toBeUndefined(); // the list as it is today: no Issues text
  });

  it('has nothing to say about a healthy library', () => {
    expect(docHealth([property('A Lot')])).toEqual({ groups: [], listings: 0, blocked: 0 });
  });
});

describe('the team, for the sidebar', () => {
  const team: readonly TeamMember[] = [
    { name: MIKA, role: 'Intern' },
    { name: 'Maria Santos', role: 'Admin' },
    { name: 'Paolo Reyes', role: 'Intern', active: false },
    { name: BEA, role: 'Intern' },
    { name: JAN, role: 'Intern' },
    { name: ' jan dela cruz ', role: 'Intern' },
  ];

  it('lists the active interns once each, by name', () => {
    expect(activeInterns(team)).toEqual([BEA, JAN, MIKA]);
    expect(activeInterns([])).toEqual([]);
  });

  it("counts each intern's queue on the day and their posts waiting for a link", () => {
    const assignments = [
      ...queue(JAN, TODAY, ['A', 'Posted'], ['B', 'Posted'], ['C', 'Pending'], ['D', 'To post'], ['E', 'To post']),
      ...queue(MIKA, TOMORROW, ['F', 'To post']),
      ...queue('paolo reyes', TODAY, ['G', 'Posted']),
    ];
    const posts = [
      post('C', 0, { status: 'Pending' }),
      post('H', 3, { status: 'Pending', by: 'mika reyes' }),
      post('A', 0),
    ];
    expect(internDays(team, assignments, posts, TODAY)).toEqual([
      { name: BEA, total: 0, posted: 0, pendingPosts: 0 },
      { name: JAN, total: 5, posted: 2, pendingPosts: 1 },
      { name: MIKA, total: 0, posted: 0, pendingPosts: 1 },
    ]);
  });
});
