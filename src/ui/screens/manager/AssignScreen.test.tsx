// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError, type Assignment, type PostLogEntry } from '@/core/types';
import type { DirectoryRow, TeamWeekRow } from '@/core/summary';
import { AppShell, routerFuture } from '../../App';
import { AppStateProvider } from '../../state/AppState';
import { EXEC, fakeServer, intern as janUser, manager } from '../../state/testing';
import { AssignScreen, type AssignScreenProps, type QueueSave } from './index';
import { cardOrder, cardStatus } from './AssignPicker';
import { stepCount } from './AssignLibrary';

// Wednesday of the week 26–30 Oct.
const TODAY = '2026-10-28';
const WEEK = '2026-10-26';
const LAST_WEEK = '2026-10-19';
const NEXT_WEEK = '2026-11-02';
const JAN = 'Jan Dela Cruz';
const MIKA = 'Mika Reyes';
const BEA = 'Bea Lim';
const DANA = 'Dana Uy';

function listing(id: string, name: string, category: string, extra: Partial<DirectoryRow> = {}): DirectoryRow {
  return { id, name, category, listingType: 'FOR SALE', subCategory: '', photoCount: 5, hasIssues: false, ...extra };
}

const CONDO = 'CONDO / HOUSE AND LOT';
const LIBRARY: readonly DirectoryRow[] = [
  listing('f1', 'Verdant Hills Lot 12', CONDO),
  listing('f2', 'Verdant Hills Lot 7', CONDO),
  listing('f3', 'Casa Amara House & Lot', CONDO, { city: 'Tagaytay', size: '320' }),
  listing('f4', 'Seaside Residences 2BR', CONDO),
  listing('f5', 'Sta. Rosa Lot 22', CONDO),
  listing('w1', 'Valenzuela Warehouse A', 'WAREHOUSE'),
  listing('w2', 'Meycauayan Warehouse B', 'WAREHOUSE'),
  listing('w3', 'Calamba Warehouse C', 'WAREHOUSE'),
  listing('o1', 'BGC Office 18F', 'OFFICE SPACE'),
  listing('o2', 'Ortigas Office 9F', 'OFFICE SPACE'),
  listing('o3', 'Alabang Office 3F', 'OFFICE SPACE'),
  listing('k1', 'Kapitolyo Retail', 'COMMERCIAL SPACE', { availability: 'Sold' }),
  listing('k2', 'Makati Retail', 'COMMERCIAL SPACE', { hasIssues: true, issues: 'No separator line' }),
];

const link = (n: number) => `https://www.facebook.com/groups/x/posts/${n}/`;

function post(date: string, title: string, propertyId: string, status: PostLogEntry['status'] = 'Posted', n = 1): PostLogEntry {
  return { date, time: '14:20', type: 'Warehouse', title, status, fbAccount: 'APG Main', postLink: link(n), postedBy: JAN, propertyId };
}

const POSTS: readonly PostLogEntry[] = [
  // Yesterday, waiting for the group's approval: in its cooldown.
  post('2026-10-27', 'Verdant Hills Lot 7', 'f2', 'Pending', 7),
  post('2026-10-27', 'Ortigas Office 9F', 'o2', 'Posted', 9),
  // Long ago: due for repost.
  post('2026-10-01', 'Calamba Warehouse C', 'w3', 'Posted', 3),
  // Last week, eight days ago: out of its cooldown.
  post('2026-10-20', 'Valenzuela Warehouse A', 'w1', 'Posted', 1),
];

const row = (week: string, assignedTo: string, propertyName: string, propertyId: string, status: Assignment['status'] = 'Not Shared'): Assignment => ({
  date: week,
  week,
  assignedTo,
  propertyName,
  propertyId,
  status,
});

