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
const posts = () => tile('Posts').querySelector('.records-tile__value')!.textContent;

describe('RecordsScreen', () => {
  it('sums up the period in five tiles, each against the same days of the period before', async () => {
    render(<Harness />);
    // Read out as label, number, change; the arrow is drawn, "Up" is said.
    expect(tile('Posts').textContent).toBe('Posts6↑Up 4 vs 26–28 Oct');
    expect(tile('Pending').textContent).toBe('Pending1↑Up 1 vs 26–28 Oct');
    // No week of the period has ended yet: nothing can be missed.
    expect(tile('Missed').textContent).toBe('Missed–After Fri 6 Nov');
    expect(tile('Active agents').textContent).toBe('Active agents3↑Up 1 vs 26–28 Oct');
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
    expect(posts()).toBe('3');

    await userEvent.click(within(period).getByRole('button', { name: 'Last 30 days' }));
    expect(within(period).getByText('6 Oct – 4 Nov')).toBeTruthy();

    // Custom: two dates, in either order.
    await userEvent.click(within(period).getByRole('button', { name: 'Custom' }));
    fireEvent.change(within(period).getByLabelText('From'), { target: { value: '2026-11-03' } });
    expect(within(period).getByText('3–4 Nov')).toBeTruthy();
    expect(posts()).toBe('4');
  });

  it('has no list of posts, no FB account tab and no history panel: the overview only', () => {
    render(<Harness />);
    expect(screen.queryByRole('region', { name: 'Posts' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'By FB account' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: KAPITOLYO })).toBeNull();
    const breakdown = screen.getByRole('region', { name: 'Breakdown' });
    expect(within(breakdown).getAllByRole('tab').map((t) => t.textContent)).toEqual(['By agent', 'By category']);
  });

  it('shows a bar’s numbers on hover or focus, and a bar does nothing else', async () => {
    render(<Harness />);
    const chart = screen.getByRole('group', { name: 'Posts by day' });
    // Days still to come have no bar.
    const bars = within(chart).getAllByRole('img');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mon 2 Nov: 2 posted, 0 pending',
      'Tue 3 Nov: 2 posted, 1 pending',
      'Wed 4 Nov: 1 posted, 0 pending',
    ]);
    expect(within(chart).queryAllByRole('button')).toHaveLength(0);
    // One tab stop, the latest day.
    expect(bars.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);

    await userEvent.hover(bars[1]!);
    expect(document.querySelector('.rchart__tip')!.textContent).toBe('Tue 3 Nov2 Posted1 Pending');
    await userEvent.click(bars[1]!);
    expect(posts()).toBe('6');
    await userEvent.unhover(bars[1]!);
    expect(document.querySelector('.rchart__tip')).toBeNull();

    // The arrow keys move along the bars.
    bars[2]!.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(bars[1]);
    expect(document.querySelector('.rchart__tip')!.textContent).toContain('Tue 3 Nov');
  });

  it('breaks the period down by intern and by category; an intern opens their week on Interns', async () => {
    const onOpenIntern = vi.fn();
    render(<Harness internsHref={(week) => `#/interns?week=${week}`} onOpenIntern={onOpenIntern} />);
    const breakdown = screen.getByRole('region', { name: 'Breakdown' });
    expect(within(breakdown).getByRole('tab', { name: 'By agent' }).getAttribute('aria-selected')).toBe('true');
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

    const jan = within(breakdown).getByRole('link', { name: 'Jan Dela Cruz' });
    expect(jan.getAttribute('href')).toBe('#/interns?week=2026-11-02');
    await userEvent.click(jan);
    expect(onOpenIntern).toHaveBeenCalledWith('Jan Dela Cruz', '2026-11-02');

    // Categories are read, not picked: no buttons, no links.
    await userEvent.click(within(breakdown).getByRole('tab', { name: 'By category' }));
    const categories = within(breakdown).getByRole('list', { name: 'Category' });
    expect(within(categories).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Condo / House and Lot2 posts, 0 pending',
      'Warehouse2 posts, 0 pending',
      'Commercial Space1 post, 0 pending',
      'Office Space1 post, 1 pending',
    ]);
    expect(within(breakdown).queryAllByRole('button')).toHaveLength(0);
    expect(within(breakdown).queryAllByRole('link')).toHaveLength(0);

    // The arrow keys move between the two tabs.
    within(breakdown).getByRole('tab', { name: 'By category' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(breakdown).getByRole('tab', { name: 'By agent' }).getAttribute('aria-selected')).toBe('true');

    // Last week's period opens Interns on last week.
    await userEvent.click(screen.getByRole('button', { name: 'Last week' }));
    expect(screen.getByRole('link', { name: 'Jan Dela Cruz' }).getAttribute('href')).toBe('#/interns?week=2026-10-26');
  });

  it('exports every post of the period as the owner’s sheet: its columns in its order, its date and time', async () => {
    const onExport = vi.fn();
    render(<Harness onExport={onExport} start={presetPeriod('last-week', WED)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const [csv, name] = onExport.mock.calls[0]!;
    expect(name).toBe('posts 2026-10-26 to 2026-11-01.csv');
    expect((csv as string).split('\r\n')).toEqual([
      'Date,Property type,Property title,FB account name,Link,Time posted,Share posting,Posted by',
      '10/30/26,Commercial Space,Friday listing,APG Main,https://www.facebook.com/groups/x/posts/F1100/,11:00 AM,Posted,Jan Dela Cruz',
      '10/27/26,Commercial Space,Old listing D,APG Main,https://www.facebook.com/groups/x/posts/D1100/,11:00 AM,Posted,Mika Reyes',
      '10/27/26,Commercial Space,Old listing A,APG Main,https://www.facebook.com/groups/x/posts/A1000/,10:00 AM,Posted,Jan Dela Cruz',
      '',
    ]);

    // This week: all six, whatever bar is hovered.
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));
    await userEvent.hover(screen.getByRole('img', { name: /^Tue 3 Nov/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect((onExport.mock.calls[1]![0] as string).split('\r\n')).toHaveLength(8);
    expect(onExport.mock.calls[1]![1]).toBe('posts 2026-11-02 to 2026-11-08.csv');

    // A period with no posts has nothing to export.
    await userEvent.click(screen.getByRole('button', { name: 'Week before' }));
    await userEvent.click(screen.getByRole('button', { name: 'Week before' }));
    expect(screen.getByRole('button', { name: 'Export CSV' }).hasAttribute('disabled')).toBe(true);
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
    await waitFor(() => expect(posts()).toBe('4'));
  });

  it('is in an admin’s nav, between Interns and Find, and copies the CSV on the desktop', async () => {
    const platform = renderRecords('/records?period=30d&to=2026-10-31');
    expect(await screen.findByRole('link', { name: 'Records' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Records' }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(posts()).toBe('3'));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(platform.copied[0]).toMatch(/^Date,Property type,Property title,FB account name,Link,Time posted,Share posting,Posted by\r\n/));
    expect(await screen.findByText('CSV copied. Paste it into a spreadsheet.')).toBeTruthy();
  });

  it('opens Interns on the period’s week from an intern’s row', async () => {
    renderRecords('/records');
    // This week, the one that just ended, is the week Interns opens on anyway: no ?week=.
    await waitFor(() => expect(posts()).toBe('3'));
    expect(screen.getByRole('link', { name: 'Mika Reyes' }).getAttribute('href')).toBe('#/interns');

    // September: its last week.
    await userEvent.click(screen.getByRole('button', { name: 'This month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Month before' }));
    await waitFor(() => expect(posts()).toBe('1'));
    const mika = screen.getByRole('link', { name: 'Mika Reyes' });
    expect(mika.getAttribute('href')).toBe('#/interns?week=2026-09-28');
    await userEvent.click(mika);
    expect(await screen.findByRole('heading', { level: 1, name: 'Agents' })).toBeTruthy();
    expect(where()).toBe('?week=2026-09-28');
  });

  it('is out of an intern’s reach', async () => {
    renderApp({ platform: fakeServer(), user: intern, path: '/records?period=month&from=2026-10-01' });
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Records' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Records' })).toBeNull();
  });
});
