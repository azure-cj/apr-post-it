// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assignment, PostLogEntry } from '@/core/types';
import type { DirectoryRow, TeamMember } from '@/core/summary';
import { TrackerScreen, type TrackerScreenProps } from './index';

/** Wed 4 Nov 2026: the week of 2–6 Nov, three weekdays in. */
const TODAY = '2026-11-04';
const WEEK = '2026-11-02';

const NO_SEPARATOR = 'No separator line — the whole document is treated as postable. Check it.';

function listing(id: string, name: string, issues = '', docId?: string): DirectoryRow {
  return {
    id,
    name,
    category: 'WAREHOUSE',
    listingType: 'FOR LEASE/ FOR RENT',
    subCategory: '',
    photoCount: 4,
    hasIssues: issues !== '',
    ...(issues ? { issues } : {}),
    ...(docId ? { docId } : {}),
  };
}

const LIBRARY = [
  listing('a', 'Calamba Warehouse 3'),
  listing('b', 'Pampanga Logistics Hub 9', NO_SEPARATOR, 'docPampanga'),
  listing('c', 'Taguig FTI Warehouse 12', 'No photos', 'docTaguig'),
  listing('d', 'Bulacan Warehouse 5', `${NO_SEPARATOR} · No photos`),
  listing('e', 'Cavite Warehouse 2', 'No document'),
];

const post = (title: string, time: string, by: string, status: 'Posted' | 'Pending' = 'Posted', date = TODAY): PostLogEntry => ({
  date,
  time,
  type: 'Warehouse',
  title,
  status,
  fbAccount: 'APG Main',
  postLink: `https://www.facebook.com/groups/x/posts/${title.length}${time.replace(':', '')}/`,
  postedBy: by,
  propertyId: '',
});

const TEAM: TeamMember[] = [
  { name: 'Jan Dela Cruz', role: 'Intern' },
  { name: 'Mika Reyes', role: 'Intern' },
  { name: 'Maria Santos', role: 'Admin' },
];

const queued = (who: string, n: number, status: Assignment['status'] = 'Not Shared'): Assignment[] =>
  Array.from({ length: n }, (_, i) => ({ date: WEEK, week: WEEK, assignedTo: who, propertyName: `${who} ${status} ${i}`, propertyId: '', status }));

// Jan has posted 1 of 10 by Wednesday: behind. Mika 6 of 10: on track.
const ASSIGNMENTS = [...queued('Jan Dela Cruz', 1, 'Posted'), ...queued('Jan Dela Cruz', 9), ...queued('Mika Reyes', 6, 'Posted'), ...queued('Mika Reyes', 4)];

const POSTS: PostLogEntry[] = [
  post('Old listing', '09:00', 'Jan Dela Cruz', 'Posted', '2026-11-02'),
  post('Older pending', '09:30', 'Mika Reyes', 'Pending', '2026-11-03'),
  ...Array.from({ length: 10 }, (_, i) =>
    post(`Listing ${i}`, `${String(8 + i).padStart(2, '0')}:15`, i % 3 === 0 ? 'Jan Dela Cruz' : 'Mika Reyes', i === 4 ? 'Pending' : 'Posted'),
  ),
];

function renderTracker(props: Partial<TrackerScreenProps> = {}) {
  const callbacks = { onOpenLink: vi.fn(), onOpenInterns: vi.fn(), onOpenRecords: vi.fn(), onOpenSettings: vi.fn() };
  render(
    <TrackerScreen
      date={TODAY}
      today={TODAY}
      posts={POSTS}
      assignments={ASSIGNMENTS}
      properties={LIBRARY}
      team={TEAM}
      onDateChange={vi.fn()}
      internsHref="#/interns"
      recordsHref="#/records?period=custom&from=2026-11-04&to=2026-11-04"
      settingsHref="#/settings?tab=listings"
      {...callbacks}
      {...props}
    />,
  );
  return callbacks;
}

const stat = (label: string) => screen.getByText(label, { selector: 'dt, dt *' }).closest('.tracker-stat')!.querySelector('.tracker-stat__value')!.textContent;

afterEach(cleanup);

