// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { presetPeriod, type Period } from '@/core/records';
import type { Assignment, PostLogEntry } from '@/core/types';
import { AppShell, routerFuture } from '../../App';
import { AppStateProvider } from '../../state/AppState';
import { admin, EXEC, fakeServer, intern, NOW, renderApp } from '../../state/testing';
import { postsCsv, RecordsScreen, type RecordsScreenProps } from './RecordsScreen';

/** Wed 4 Nov 2026: the week of 2–6 Nov, three weekdays in. */
const WED = '2026-11-04';
const THIS = '2026-11-02';
const LAST = '2026-10-26';

const post = (
  title: string,
  id: string,
  date: string,
  time: string,
  by: string,
  status: 'Posted' | 'Pending' = 'Posted',
  type = 'Commercial Space',
  fbAccount = 'APG Main',
): PostLogEntry => ({
  date,
  time,
  type,
  title,
  status,
  fbAccount,
  postLink: `https://www.facebook.com/groups/x/posts/${id}${time.replace(':', '')}/`,
  postedBy: by,
  propertyId: id,
});

const KAPITOLYO = 'Kapitolyo Ground Floor Retail, Pasig';

const POSTS: PostLogEntry[] = [
  post(KAPITOLYO, '1Kapitolyo', '2026-09-01', '09:00', 'Mika Reyes'),
  post('Old listing A', 'A', '2026-10-27', '10:00', 'Jan Dela Cruz'),
  post('Old listing D', 'D', '2026-10-27', '11:00', 'Mika Reyes'),
  post('Friday listing', 'F', '2026-10-30', '11:00', 'Jan Dela Cruz'),
  // This week: 6 posts, 1 pending, 3 interns, Tuesday the busiest with 3.
  post(KAPITOLYO, '1Kapitolyo', '2026-11-02', '10:15', 'Jan Dela Cruz'),
  post('Seaside Residences 2BR, Pasay', '1Seaside', '2026-11-02', '09:05', 'Mika Reyes', 'Posted', 'Condo / House and Lot', 'Mika Reyes APG'),
  post('BGC Uptown Office 18F, 240 sqm', '1BgcUptown', '2026-11-03', '08:40', 'Jan Dela Cruz', 'Pending', 'Office Space'),
  post('Valenzuela Warehouse 1,200 sqm', '1Valenzuela', '2026-11-03', '14:30', 'Jan Dela Cruz', 'Posted', 'Warehouse'),
  post('Verdant Hills Lot 12, Tagaytay', '1Verdant', '2026-11-03', '16:00', 'Bea Lim', 'Posted', 'Condo / House and Lot', 'Bea Lim Realty'),
  post('Meycauayan Warehouse 800 sqm', '1Meyc', '2026-11-04', '09:30', 'Mika Reyes', 'Posted', 'Warehouse', 'Mika Reyes APG'),
];

const queued = (who: string, week: string, name: string, id: string, status: Assignment['status'] = 'Not Shared'): Assignment => ({
  date: week,
  week,
  assignedTo: who,
  propertyName: name,
  propertyId: id,
  status,
});

const ASSIGNMENTS: Assignment[] = [
  // Last week: Jan got 1 of 3 done, so 2 missed; Mika 1 of 1.
  queued('Jan Dela Cruz', LAST, 'Old listing A', 'A', 'Posted'),
  queued('Jan Dela Cruz', LAST, 'Old listing B', 'B'),
  queued('Jan Dela Cruz', LAST, 'Old listing C', 'C'),
  queued('Mika Reyes', LAST, 'Old listing D', 'D', 'Posted'),
  // This week Kapitolyo is in Bea's queue.
  queued('Bea Lim', THIS, KAPITOLYO, '1Kapitolyo'),
];

/** The screen with its period kept in state, as the route keeps it in the link. */
function Harness(props: Partial<RecordsScreenProps> & { readonly start?: Period }) {
  const [period, setPeriod] = useState<Period>(props.start ?? presetPeriod('this-week', WED));
  return (
    <RecordsScreen
      posts={POSTS}
      assignments={ASSIGNMENTS}
      today={WED}
      interns={['Jan Dela Cruz', 'Mika Reyes', 'Bea Lim', 'Carlo Mendoza']}
      {...props}
      period={period}
      onPeriodChange={setPeriod}
    />
  );
}

