// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PostLogEntry } from '@/core/types';
import { admin, fakeServer, intern, renderApp, TODAY } from '../../state/testing';
import { postsCsv, RecordsScreen } from './RecordsScreen';

const post = (title: string, id: string, date: string, time: string, by: string, status: 'Posted' | 'Pending' = 'Posted'): PostLogEntry => ({
  date,
  time,
  type: 'Commercial Space',
  title,
  status,
  fbAccount: 'APG Main',
  postLink: `https://www.facebook.com/groups/x/posts/${id}${time.replace(':', '')}/`,
  postedBy: by,
  propertyId: id,
});

const POSTS: PostLogEntry[] = [
  post('Kapitolyo Ground Floor Retail, Pasig', '1Kapitolyo', '2026-09-01', '09:00', 'Mika Reyes'),
  post('Kapitolyo Ground Floor Retail, Pasig', '1Kapitolyo', '2026-10-30', '10:15', intern.name),
  post('BGC Uptown Office 18F, 240 sqm', '1BgcUptown', '2026-10-31', '08:40', intern.name, 'Pending'),
  post('Seaside Residences 2BR, Pasay', '1Seaside', '2026-10-31', '09:05', 'Mika Reyes'),
];

describe('RecordsScreen', () => {
  it('shows daily totals for the range, newest day first', async () => {
    render(<RecordsScreen posts={POSTS} today={TODAY} />);
    const daily = screen.getByRole('region', { name: 'Posts per day' });
    const rows = within(within(daily).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(7);
    expect(rows[0]!.textContent).toBe('Sat 31 Oct11Jan 1 · Mika 1');
    expect(rows[1]!.textContent).toContain('Fri 30 Oct10');

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(within(within(daily).getByRole('table')).getAllByRole('row')).toHaveLength(2);
  });

  it('searches by property, intern or link, and opens a property’s whole history', async () => {
    const onOpenLink = vi.fn();
    render(<RecordsScreen posts={POSTS} today={TODAY} onOpenLink={onOpenLink} />);
    const results = screen.getByRole('region', { name: 'Posts' });
    expect(within(results).getByText('3 posts')).toBeTruthy();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search posts' }), 'kapitolyo');
    expect(within(results).getByText('1 post')).toBeTruthy();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search posts' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search posts' }), 'mika');
    expect(within(results).getByText('1 post')).toBeTruthy();
    expect(within(results).getByText('Seaside Residences 2BR, Pasay')).toBeTruthy();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search posts' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search posts' }), 'posts/1BgcUptown');
    const row = within(results).getAllByRole('row')[1]!;
    expect(row.textContent).toContain('BGC Uptown Office');
    expect(row.textContent).toContain('Pending');
    await userEvent.click(within(row).getByRole('button', { name: /Open the post/ }));
    expect(onOpenLink).toHaveBeenCalledWith('https://www.facebook.com/groups/x/posts/1BgcUptown0840/');

    // Kapitolyo's history reaches back past the range: who posted it, and when.
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search posts' }));
    await userEvent.click(within(results).getByRole('button', { name: 'Kapitolyo Ground Floor Retail, Pasig' }));
    const history = screen.getByRole('dialog', { name: 'Kapitolyo Ground Floor Retail, Pasig' });
    expect(within(history).getByText(`2 posts, last Fri 30 Oct by ${intern.name}`)).toBeTruthy();
    const lines = within(history).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(lines[0]).toContain(intern.name);
    expect(lines[1]).toContain('Mika Reyes');
    expect(lines[1]).toContain('Tue 1 Sep');
  });

  it('exports the current results as CSV', async () => {
    const onExport = vi.fn();
    render(<RecordsScreen posts={POSTS} today={TODAY} onExport={onExport} initialRange="today" />);
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const [csv, name] = onExport.mock.calls[0]!;
    expect(name).toBe('posts 2026-10-31 to 2026-10-31.csv');
    expect((csv as string).split('\r\n')).toEqual([
      // The interns' own sheet's columns, in its order, then Posted by; its date (M/D/YY) and time (h:mm AM/PM).
      'Date,Property type,Property title,FB account name,Link,Time posted,Share posting,Posted by',
      '10/31/26,Commercial Space,"Seaside Residences 2BR, Pasay",APG Main,https://www.facebook.com/groups/x/posts/1Seaside0905/,9:05 AM,Posted,Mika Reyes',
      '10/31/26,Commercial Space,"BGC Uptown Office 18F, 240 sqm",APG Main,https://www.facebook.com/groups/x/posts/1BgcUptown0840/,8:40 AM,Pending,Jan Dela Cruz',
      '',
    ]);
  });

  it('writes the interns\' date and time formats in the CSV, afternoon and midnight included', () => {
    const csv = postsCsv([
      { ...POSTS[0]!, date: '2026-01-05', time: '00:07' },
      { ...POSTS[0]!, date: '2026-12-25', time: '12:00' },
      { ...POSTS[0]!, date: '2026-10-26', time: '22:23' },
      { ...POSTS[0]!, date: '', time: '' },
    ]);
    const cells = csv.split('\r\n').slice(1, 5).map((line) => [line.split(',')[0], line.split(',').at(-3)]);
    expect(cells).toEqual([
      ['1/5/26', '12:07 AM'],
      ['12/25/26', '12:00 PM'],
      ['10/26/26', '10:23 PM'],
      ['', ''],
    ]);
  });

  it('shows the Posts table in the interns\' sheet\'s column order', () => {
    render(<RecordsScreen posts={POSTS} today={TODAY} initialRange="today" />);
    const results = screen.getByRole('region', { name: 'Posts' });
    const head = within(results).getAllByRole('columnheader').map((h) => h.textContent);
    expect(head).toEqual(['Date', 'Property type', 'Property title', 'FB account name', 'Link', 'Time posted', 'Share posting', 'Posted by']);
    const first = within(results).getAllByRole('row')[1]!;
    const cells = Array.from(first.querySelectorAll('td, th')).map((c) => c.textContent);
    expect(cells).toEqual(['Sat 31 Oct', 'Commercial Space', 'Seaside Residences 2BR, Pasay', 'APG Main', 'No link', '9:05 AM', 'Posted', 'Mika Reyes']);
  });

  it('quotes CSV cells and defuses formulas', () => {
    const csv = postsCsv([{ ...POSTS[0]!, title: 'Say "hi", =SUM(1)', fbAccount: '=cmd' }]);
    expect(csv.split('\r\n')[1]).toContain(`"Say ""hi"", =SUM(1)"`);
    expect(csv.split('\r\n')[1]).toContain(`,'=cmd,`);
  });
});

describe('the Records route', () => {
  const raw = POSTS.map((p) => ({ ...p }));

  it('is in an admin’s nav, between Interns and Find, and copies the CSV on the desktop', async () => {
    const platform = fakeServer({ posts: { ok: true, posts: raw } });
    renderApp({ platform, user: admin, path: '/records' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Records' }).getAttribute('aria-current')).toBe('page');
    await screen.findByText('3 posts');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(platform.copied[0]).toMatch(/^Date,Property type,Property title,/));
    expect(await screen.findByText('CSV copied. Paste it into a spreadsheet.')).toBeTruthy();
  });

  it('is out of an intern’s reach', async () => {
    renderApp({ platform: fakeServer(), user: intern, path: '/records' });
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Records' })).toBeNull();
  });
});
