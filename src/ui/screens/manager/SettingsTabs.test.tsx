// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPECTED_SERVER_VERSION } from '@/config';
import { admin, fakeServer, intern, renderApp } from '../../state/testing';
import { SettingsListings } from './SettingsListings';

const setChoice = vi.fn();
vi.mock('../../state/theme', () => ({
  useTheme: () => ({ choice: 'dark', resolved: 'dark', setChoice }),
}));

afterEach(cleanup);

const RULES = { cooldownDays: 7, repostDueDays: 14, perIntern: 20 };
const ping = (version: string, rules: object | null = RULES) => ({
  ok: true,
  name: admin.name,
  role: 'Admin',
  fbAccounts: '',
  version,
  ...(rules ? { rules } : {}),
});
const actionsOf = (platform: ReturnType<typeof fakeServer>) => platform.posts.map((p) => p.action);
const tab = (name: string) => screen.getByRole('tab', { name });

describe('Settings tabs', () => {
  it('opens on Team, and the tab lives in the URL', async () => {
    renderApp({ platform: fakeServer({ ping: ping(EXPECTED_SERVER_VERSION) }), user: admin, path: '/settings' });
    const list = screen.getByRole('tablist', { name: 'Settings' });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Team', 'Listings', 'Rules', 'App']);
    expect(tab('Team').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Team' })).toBeTruthy();

    await userEvent.click(tab('App'));
    expect(tab('App').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'App' })).toBeTruthy();
    expect(screen.getByLabelText('Web app link')).toBeTruthy();
  });

  it('opens the tab the URL names, and falls back to Team for one it does not know', () => {
    const { unmount } = renderApp({ platform: fakeServer(), user: admin, path: '/settings?tab=rules' });
    expect(tab('Rules').getAttribute('aria-selected')).toBe('true');
    unmount();
    renderApp({ platform: fakeServer(), user: admin, path: '/settings?tab=nope' });
    expect(tab('Team').getAttribute('aria-selected')).toBe('true');
  });

  it('moves between tabs with the arrow keys, Home and End, focus following', async () => {
    renderApp({ platform: fakeServer(), user: admin, path: '/settings' });
    tab('Team').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Listings'));
    expect(tab('Listings').getAttribute('aria-selected')).toBe('true');
    expect(tab('Listings').tabIndex).toBe(0);
    expect(tab('Team').tabIndex).toBe(-1);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(tab('App'));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(tab('Team'));
    await userEvent.keyboard('{End}');
    expect(tab('App').getAttribute('aria-selected')).toBe('true');
  });

  it("can't be reached by an intern", () => {
    renderApp({ platform: fakeServer(), user: intern, path: '/settings?tab=rules' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My queue');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });
});

describe('Settings → Listings', () => {
  const CHECK = {
    ok: true,
    checkedAt: '31 Oct 2026, 10:00',
    directoryCount: 1474,
    checkerCount: 1471,
    directoryOnly: [{ id: 'd1', name: 'Kapitolyo Ground Floor Retail, Pasig' }],
    checkerOnly: [],
    sold: [
      { id: 's1', name: 'Seaside Residences 2BR, Pasay' },
      { id: 's2', name: 'Verdant Hills Lot 12, Tagaytay' },
    ],
  };

  it('says when the directory was built, and rebuilds only after asking', async () => {
    const platform = fakeServer({
      indexCheck: CHECK,
      directoryStatus: { ok: true, running: false, done: 1474, total: 1474, builtAt: '2026-10-31T18:04:00+08:00' },
      rebuildDirectory: { ok: true, started: true },
    });
    renderApp({ platform, user: admin, path: '/settings?tab=listings' });
    const card = screen.getByRole('region', { name: 'Directory' });
    expect(await within(card).findByText('Built Sat 31 Oct, 6:04 PM · 1,474 listings')).toBeTruthy();

    await userEvent.click(within(card).getByRole('button', { name: 'Rebuild directory' }));
    const ask = screen.getByRole('dialog', { name: 'Rebuild the directory?' });
    expect(within(ask).getByText('Takes about 30–60 min. The app keeps working with the current list.')).toBeTruthy();
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(actionsOf(platform)).not.toContain('rebuildDirectory');

    await userEvent.click(within(ask).getByRole('button', { name: 'Rebuild' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(actionsOf(platform).filter((a) => a === 'rebuildDirectory')).toHaveLength(1);
    expect(within(card).getByText('Starting the build…')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Rebuild directory' })).toHaveProperty('disabled', true);
  });

  it('shows the listings check: counts, the reason, and lists with search and Open in Drive', async () => {
    const platform = fakeServer({
      indexCheck: CHECK,
      directoryStatus: { ok: true, running: false, done: 0, total: 0, builtAt: '' },
    });
    renderApp({ platform, user: admin, path: '/settings?tab=listings' });
    const card = screen.getByRole('region', { name: 'Listings check' });
    // It runs on arrival.
    expect(await within(card).findByText('1,474')).toBeTruthy();
    expect(within(card).getByText('1,471')).toBeTruthy();
    expect(
      within(card).getByText('Sold listings are left out of the directory on purpose. Listings added after the last build show as only in checker.'),
    ).toBeTruthy();
    expect(within(card).getByText('Only in checker').closest('summary')).toBeNull();
    expect(screen.getByText('Not built yet')).toBeTruthy();

    const sold = within(card).getByText('Sold').closest('details')!;
    await userEvent.click(within(sold).getByText('Sold'));
    await userEvent.type(within(sold).getByRole('searchbox', { name: 'Search sold' }), 'verdant');
    const list = within(sold).getByRole('list', { name: 'Sold' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(within(list).getByRole('button', { name: 'Open Verdant Hills Lot 12, Tagaytay in Drive' }));
    await waitFor(() => expect(platform.opened).toEqual(['https://drive.google.com/drive/folders/s2']));
  });

  it('pages a long list ten at a time, inside its fold', async () => {
    const sold = Array.from({ length: 23 }, (_, i) => ({ id: `s${i}`, name: `Sold listing ${String(i + 1).padStart(2, '0')}` }));
    renderApp({
      platform: fakeServer({ indexCheck: { ...CHECK, sold }, directoryStatus: { ok: true, running: false, done: 0, total: 0, builtAt: '' } }),
      user: admin,
      path: '/settings?tab=listings',
    });
    const card = screen.getByRole('region', { name: 'Listings check' });
    const fold = (await within(card).findByText('Sold')).closest('details')!;
    await userEvent.click(within(fold).getByText('Sold'));
    const list = within(fold).getByRole('list', { name: 'Sold' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    const nav = within(fold).getByRole('navigation', { name: 'Sold, pages' });
    await userEvent.click(within(nav).getByRole('button', { name: 'Page 3' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent?.replace('Open in Drive', ''))).toEqual([
      'Sold listing 21',
      'Sold listing 22',
      'Sold listing 23',
    ]);
    // A search starts at its first page; ten or fewer have none.
    await userEvent.type(within(fold).getByRole('searchbox', { name: 'Search sold' }), 'listing 1');
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(within(fold).queryByRole('navigation')).toBeNull();
  });

  it('reads the build every poll while it runs, and stops when it is done', async () => {
    const replies = [
      { running: true, done: 320, total: 1797, builtAt: '' },
      { running: true, done: 900, total: 1797, builtAt: '' },
      { running: false, done: 1797, total: 1797, builtAt: '2026-10-31T19:10:00+08:00' },
    ];
    let i = 0;
    const read = vi.fn(async () => replies[Math.min(i++, replies.length - 1)]!);
    render(<SettingsListings onDirectoryStatus={read} pollMs={30} />);

    expect(await screen.findByText('Building… 320 of 1,797')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Directory build' }).getAttribute('aria-valuenow')).toBe('320');
    expect(await screen.findByText('Building… 900 of 1,797')).toBeTruthy();
    expect(await screen.findByText('Built Sat 31 Oct, 7:10 PM · 1,797 listings')).toBeTruthy();
    const reads = read.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(read.mock.calls.length).toBe(reads);
    expect(reads).toBe(3);
  });

  it('polls every 10 s by default', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      const read = vi.fn(async () => ({ running: true, done: 1, total: 10, builtAt: '' }));
      render(<SettingsListings onDirectoryStatus={read} />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(read).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(9_900));
      expect(read).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Settings → Rules', () => {
  it('checks each rule, then saves them through setRules', async () => {
    const platform = fakeServer({
      ping: ping(EXPECTED_SERVER_VERSION),
      setRules: (body) => ({ ok: true, rules: { ...RULES, ...body } }),
    });
    renderApp({ platform, user: admin, path: '/settings?tab=rules' });
    const cooldown = (await screen.findByLabelText('Cooldown')) as HTMLInputElement;
    await waitFor(() => expect(cooldown.value).toBe('7'));
    expect(screen.getByText('Days before a listing can be posted again.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);

    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '90');
    await userEvent.click(save);
    expect(screen.getByText('Use a whole number from 1 to 60.')).toBeTruthy();
    expect(cooldown.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(cooldown);
    expect(actionsOf(platform)).not.toContain('setRules');

    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '10');
    await userEvent.click(screen.getByRole('button', { name: 'More: Listings per week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fewer: Due for repost' }));
    await userEvent.click(save);

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(platform.posts.find((p) => p.action === 'setRules')!.body).toMatchObject({ cooldownDays: 10, repostDueDays: 13, perWeek: 21 });
    expect(save).toHaveProperty('disabled', true);
  });

  it('resets to what is saved', async () => {
    renderApp({ platform: fakeServer({ ping: ping(EXPECTED_SERVER_VERSION) }), user: admin, path: '/settings?tab=rules' });
    const per = (await screen.findByLabelText('Listings per week')) as HTMLInputElement;
    await waitFor(() => expect(per.value).toBe('20'));
    await userEvent.clear(per);
    await userEvent.type(per, '35');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(per.value).toBe('20');
  });

  it('reads perWeek from a v6 server, and saves it under that name', async () => {
    const V6 = { cooldownDays: 7, repostDueDays: 14, perWeek: 40 };
    const platform = fakeServer({
      ping: ping(EXPECTED_SERVER_VERSION, V6),
      setRules: (body) => ({ ok: true, rules: { ...V6, ...body } }),
    });
    renderApp({ platform, user: admin, path: '/settings?tab=rules' });
    const per = (await screen.findByLabelText('Listings per week')) as HTMLInputElement;
    await waitFor(() => expect(per.value).toBe('40'));
    expect(screen.getByText('Each agent’s target per week of a queue.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fewer: Listings per week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(platform.posts.find((p) => p.action === 'setRules')!.body).toMatchObject({ perWeek: 39 });
    expect(per.value).toBe('39');
  });

  it('asks the server once on arrival, even when its rules differ from the kept ones', async () => {
    // An old server's perIntern (20) is not the kept default (40): the settings
    // the app hands out change when the ping lands, and must not ask again.
    const platform = fakeServer({ ping: ping(EXPECTED_SERVER_VERSION) });
    renderApp({ platform, user: admin, path: '/settings?tab=rules' });
    const per = (await screen.findByLabelText('Listings per week')) as HTMLInputElement;
    await waitFor(() => expect(per.value).toBe('20'));
    const pings = actionsOf(platform).filter((a) => a === 'ping').length;
    await new Promise((r) => setTimeout(r, 50));
    expect(actionsOf(platform).filter((a) => a === 'ping').length).toBe(pings);
    expect(pings).toBeLessThanOrEqual(2);
  });

  it('shows the rules read-only when the web app sends none', async () => {
    renderApp({ platform: fakeServer({ ping: ping('', null) }), user: admin, path: '/settings?tab=rules' });
    expect(await screen.findByText(/can’t save rules yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('Settings → App', () => {
  it('says the web app is up to date', async () => {
    renderApp({ platform: fakeServer({ ping: ping(EXPECTED_SERVER_VERSION) }), user: admin, path: '/settings?tab=app' });
    expect(await screen.findByText('Up to date')).toBeTruthy();
    expect(screen.queryByText('How to deploy')).toBeNull();
  });

  it('says the web app is behind, with the steps folded', async () => {
    renderApp({ platform: fakeServer({ ping: ping('2020-01-01.1') }), user: admin, path: '/settings?tab=app' });
    expect(await screen.findByText('Behind: deploy a New version in Apps Script')).toBeTruthy();
    const how = screen.getByText('How to deploy').closest('details')!;
    expect(how.open).toBe(false);
    expect(within(how).getAllByRole('listitem')).toHaveLength(4);
  });

  it('switches the theme through setChoice', async () => {
    renderApp({ platform: fakeServer(), user: admin, path: '/settings?tab=app' });
    const theme = screen.getByRole('group', { name: 'Theme' });
    expect(within(theme).getByRole('radio', { name: 'Dark' })).toHaveProperty('checked', true);
    await userEvent.click(within(theme).getByRole('radio', { name: 'Light' }));
    expect(setChoice).toHaveBeenCalledWith('light');
    await userEvent.click(within(theme).getByRole('radio', { name: 'System' }));
    expect(setChoice).toHaveBeenLastCalledWith('system');
  });

  it("shows this app's version", () => {
    renderApp({ platform: fakeServer(), user: admin, path: '/settings?tab=app' });
    const about = screen.getByRole('region', { name: 'About' });
    expect(within(about).getByText('Version').nextElementSibling?.textContent).toBe('1.1.5');
  });
});

describe('Settings → Rules: the queue length (v14)', () => {
  it('reads the queue length, and saves it as queueWeeks', async () => {
    const V14 = { cooldownDays: 7, repostDueDays: 14, perWeek: 40, queueWeeks: 2 };
    const platform = fakeServer({
      ping: ping(EXPECTED_SERVER_VERSION, V14),
      setRules: (body) => ({ ok: true, rules: { ...V14, ...body } }),
    });
    renderApp({ platform, user: admin, path: '/settings?tab=rules' });
    const length = (await screen.findByLabelText('Queue length')) as HTMLInputElement;
    await waitFor(() => expect(length.value).toBe('2'));
    await userEvent.click(screen.getByRole('button', { name: 'More: Queue length' }));
    expect(length.value).toBe('3');
    // 3 weeks is the longest.
    expect((screen.getByRole('button', { name: 'More: Queue length' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(platform.posts.find((p) => p.action === 'setRules')!.body).toMatchObject({ queueWeeks: 3 });
  });
});