const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).closest('.records-tile')!;
const list = () => screen.getByRole('region', { name: 'Posts' });
const count = () => within(list()).getByRole('status').textContent;
const rows = () => within(list()).getAllByRole('row').slice(1);
const titles = () => rows().map((r) => within(r).getByRole('rowheader').textContent);

describe('RecordsScreen', () => {
  it('sums up the period in five tiles, each against the same days of the period before', async () => {
    render(<Harness />);
    // Read out as label, number, change; the arrow is drawn, "Up" is said.
    expect(tile('Posts').textContent).toBe('Posts6↑Up 4 vs 26–28 Oct');
    expect(tile('Pending').textContent).toBe('Pending1↑Up 1 vs 26–28 Oct');
    // No week of the period has ended yet: nothing can be missed.
    expect(tile('Missed').textContent).toBe('Missed–After Fri 6 Nov');
    expect(tile('Active interns').textContent).toBe('Active interns3↑Up 1 vs 26–28 Oct');
    expect(tile('Busiest day').textContent).toBe('Busiest day3 Tue 3 Nov↑Up 1 vs 26–28 Oct');
    expect(tile('Posts').querySelector('.records-tile__change--good')).toBeTruthy();
    // More pending is neither better nor worse.
    expect(tile('Pending').querySelector('.records-tile__change--same')).toBeTruthy();

    // Last week: what was missed, and nothing ended the week before to compare with.
    await userEvent.click(screen.getByRole('button', { name: 'Last week' }));
    expect(tile('Missed').textContent).toBe('Missed2No week ended in 19–23 Oct');
    expect(tile('Posts').textContent).toBe('Posts3↑Up 3 vs 19–23 Oct');
  });

  it('steps the period with ‹ ›, and won’t step past today', async () => {
    render(<Harness />);
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByText('2–6 Nov')).toBeTruthy();
    expect(within(period).getByRole('button', { name: 'Week after' }).hasAttribute('disabled')).toBe(true);
    expect(within(period).getByRole('button', { name: 'This week' }).getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(within(period).getByRole('button', { name: 'Week before' }));
    expect(within(period).getByText('26–30 Oct')).toBeTruthy();
    expect(within(period).getByRole('button', { name: 'Last week' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(period).getByRole('button', { name: 'Week before' }));
    expect(within(period).getByText('19–23 Oct')).toBeTruthy();
    expect(within(period).queryAllByRole('button', { pressed: true })).toHaveLength(0);

    await userEvent.click(within(period).getByRole('button', { name: 'This month' }));
    expect(within(period).getByText('Nov 2026')).toBeTruthy();
    await userEvent.click(within(period).getByRole('button', { name: 'Month before' }));
    expect(within(period).getByText('Oct 2026')).toBeTruthy();
    expect(count()).toBe('3 posts');

    await userEvent.click(within(period).getByRole('button', { name: 'Last 30 days' }));
    expect(within(period).getByText('6 Oct – 4 Nov')).toBeTruthy();

    // Custom: two dates, in either order.
    await userEvent.click(within(period).getByRole('button', { name: 'Custom' }));
    fireEvent.change(within(period).getByLabelText('From'), { target: { value: '2026-11-03' } });
    expect(within(period).getByText('3–4 Nov')).toBeTruthy();
    expect(count()).toBe('4 posts');
  });

  it('filters the list to a day from its bar, says so in a chip, and the chip clears it', async () => {
    render(<Harness />);
    expect(count()).toBe('6 posts');
    const chart = screen.getByRole('group', { name: /Posts by day/ });
    // Days still to come have no bar to pick.
    expect(within(chart).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mon 2 Nov: 2 posted, 0 pending',
      'Tue 3 Nov: 2 posted, 1 pending',
      'Wed 4 Nov: 1 posted, 0 pending',
    ]);

    await userEvent.click(within(chart).getByRole('button', { name: /^Tue 3 Nov/ }));
    expect(within(chart).getByRole('button', { name: /^Tue 3 Nov/ }).getAttribute('aria-pressed')).toBe('true');
    expect(count()).toBe('3 posts');
    const chip = within(list()).getByRole('button', { name: 'Remove filter Day: Tue 3 Nov' });
    await userEvent.click(chip);
    expect(count()).toBe('6 posts');
    expect(within(chart).getByRole('button', { name: /^Tue 3 Nov/ }).getAttribute('aria-pressed')).toBe('false');

    // The same bar again takes the filter off too; the arrow keys move along the bars.
    within(chart).getByRole('button', { name: /^Wed 4 Nov/ }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Tue 3 Nov/);
    await userEvent.keyboard('{Enter}');
    expect(count()).toBe('3 posts');
    await userEvent.keyboard('{Enter}');
    expect(count()).toBe('6 posts');
  });

  it('breaks the period down by intern, category and FB account, and a row filters the list', async () => {
    render(<Harness />);
    const breakdown = screen.getByRole('region', { name: 'Breakdown' });
    expect(within(breakdown).getByRole('tab', { name: 'By intern' }).getAttribute('aria-selected')).toBe('true');
    const internRows = within(breakdown)
      .getAllByRole('row')
      .slice(1)
      .map((r) => Array.from(r.querySelectorAll('th, td')).map((c) => c.textContent));
    // Most posts first; an active intern who posted nothing still has a row.
    expect(internRows.map((r) => r.slice(0, 5))).toEqual([
      ['Jan Dela Cruz', '3', '1', '0', '–'],
      ['Mika Reyes', '2', '0', '0', '–'],
      ['Bea Lim', '1', '0', '0', '0%'],
      ['Carlo Mendoza', '0', '0', '0', '–'],
    ]);

    await userEvent.click(within(breakdown).getByRole('button', { name: 'Jan Dela Cruz' }));
    expect(count()).toBe('3 posts');
    expect(within(list()).getByRole('button', { name: 'Remove filter Intern: Jan Dela Cruz' })).toBeTruthy();

    await userEvent.click(within(breakdown).getByRole('tab', { name: 'By category' }));
    expect(within(breakdown).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Condo / House and Lot: 2 posts, 0 pending',
      'Warehouse: 2 posts, 0 pending',
      'Commercial Space: 1 post, 0 pending',
      'Office Space: 1 post, 1 pending',
    ]);
    await userEvent.click(within(breakdown).getByRole('button', { name: /^Warehouse/ }));
    // Jan and Warehouse together.
    expect(titles()).toEqual(['Valenzuela Warehouse 1,200 sqm']);

    // The arrow keys move between the tabs.
    within(breakdown).getByRole('tab', { name: 'By category' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(breakdown).getByRole('tab', { name: 'By FB account' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(within(breakdown).getByRole('button', { name: /^Mika Reyes APG/ }));
    expect(count()).toBe('0 posts');
    expect(within(list()).getByText('No posts match.')).toBeTruthy();
    await userEvent.click(within(list()).getByRole('button', { name: 'Clear filters' }));
    expect(count()).toBe('6 posts');
    expect(within(list()).queryByRole('list', { name: 'Filters' })).toBeNull();
  });

  it('searches by listing, intern, FB account or link, and filters by Posted or Pending', async () => {
    const onOpenLink = vi.fn();
    render(<Harness onOpenLink={onOpenLink} />);
    const search = within(list()).getByRole('searchbox', { name: 'Search posts' });
    await userEvent.type(search, 'seaside');
    expect(titles()).toEqual(['Seaside Residences 2BR, Pasay']);
    await userEvent.clear(search);
    await userEvent.type(search, 'bea lim realty');
    expect(titles()).toEqual(['Verdant Hills Lot 12, Tagaytay']);
    await userEvent.clear(search);
    await userEvent.type(search, 'posts/1BgcUptown');
    const row = rows()[0]!;
    await userEvent.click(within(row).getByRole('button', { name: /Open the post/ }));
    expect(onOpenLink).toHaveBeenCalledWith('https://www.facebook.com/groups/x/posts/1BgcUptown0840/');
    await userEvent.clear(search);

    const status = within(list()).getByRole('group', { name: 'Share posting' });
    expect(within(status).getAllByRole('button').map((b) => b.textContent)).toEqual(['Posted5', 'Pending1']);
    await userEvent.click(within(status).getByRole('button', { name: /^Pending/ }));
    expect(titles()).toEqual(['BGC Uptown Office 18F, 240 sqm']);
    await userEvent.click(within(status).getByRole('button', { name: /^Posted/ }));
    expect(count()).toBe('5 posts');
    expect(within(status).getByRole('button', { name: /^Pending/ }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(within(status).getByRole('button', { name: /^Posted/ }));
    expect(count()).toBe('6 posts');
  });

  it('shows the sheet’s columns in its order, newest first, and sorts by any of them', async () => {
    render(<Harness />);
    const head = within(list()).getAllByRole('columnheader');
    expect(head.map((h) => h.textContent)).toEqual([
      'Date',
      'Property type',
      'Property title',
      'FB account name',
      'Link',
      'Time posted',
      'Share posting',
      'Posted by',
    ]);
    expect(head[0]!.getAttribute('aria-sort')).toBe('descending');
    expect(Array.from(rows()[0]!.querySelectorAll('td, th')).map((c) => c.textContent)).toEqual([
      'Wed 4 Nov',
      'Warehouse',
      'Meycauayan Warehouse 800 sqm',
      'Mika Reyes APG',
      'No link',
      '9:30 AM',
      'Posted',
      'Mika Reyes',
    ]);

    await userEvent.click(within(list()).getByRole('button', { name: 'Posted by' }));
    expect(within(list()).getByRole('columnheader', { name: 'Posted by' }).getAttribute('aria-sort')).toBe('ascending');
    expect(rows().map((r) => r.lastElementChild!.textContent)).toEqual([
      'Bea Lim',
      'Jan Dela Cruz',
      'Jan Dela Cruz',
      'Jan Dela Cruz',
      'Mika Reyes',
      'Mika Reyes',
    ]);
    await userEvent.click(within(list()).getByRole('button', { name: 'Posted by' }));
    expect(rows()[0]!.lastElementChild!.textContent).toBe('Mika Reyes');

    await userEvent.click(within(list()).getByRole('button', { name: 'Date' }));
    expect(titles()[0]).toBe('Meycauayan Warehouse 800 sqm');
    await userEvent.click(within(list()).getByRole('button', { name: 'Date' }));
    expect(titles()[0]).toBe('Seaside Residences 2BR, Pasay');
    await userEvent.click(within(list()).getByRole('button', { name: 'Time posted' }));
    expect(titles()[0]).toBe('Verdant Hills Lot 12, Tagaytay');
  });

  it('opens a listing’s whole history beside the list: who, when, the cooldown and who holds it', async () => {
    const onOpenLink = vi.fn();
    render(<Harness onOpenLink={onOpenLink} />);
    const button = within(list()).getByRole('button', { name: KAPITOLYO });
    await userEvent.click(button);
    const panel = screen.getByRole('complementary', { name: KAPITOLYO });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: KAPITOLYO }));
    expect(within(panel).getByText('In cooldown')).toBeTruthy();
    expect(within(panel).getByText('Can post again').nextElementSibling!.textContent).toBe('Mon 9 Nov');
    expect(within(panel).getByText('Queued').nextElementSibling!.textContent).toBe('Bea Lim · 2–6 Nov');
    // Every post, from before the period too, newest first.
    const items = within(panel).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Mon 2 Nov, 10:15 AMPostedOpenJan Dela Cruz · APG Main', 'Tue 1 Sep, 9:00 AMPostedOpenMika Reyes · APG Main']);
    await userEvent.click(within(panel).getAllByRole('button', { name: /Open the post/ })[1]!);
    expect(onOpenLink).toHaveBeenCalledWith('https://www.facebook.com/groups/x/posts/1Kapitolyo0900/');

    // Escape closes it, and focus goes back to the title.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(button);

    // A listing nobody holds, out of its cooldown.
    render(<Harness start={presetPeriod('last-week', WED)} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Old listing D' })[0]!);
    const other = screen.getByRole('complementary', { name: 'Old listing D' });
    expect(within(other).getByText('Ready to post')).toBeTruthy();
    expect(within(other).getByText('Queued').nextElementSibling!.textContent).toBe('No one');
  });

  it('exports the list as the owner’s sheet: its columns in its order, its date and time', async () => {
    const onExport = vi.fn();
    render(<Harness onExport={onExport} />);
    await userEvent.click(screen.getByRole('button', { name: /^Tue 3 Nov/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const [csv, name] = onExport.mock.calls[0]!;
    expect(name).toBe('posts 2026-11-02 to 2026-11-08.csv');
    expect((csv as string).split('\r\n')).toEqual([
      'Date,Property type,Property title,FB account name,Link,Time posted,Share posting,Posted by',
      '11/3/26,Condo / House and Lot,"Verdant Hills Lot 12, Tagaytay",Bea Lim Realty,https://www.facebook.com/groups/x/posts/1Verdant1600/,4:00 PM,Posted,Bea Lim',
      '11/3/26,Warehouse,"Valenzuela Warehouse 1,200 sqm",APG Main,https://www.facebook.com/groups/x/posts/1Valenzuela1430/,2:30 PM,Posted,Jan Dela Cruz',
      '11/3/26,Office Space,"BGC Uptown Office 18F, 240 sqm",APG Main,https://www.facebook.com/groups/x/posts/1BgcUptown0840/,8:40 AM,Pending,Jan Dela Cruz',
      '',
    ]);
  });

  it('pages a long list, 50 at a time', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      post(`Listing ${String(i).padStart(3, '0')}`, `L${i}`, '2026-11-03', `${String(8 + (i % 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, 'Jan Dela Cruz'),
    );
    render(<Harness posts={many} />);
    expect(rows()).toHaveLength(50);
    const pages = within(list()).getByRole('navigation', { name: 'Pages' });
    expect(pages.textContent).toContain('1–50 of 120');
    await userEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    await userEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(pages.textContent).toContain('101–120 of 120');
    expect(rows()).toHaveLength(20);
    expect(within(pages).getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
  });

  it('writes the interns’ date and time formats in the CSV, and defuses formulas', () => {
    const csv = postsCsv([
      { ...POSTS[0]!, date: '2026-01-05', time: '00:07' },
      { ...POSTS[0]!, date: '2026-12-25', time: '12:00', title: 'Say "hi", =SUM(1)', fbAccount: '=cmd' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]!.startsWith('1/5/26,')).toBe(true);
    expect(lines[1]).toContain(',12:07 AM,');
    expect(lines[2]).toContain(`"Say ""hi"", =SUM(1)"`);
    expect(lines[2]).toContain(`,'=cmd,`);
  });
});

// ------------------------------------------------------------------ the route

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function renderRecords(path: string, platform = fakeServer({ posts: { ok: true, posts: POSTS.map((p) => ({ ...p })) } })) {
  render(
    <AppStateProvider platform={platform} initialUser={admin} initialSettings={{ scriptUrl: EXEC }} now={() => NOW}>
      <MemoryRouter initialEntries={[path]} future={routerFuture}>
        <AppShell />
        <Where />
      </MemoryRouter>
    </AppStateProvider>,
  );
  return platform;
}

describe('the Records route', () => {
  // Today is Sat 31 Oct 2026 (testing.ts): this week is the one that just ended, 26–30 Oct.
  const where = () => screen.getByTestId('where').textContent;

  it('keeps the period in the link, this week being the default', async () => {
    renderRecords('/records');
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeTruthy();
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByText('26–30 Oct')).toBeTruthy();
    expect(where()).toBe('');

    await userEvent.click(within(period).getByRole('button', { name: 'Last week' }));
    expect(where()).toBe('?period=week&from=2026-10-19');
    await userEvent.click(within(period).getByRole('button', { name: 'Week before' }));
    expect(where()).toBe('?period=week&from=2026-10-12');
    await userEvent.click(within(period).getByRole('button', { name: 'This month' }));
    expect(where()).toBe('?period=month&from=2026-10-01');
    await userEvent.click(within(period).getByRole('button', { name: 'Last 30 days' }));
    expect(where()).toBe('?period=30d&to=2026-10-31');
    await userEvent.click(within(period).getByRole('button', { name: '30 days before' }));
    expect(where()).toBe('?period=30d&to=2026-10-01');
    await userEvent.click(within(period).getByRole('button', { name: 'This week' }));
    expect(where()).toBe('');
  });

  it('opens on the period a link names', async () => {
    renderRecords('/records?period=custom&from=2026-09-01&to=2026-10-31');
    const period = await screen.findByRole('group', { name: 'Period' });
    expect(within(period).getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(period).getByText('1 Sep – 31 Oct')).toBeTruthy();
    // 61 days: a bar a day, and the four posts of those days.
    await waitFor(() => expect(count()).toBe('4 posts'));
  });

  it('is in an admin’s nav, between Interns and Find, and copies the CSV on the desktop', async () => {
    const platform = renderRecords('/records?period=30d&to=2026-10-31');
    expect(await screen.findByRole('link', { name: 'Records' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Records' }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(count()).toBe('3 posts'));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(platform.copied[0]).toMatch(/^Date,Property type,Property title,FB account name,Link,Time posted,Share posting,Posted by\r\n/));
    expect(await screen.findByText('CSV copied. Paste it into a spreadsheet.')).toBeTruthy();
  });

  it('is out of an intern’s reach', async () => {
    renderApp({ platform: fakeServer(), user: intern, path: '/records?period=month&from=2026-10-01' });
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Records' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Records' })).toBeNull();
  });
});