const ASSIGNMENTS: readonly Assignment[] = [
  row(WEEK, MIKA, 'Seaside Residences 2BR', 'f4'),
  row(WEEK, MIKA, 'BGC Office 18F', 'o1'),
  row(WEEK, JAN, 'Verdant Hills Lot 12', 'f1'),
  row(WEEK, JAN, 'Sta. Rosa Lot 22', 'f5'),
  row(WEEK, JAN, 'Verdant Hills Lot 7', 'f2', 'Pending'),
  row(WEEK, JAN, 'Ortigas Office 9F', 'o2', 'Posted'),
  row(WEEK, DANA, 'Alabang Office 3F', 'o3', 'Posted'),
  // Last week: one posted, two missed. Missed rows hold nothing any more.
  row(LAST_WEEK, JAN, 'Valenzuela Warehouse A', 'w1', 'Posted'),
  row(LAST_WEEK, JAN, 'Meycauayan Warehouse B', 'w2'),
  row(LAST_WEEK, JAN, 'Calamba Warehouse C', 'w3'),
];

type Overrides = Partial<AssignScreenProps>;

/** The screen as the shell would hold it: intern and week are the shell's. */
function Harness(props: Overrides & { onSaveSpy?: (save: QueueSave) => void }) {
  const [intern, setIntern] = useState<string | null>(props.intern === undefined ? JAN : props.intern);
  const [week, setWeek] = useState(props.week ?? WEEK);
  return (
    <AssignScreen
      interns={[DANA, BEA, MIKA, JAN]}
      today={TODAY}
      properties={LIBRARY}
      posts={POSTS}
      assignments={ASSIGNMENTS}
      settings={{ cooldownDays: 7, repostDueDays: 14, perWeek: 40 }}
      onSave={async (save) => {
        props.onSaveSpy?.(save);
      }}
      {...props}
      intern={intern}
      week={week}
      onInternChange={(name) => {
        props.onInternChange?.(name);
        setIntern(name);
      }}
      onWeekChange={(monday) => {
        props.onWeekChange?.(monday);
        setWeek(monday);
      }}
    />
  );
}

const queueNames = () =>
  Array.from(document.querySelectorAll('.assign-queue .queue-row__name')).map((n) => n.textContent);
const groupNames = (name: string) =>
  Array.from(screen.getByRole('region', { name }).querySelectorAll('.queue-row__name')).map((n) => n.textContent);
const listNames = () =>
  Array.from(document.querySelectorAll('.lib__list .lib-row__name')).map((n) => n.textContent?.replace("Can't add: ", ''));
const libRow = (name: string) =>
  Array.from(document.querySelectorAll('.lib__list .lib-row')).find((li) => li.querySelector('.lib-row__name')?.textContent?.endsWith(name)) as HTMLElement;
const chip = (name: RegExp | string) => within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name });
const weekShown = () => document.querySelector('.week-picker__label')?.textContent;

async function filter(name: string) {
  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  await userEvent.click(screen.getByRole('checkbox', { name }));
  await userEvent.keyboard('{Escape}');
}

afterEach(cleanup);