describe('TrackerScreen', () => {
  it('has a heading, the day and Refresh, and no subtitle', () => {
    render(<TrackerScreen date={TODAY} today={TODAY} posts={[]} assignments={[]} properties={[]} onDateChange={vi.fn()} onRefresh={vi.fn()} updatedAt="10:42" />);
    const header = document.querySelector('.tracker__header')!;
    expect(within(header as HTMLElement).getByRole('heading', { level: 1 }).textContent).toBe('Tracker');
    expect(within(header as HTMLElement).getByRole('group', { name: 'Day shown' }).textContent).toContain('Wed 4 Nov 2026');
    expect(within(header as HTMLElement).getByRole('button', { name: 'Refresh' }).getAttribute('title')).toBe('Updated 10:42');
    expect(header.querySelector('p')).toBeNull();
  });

  it('sums up the day in four tiles, zero included', async () => {
    renderTracker();
    const tiles = Array.from(document.querySelectorAll('.tracker-stats dt')).map((dt) => dt.textContent);
    expect(tiles).toEqual(['Posted today', 'Pending', 'Interns behind', 'Docs to fix']);
    expect(stat('Posted today')).toBe('9');
    // Waiting for approval, whatever day.
    expect(stat('Pending')).toBe('2');
    expect(stat('Interns behind')).toBe('1 of 2');
    // Four listings, Bulacan counted once.
    expect(stat('Docs to fix')).toBe('4');

    // Docs to fix goes to the Documents card.
    await userEvent.click(screen.getByRole('button', { name: 'Docs to fix' }));
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Documents' }));

    cleanup();
    render(<TrackerScreen date={TODAY} today={TODAY} posts={[]} assignments={[]} properties={[listing('a', 'A')]} onDateChange={vi.fn()} />);
    expect(stat('Posted today')).toBe('0');
    expect(stat('Docs to fix')).toBe('0');
    expect(screen.getByText('No posts yet.')).toBeTruthy();
  });

  it("lists today's posts newest first, at most 8, then links to Records", async () => {
    const { onOpenLink, onOpenRecords } = renderTracker();
    const card = screen.getByRole('region', { name: "Today's posts" });
    const rows = within(card).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(8);
    expect(Array.from(rows[0]!.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['5:15 PM', 'Listing 9', 'Jan Dela Cruz', 'Posted', 'Open']);
    expect(rows[5]!.textContent).toContain('Pending');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Open the post of Listing 9' }));
    expect(onOpenLink).toHaveBeenCalledWith('https://www.facebook.com/groups/x/posts/91715/');

    const more = within(card).getByRole('link', { name: 'See all in Records' });
    expect(more.getAttribute('href')).toBe('#/records?period=custom&from=2026-11-04&to=2026-11-04');
    await userEvent.click(more);
    expect(onOpenRecords).toHaveBeenCalled();

    // Eight or fewer: no link.
    cleanup();
    renderTracker({ posts: POSTS.slice(0, 10) });
    expect(within(screen.getByRole('region', { name: "Today's posts" })).getAllByRole('row')).toHaveLength(9);
    expect(screen.queryByRole('link', { name: 'See all in Records' })).toBeNull();

    // Another day says so.
    cleanup();
    renderTracker({ date: '2026-11-02' });
    expect(within(screen.getByRole('region', { name: 'Posts on Mon 2 Nov' })).getAllByRole('row')).toHaveLength(2);
    expect(stat('Posted')).toBe('1');
  });

  it("shows each intern's week as a bar and a pace, and links to Interns", async () => {
    const { onOpenInterns } = renderTracker();
    const card = screen.getByRole('region', { name: 'This week' });
    const rows = Array.from(card.querySelectorAll('.intern-row')).map((r) => r.textContent);
    expect(rows).toEqual(['JDJan Dela Cruz1 / 10Behind', 'MRMika Reyes6 / 10On track']);
    const link = within(card).getByRole('link', { name: 'See all interns' });
    expect(link.textContent).toBe('See all');
    expect(link.getAttribute('href')).toBe('#/interns');
    await userEvent.click(link);
    expect(onOpenInterns).toHaveBeenCalled();

    // A day of another week names that week.
    cleanup();
    renderTracker({ date: '2026-10-28' });
    expect(screen.getByRole('region', { name: '26–30 Oct' })).toBeTruthy();
  });

  it('groups the documents to fix by issue, with counts, and opens each doc or folder', async () => {
    const { onOpenLink, onOpenSettings } = renderTracker();
    const card = screen.getByRole('region', { name: 'Documents' });
    expect(card.querySelector('.docs__note')!.textContent).toBe('Fixed documents apply at once. Run Rebuild in Settings to refresh these counts.');
    await userEvent.click(within(card).getByRole('link', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalled();

    // Only the kinds someone has, in order, each folded with its count.
    const toggles = within(card).getAllByRole('button', { expanded: false });
    expect(toggles.map((b) => b.textContent)).toEqual(['No separator· 2Shown to interns with a warning', 'No document· 1', 'No photos· 2']);
    expect(within(card).queryByRole('list', { name: 'No separator' })).toBeNull();

    await userEvent.click(toggles[0]!);
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('true');
    const separators = within(card).getByRole('list', { name: 'No separator' });
    expect(within(separators).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Bulacan Warehouse 5Open folder',
      'Pampanga Logistics Hub 9Open doc',
    ]);
    await userEvent.click(within(separators).getByRole('button', { name: 'Open doc, Pampanga Logistics Hub 9' }));
    expect(onOpenLink).toHaveBeenLastCalledWith('https://docs.google.com/document/d/docPampanga/edit');
    // No doc id in the directory: the folder.
    await userEvent.click(within(separators).getByRole('button', { name: 'Open folder, Bulacan Warehouse 5' }));
    expect(onOpenLink).toHaveBeenLastCalledWith('https://drive.google.com/drive/folders/d');

    // Photos are fixed in the folder, even when the doc is known.
    await userEvent.click(toggles[2]!);
    const photos = within(card).getByRole('list', { name: 'No photos' });
    await userEvent.click(within(photos).getByRole('button', { name: 'Open folder, Taguig FTI Warehouse 12' }));
    expect(onOpenLink).toHaveBeenLastCalledWith('https://drive.google.com/drive/folders/c');

    // Folds again.
    await userEvent.click(toggles[0]!);
    expect(within(card).queryByRole('list', { name: 'No separator' })).toBeNull();
  });

  it('counts the empty-above and unreadable kinds, and pages a long group ten at a time', async () => {
    const many = Array.from({ length: 14 }, (_, i) => listing(`s${i}`, `Separator ${String(i).padStart(2, '0')}`, NO_SEPARATOR, `doc${i}`));
    renderTracker({
      properties: [
        ...many,
        listing('x', 'Empty Lot', 'Document is empty above the separator', 'docEmpty'),
        listing('y', 'Word Lot', 'Could not read document: Word file — save it as a Google Doc'),
      ],
    });
    const card = screen.getByRole('region', { name: 'Documents' });
    const toggles = within(card).getAllByRole('button', { expanded: false });
    expect(toggles.map((b) => b.textContent)).toEqual([
      'No separator· 14Shown to interns with a warning',
      'Empty above separator· 1',
      "Couldn't read· 1",
    ]);
    await userEvent.click(toggles[0]!);
    const list = within(card).getByRole('list', { name: 'No separator' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    const pages = within(card).getByRole('navigation', { name: 'No separator, pages' });
    expect(pages.closest('.pagination')!.textContent).toContain('1–10 of 14');
    await userEvent.click(within(pages).getByRole('button', { name: 'Page 2' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('.docs-item__name')!.textContent)).toEqual([
      'Separator 10',
      'Separator 11',
      'Separator 12',
      'Separator 13',
    ]);
    // The list's top takes focus, so the next Tab is its first link.
    expect(document.activeElement).toBe(list);
    // A short group has no pages.
    await userEvent.click(within(card).getByRole('button', { name: /Empty above separator/ }));
    expect(within(card).queryByRole('navigation', { name: 'Empty above separator, pages' })).toBeNull();
  });

  it('says so in one line when every document is OK', () => {
    renderTracker({ properties: [listing('a', 'Calamba Warehouse 3'), { ...listing('z', 'Flag only'), hasIssues: true }] });
    const card = screen.getByRole('region', { name: 'Documents' });
    expect(card.textContent).toBe('DocumentsAll documents OK');
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });
});