describe('Assign, step one: the interns this week', () => {
  it('shows each intern with the week’s progress and one word, those behind first', async () => {
    const onInternChange = vi.fn();
    render(<Harness intern={null} onInternChange={onInternChange} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Assign');
    expect(weekShown()).toBe('26–30 Oct');

    const cards = within(screen.getByRole('list', { name: 'Agents' })).getAllByRole('button');
    expect(cards.map((c) => c.querySelector('.assign-pick__name')?.textContent)).toEqual([JAN, MIKA, BEA, DANA]);
    expect(cards.map((c) => c.querySelector('.pill')?.textContent)).toEqual(['Behind', 'Not started', 'No queue', 'Done']);
    // Posted and pending against the week's queue: Ortigas posted, Lot 7 pending, two to go.
    expect(cards[0]?.querySelector('.assign-pick__count')?.textContent).toContain('2 / 4');
    expect(cards[3]?.querySelector('.assign-pick__count')?.textContent).toContain('1 / 1');
    // Nothing else is said on a card.
    expect(cards[0]?.textContent).not.toMatch(/FB|not shared|today/i);

    await userEvent.click(cards[0]!);
    expect(onInternChange).toHaveBeenCalledWith(JAN);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(JAN);
  });

  it('sorts every status: behind, not started, missed, no queue, on track, done', () => {
    const r = (name: string, pace: TeamWeekRow['pace'], target = 5): TeamWeekRow => ({
      name,
      pace,
      target,
      posted: 0,
      pending: 0,
      notShared: target,
      missed: 0,
      daysLeft: 3,
      expectedByToday: 3,
      byDay: [0, 0, 0, 0, 0],
    });
    const rows = [r('a', 'done'), r('b', 'on-track'), r('c', 'on-track', 0), r('d', 'missed'), r('e', 'not-started'), r('f', 'behind')];
    expect(cardOrder(rows).map(cardStatus)).toEqual(['behind', 'not-started', 'missed', 'no-queue', 'on-track', 'done']);
  });

  it('shows the cards for another week', async () => {
    render(<Harness intern={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Week before' }));
    expect(weekShown()).toBe('19–23 Oct');
    const cards = within(screen.getByRole('list', { name: 'Agents' })).getAllByRole('button');
    expect(cards[0]?.querySelector('.assign-pick__name')?.textContent).toBe(JAN);
    expect(cards[0]?.querySelector('.pill')?.textContent).toBe('Missed');
  });
});

describe('Assign, the week picker and the link', () => {
  function Spy({ onPath }: { onPath: (path: string) => void }) {
    const location = useLocation();
    onPath(location.pathname + location.search);
    return null;
  }
  const week = (path: string) => new URLSearchParams(path.split('?')[1]).get('week');

  function renderShell(now: number, at = '/assign', platform = fakeServer()) {
    let path = '';
    render(
      <AppStateProvider platform={platform} initialUser={manager} initialSettings={{ scriptUrl: EXEC }} now={() => now}>
        <MemoryRouter initialEntries={[at]} future={routerFuture}>
          <AppShell />
          <Spy onPath={(p) => (path = p)} />
        </MemoryRouter>
      </AppStateProvider>,
    );
    return () => path;
  }

  it('opens on this week on a weekday, and keeps the week and the intern in the link', async () => {
    // Wednesday 28 Oct, 10:00 in Manila.
    const path = renderShell(Date.parse('2026-10-28T02:00:00Z'));
    const list = await screen.findByRole('list', { name: 'Agents' });
    expect(weekShown()).toBe('26–30 Oct');
    expect(screen.getByRole('button', { name: 'This week' }).getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(await within(list).findByRole('button', { name: new RegExp(janUser.name) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(janUser.name);
    expect(new URLSearchParams(path().split('?')[1]).get('intern')).toBe(janUser.name);
    expect(week(path())).toBe(WEEK);
    expect(screen.getByText('Due Fri 30 Oct')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(week(path())).toBe(NEXT_WEEK);
    expect(weekShown()).toBe('2–6 Nov');
    await userEvent.click(screen.getByRole('button', { name: 'Week before' }));
    expect(week(path())).toBe(WEEK);

    await userEvent.click(screen.getByRole('button', { name: 'All agents' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Assign');
    expect(path()).not.toContain('intern=');
    expect(week(path())).toBe(WEEK);
  });

  it('opens on next week from Saturday: the reset has happened', async () => {
    // Saturday 31 Oct, 10:00 in Manila.
    renderShell(Date.parse('2026-10-31T02:00:00Z'));
    await screen.findByRole('list', { name: 'Agents' });
    expect(weekShown()).toBe('2–6 Nov');
    expect(screen.getByRole('button', { name: 'This week' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the library’s page in the link, and drops it for a new search', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      name: `Marikina Warehouse ${String(i + 1).padStart(2, '0')}`,
      category: 'WAREHOUSE',
      listingType: 'FOR LEASE/ FOR RENT',
      subCategory: '',
      photoCount: 3,
      hasIssues: false,
    }));
    const at = `/assign?intern=${encodeURIComponent(janUser.name)}&week=${WEEK}&page=2`;
    const path = renderShell(Date.parse('2026-10-28T02:00:00Z'), at, fakeServer({ properties: { ok: true, properties: many } }));
    await screen.findByRole('heading', { level: 1, name: janUser.name });
    await waitFor(() => expect(listNames()[0]).toBe('Marikina Warehouse 11'));
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page');

    await userEvent.click(within(nav).getByRole('button', { name: 'Page 3' }));
    expect(new URLSearchParams(path().split('?')[1]).get('page')).toBe('3');
    expect(listNames()).toHaveLength(5);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search listings' }), 'marikina');
    await waitFor(() => expect(new URLSearchParams(path().split('?')[1]).get('page')).toBeNull());
    expect(listNames()[0]).toBe('Marikina Warehouse 01');

    // Another week starts at the first page too.
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('button', { name: 'Page 2' }));
    expect(new URLSearchParams(path().split('?')[1]).get('page')).toBe('2');
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(new URLSearchParams(path().split('?')[1]).get('page')).toBeNull();
  });

  it('reads a week from the link, and an older link’s day as its week', async () => {
    const at = `/assign?intern=${encodeURIComponent(janUser.name)}&date=2026-10-21`;
    renderShell(Date.parse('2026-10-28T02:00:00Z'), at);
    await screen.findByRole('heading', { level: 1, name: janUser.name });
    expect(weekShown()).toBe('19–23 Oct');
    expect(screen.getByText('Ended Fri 23 Oct')).toBeTruthy();
  });
});

describe('Assign, step two: the library by category', () => {
  it('counts what can go in, per category, and filters by tab and the Filter menu', async () => {
    render(<Harness />);
    expect(screen.getByText('Due Fri 30 Oct')).toBeTruthy();
    // Lot 12 and Sta. Rosa are Jan's this week; Casa Amara is free. Lot 7 is cooling, Seaside is Mika's.
    expect(chip(/^All/).textContent).toContain('6');
    expect(chip(/Warehouse/).textContent).toContain('3');
    expect(chip(/Condo/).textContent).toContain('3');
    expect(chip(/Office space/).textContent).toContain('0');

    await userEvent.click(chip(/Warehouse/));
    expect(chip(/Warehouse/).getAttribute('aria-pressed')).toBe('true');
    // Never posted first, then the longest since posted. Last week's missed ones are free again.
    expect(listNames()).toEqual(['Meycauayan Warehouse B', 'Calamba Warehouse C', 'Valenzuela Warehouse A']);
    expect(libRow('Calamba Warehouse C').textContent).toContain('Posted 27 days ago');
    expect(libRow('Meycauayan Warehouse B').textContent).toContain('Never posted');

    await filter('Due for repost');
    expect(listNames()).toEqual(['Calamba Warehouse C']);
    expect(screen.getByRole('button', { name: 'Filter, 1 on' })).toBeTruthy();
    await filter('Due for repost');
    await filter('Fresh');
    expect(listNames()).toEqual(['Meycauayan Warehouse B']);
    await filter('Fresh');

    // Adding: a click (or Enter), and the row says it's in.
    await userEvent.click(screen.getByRole('button', { name: 'Add Valenzuela Warehouse A' }));
    expect(queueNames()).toContain('Valenzuela Warehouse A');
    expect(screen.getByRole('button', { name: 'Valenzuela Warehouse A, in the queue' }).getAttribute('aria-disabled')).toBe('true');
    screen.getByRole('button', { name: 'Add Meycauayan Warehouse B' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(queueNames()).toContain('Meycauayan Warehouse B');
  });

  it('pages the library ten at a time, back to page 1 on a new tab, search or filter', async () => {
    const many = Array.from({ length: 23 }, (_, i) => listing(`m${i}`, `Marikina Warehouse ${String(i + 1).padStart(2, '0')}`, 'WAREHOUSE'));
    render(<Harness properties={[...LIBRARY, ...many]} />);
    await userEvent.click(chip(/Warehouse/));
    expect(listNames()).toHaveLength(10);
    const nav = () => screen.getByRole('navigation', { name: 'Pages' });
    expect(nav().closest('.pagination')!.textContent).toContain('1–10 of 26');
    expect(screen.queryByRole('button', { name: /^Show .* more$/ })).toBeNull();

    await userEvent.click(within(nav()).getByRole('button', { name: 'Page 3' }));
    // Never posted first, then the longest since posted: the last page ends with the posted ones.
    expect(listNames()).toEqual([
      'Marikina Warehouse 21',
      'Marikina Warehouse 22',
      'Marikina Warehouse 23',
      'Meycauayan Warehouse B',
      'Calamba Warehouse C',
      'Valenzuela Warehouse A',
    ]);
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Warehouse listings' }));

    await filter('Fresh');
    expect(within(nav()).getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');
    await filter('Fresh');
    await userEvent.click(within(nav()).getByRole('button', { name: 'Next page' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search listings' }), 'warehouse');
    expect(listNames()[0]).toBe('Marikina Warehouse 01');
    await userEvent.click(within(nav()).getByRole('button', { name: 'Next page' }));
    await userEvent.click(chip(/^All/));
    expect(within(nav()).getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');

    // Ten or fewer: a count, no pages.
    await userEvent.click(chip(/Office space/));
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('searches within the tab', async () => {
    render(<Harness />);
    await userEvent.click(chip(/Condo/));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search listings' }), 'casa');
    expect(listNames()).toEqual(['Casa Amara House & Lot']);
    expect(libRow('Casa Amara House & Lot').textContent).toContain('Tagaytay · 320 sqm');
  });

  it('hides what can’t go in, and shows it greyed with the reason on request, without an Add', async () => {
    render(<Harness />);
    expect(listNames()).not.toContain('Seaside Residences 2BR');
    expect(listNames()).not.toContain('Alabang Office 3F');
    // Started this week, so in the queue: it says so rather than hiding.
    expect(screen.getByRole('button', { name: 'Verdant Hills Lot 7, in the queue' })).toBeTruthy();

    await filter('Show unavailable');
    expect(libRow('Seaside Residences 2BR').textContent).toContain('With Mika, 26–30 Oct');
    expect(libRow('BGC Office 18F').textContent).toContain('With Mika, 26–30 Oct');
    expect(libRow('Alabang Office 3F').textContent).toContain("In Dana's queue");
    expect(libRow('Kapitolyo Retail').textContent).toContain('Sold');
    expect(libRow('Makati Retail').textContent).toContain('No separator');
    for (const name of ['Seaside Residences 2BR', 'BGC Office 18F', 'Alabang Office 3F', 'Kapitolyo Retail']) {
      expect(screen.queryByRole('button', { name: `Add ${name}` })).toBeNull();
      expect(libRow(name).classList.contains('lib-row--off')).toBe(true);
    }
  });
});

describe('Assign, quick fill', () => {
  it('offers the week’s target, from the chosen category, tinted, with Undo', async () => {
    render(<Harness settings={{ cooldownDays: 7, repostDueDays: 14, perWeek: 2 }} />);
    await userEvent.click(chip(/Warehouse/));
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 from Warehouse' }));

    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Meycauayan Warehouse B', 'Calamba Warehouse C']);
    expect(document.querySelectorAll('.queue-row--preview')).toHaveLength(2);
    expect(screen.getByText('Added 2 from Warehouse.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
  });

  it('starts at perWeek, and − and + change it', async () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Add 40' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Add 45' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fewer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fewer' }));
    expect(screen.getByRole('button', { name: 'Add 35' })).toBeTruthy();
    expect([stepCount(5, -1), stepCount(4, 1), stepCount(37, 1), stepCount(1, -1)]).toEqual([4, 5, 40, 1]);
  });

  it('never adds a held, sold or cooling listing, and says when it ran out', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Add 40' }));
    const names = queueNames();
    expect(names).toEqual(expect.arrayContaining(['Casa Amara House & Lot', 'Meycauayan Warehouse B', 'Valenzuela Warehouse A', 'Calamba Warehouse C']));
    for (const no of ['Seaside Residences 2BR', 'BGC Office 18F', 'Verdant Hills Lot 7', 'Kapitolyo Retail', 'Makati Retail', 'Alabang Office 3F']) {
      expect(names).not.toContain(no);
    }
    expect(screen.getByText("Added 4. That's all that's free.")).toBeTruthy();
  });

  it('an empty week says so, and offers the fill', async () => {
    render(<Harness week={NEXT_WEEK} />);
    expect(screen.getByText('Nothing queued.')).toBeTruthy();
    const add = within(screen.getByRole('region', { name: 'Queue' })).getByRole('button', { name: 'Add 40' });
    await userEvent.click(add);
    expect(queueNames().length).toBeGreaterThan(0);
  });
});

describe('Assign, the week’s queue by status', () => {
  it('groups it as Not shared, Pending and Posted, with a link to each post, and no Missed while the week runs', () => {
    render(<Harness onOpenLink={vi.fn()} />);
    expect(groupNames('Not shared')).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
    expect(groupNames('Pending')).toEqual(['Verdant Hills Lot 7']);
    expect(groupNames('Posted')).toEqual(['Ortigas Office 9F']);
    expect(screen.queryByRole('region', { name: 'Missed' })).toBeNull();
    const open = within(screen.getByRole('region', { name: 'Posted' })).getByRole('link', { name: 'Open the post of Ortigas Office 9F' });
    expect(open.getAttribute('href')).toBe(link(9));
    // Only what isn't shared yet can be moved or removed.
    expect(screen.queryByRole('button', { name: 'Remove Ortigas Office 9F' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Verdant Hills Lot 7' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' })).toBeTruthy();
  });

  it('opens a post through the app', async () => {
    const onOpenLink = vi.fn();
    render(<Harness onOpenLink={onOpenLink} />);
    await userEvent.click(screen.getByRole('link', { name: 'Open the post of Ortigas Office 9F' }));
    expect(onOpenLink).toHaveBeenCalledWith(link(9));
  });

  it('shows a week that is over read only: what was posted and what was missed', () => {
    render(<Harness week={LAST_WEEK} />);
    expect(screen.getByText('Ended Fri 23 Oct')).toBeTruthy();
    expect(document.querySelector('.assign-review__sum')?.textContent).toBe('1 posted · 2 missed');
    expect(groupNames('Missed')).toEqual(['Meycauayan Warehouse B', 'Calamba Warehouse C']);
    expect(groupNames('Posted')).toEqual(['Valenzuela Warehouse A']);
    expect(screen.queryByRole('region', { name: 'Not shared' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Save queue/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search listings' })).toBeNull();
  });

  it('copies what was missed to next week, ready to save', async () => {
    const onSaveSpy = vi.fn();
    const onWeekChange = vi.fn();
    render(<Harness week={LAST_WEEK} onSaveSpy={onSaveSpy} onWeekChange={onWeekChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy missed to next week' }));
    expect(onWeekChange).toHaveBeenCalledWith(WEEK);
    expect(weekShown()).toBe('26–30 Oct');
    await waitFor(() => expect(document.querySelector('.assign-fill')?.textContent).toContain('Copied 2 from 19–23 Oct.'));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Meycauayan Warehouse B', 'Calamba Warehouse C']);
    expect(document.querySelectorAll('.queue-row--preview')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: /^Save queue/ }));
    const save = onSaveSpy.mock.calls[0]?.[0] as QueueSave;
    expect(save.week).toBe(WEEK);
    expect(save.items.map((i) => i.propertyName)).toEqual(
      expect.arrayContaining(['Meycauayan Warehouse B', 'Calamba Warehouse C']),
    );
  });
});

describe('Assign, saving', () => {
  it('marks the rows a held refusal names, keeps the rest, and removes them on request', async () => {
    const refusal = Object.assign(new UserFacingError('Casa Amara House & Lot is with Bea.'), {
      held: [{ propertyName: 'Casa Amara House & Lot', propertyId: 'f3', heldBy: BEA, date: WEEK }],
    });
    const onSave = vi.fn().mockRejectedValue(refusal);
    render(<Harness onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Casa Amara House & Lot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Meycauayan Warehouse B' }));
    await userEvent.click(screen.getByRole('button', { name: /^Save queue/ }));

    await screen.findByText('One listing is held by another agent. Remove it, then save again.');
    const refused = document.querySelector('.queue-row--refused')!;
    expect(refused.textContent).toContain('Casa Amara House & Lot');
    expect(refused.textContent).toContain('With Bea, 26–30 Oct');
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Casa Amara House & Lot', 'Meycauayan Warehouse B']);

    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Meycauayan Warehouse B']);
  });

  it('saves the week’s queue in its new order, keeping what was started', async () => {
    const onSaveSpy = vi.fn();
    render(<Harness onSaveSpy={onSaveSpy} />);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Move Sta. Rosa Lot 22 up' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save queue (4)' }));
    expect(onSaveSpy).toHaveBeenCalledTimes(1);
    const save = onSaveSpy.mock.calls[0]?.[0] as QueueSave;
    expect(save.week).toBe(WEEK);
    expect(save.assignedTo).toBe(JAN);
    expect(save.items.map((i) => [i.propertyName, i.status])).toEqual([
      ['Verdant Hills Lot 7', 'Pending'],
      ['Sta. Rosa Lot 22', 'Not Shared'],
      ['Verdant Hills Lot 12', 'Not Shared'],
      ['Ortigas Office 9F', 'Posted'],
    ]);
    expect(await screen.findByText('Saved')).toBeTruthy();
  });
});

describe('Assign, kept from before', () => {
  it('matches a pasted list from the More menu, offers a suggestion for a typo, and adds it once accepted', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
    const box = screen.getByRole('textbox', { name: 'Paste a list' });
    fireEvent.change(box, { target: { value: '1. Casa Amara House & Lot\n2. Verdnt Hills Lot 12\n- Nowhere Plaza' } });
    await userEvent.click(screen.getByRole('button', { name: 'Match to the library' }));

    const matches = screen.getByRole('region', { name: 'Matches' });
    expect(matches.textContent).toContain('Not found: “Nowhere Plaza”');
    expect(matches.textContent).toContain('Did you mean Verdant Hills Lot 12?');
    await userEvent.click(within(matches).getByRole('button', { name: 'Add 1 found listing' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22', 'Casa Amara House & Lot']);
    await userEvent.click(screen.getByRole('button', { name: 'Back to listings' }));
    expect(screen.getByRole('searchbox', { name: 'Search listings' })).toBeTruthy();
  });

  it('a pasted listing another intern has this week is refused, and says whose it is', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Paste a list' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste a list' }), { target: { value: 'BGC Office 18F' } });
    await userEvent.click(screen.getByRole('button', { name: 'Match to the library' }));
    expect(screen.getByRole('region', { name: 'Matches' }).textContent).toContain("Mika's queue");
  });

  it('reorders from the keyboard, keeping the focus on the arrow that moved', async () => {
    render(<Harness />);
    const down = screen.getByRole('button', { name: 'Move Verdant Hills Lot 12 down' });
    down.focus();
    await userEvent.keyboard('{Enter}');
    expect(queueNames()).toEqual(['Sta. Rosa Lot 22', 'Verdant Hills Lot 12']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Verdant Hills Lot 12 down' }));

    // Alt+Up from anywhere in the row moves it back.
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);

    // Already first: nothing moves.
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(queueNames()).toEqual(['Verdant Hills Lot 12', 'Sta. Rosa Lot 22']);
    expect(screen.getByText('Verdant Hills Lot 12 is already first.')).toBeTruthy();
  });

  it('asks before throwing away unsaved changes when going back to the interns, and keeps them on request', async () => {
    const onInternChange = vi.fn();
    render(<Harness onInternChange={onInternChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    expect(queueNames()).toEqual(['Verdant Hills Lot 12']);

    const back = screen.getByRole('button', { name: 'All agents' });
    await userEvent.click(back);
    expect(onInternChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Unsaved changes');
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keep);

    await userEvent.click(keep);
    expect(onInternChange).not.toHaveBeenCalled();
    expect(queueNames()).toEqual(['Verdant Hills Lot 12']);
    expect(document.activeElement).toBe(back);

    await userEvent.click(back);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onInternChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole('list', { name: 'Agents' })).toBeTruthy();
  });

  it('asks before switching week too, and moves on once discarded', async () => {
    const onWeekChange = vi.fn();
    render(<Harness onWeekChange={onWeekChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onWeekChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onWeekChange).toHaveBeenCalledWith(NEXT_WEEK);
    expect(queueNames()).toEqual([]);
    expect(screen.getByText('Nothing queued.')).toBeTruthy();
  });

  it('tells the shell when there are unsaved changes, so it can guard leaving', async () => {
    const onDirtyChange = vi.fn();
    const { unmount } = render(<Harness onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sta. Rosa Lot 22' }));
    act(() => unmount());
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});
