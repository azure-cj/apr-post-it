// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '@/core/types';
import type { FakePlatform } from '@/platform/fake';
import { AppShell, routerFuture } from '../../App';
import { AppStateProvider } from '../../state/AppState';
import { admin, EXEC, fakeServer, intern, manager, renderApp } from '../../state/testing';

// No web app link built in: these tests sign in with the two-field form and
// must not depend on the real link in src/config.ts.
vi.mock('@/config', () => ({ BUILT_IN_SCRIPT_URL: '' }));

/** Thu 5 Nov 2026, 10:00 in Manila: the fourth day of the week of Mon 2 Nov. */
const THURSDAY = Date.parse('2026-11-05T02:00:00Z');
const WEEK = '2026-11-02';
const LAST_WEEK = '2026-10-26';

/** The whole window at `path`, signed in as `user`, on a given day. */
function renderAt(now: number, { platform, user = admin, path = '/interns' }: { platform: FakePlatform; user?: User; path?: string }) {
  return render(
    <AppStateProvider platform={platform} initialUser={user} initialSettings={{ scriptUrl: EXEC }} now={() => now}>
      <MemoryRouter initialEntries={[path]} future={routerFuture}>
        <AppShell />
      </MemoryRouter>
    </AppStateProvider>,
  );
}

/** The team as the web app sends it: out of order, an admin, and a revoked intern. */
const TEAM = {
  ok: true,
  team: [
    { name: 'Mika Reyes', role: 'Intern', email: '', fbAccounts: '', active: true },
    { name: manager.name, role: 'Admin', email: '', fbAccounts: '', active: true },
    { name: 'Paolo Reyes', role: 'Intern', email: '', fbAccounts: 'APG Rentals South', active: false },
    {
      name: intern.name,
      role: 'Intern',
      email: '',
      fbAccounts: 'APG Main, APG Rentals South',
      fbProfileLink: 'https://www.facebook.com/jan.delacruz',
      active: true,
    },
    { name: 'Bea Lim', role: 'Intern', email: '', fbAccounts: '', active: true },
    { name: 'Carlo Mendoza', role: 'Intern', email: '', fbAccounts: '', active: true },
  ],
};

const row = (who: string, property: string, status: string, date = WEEK, propertyId = '') => ({ date, assignedTo: who, property, status, propertyId });
const queue = (who: string, n: number, date = WEEK) => Array.from({ length: n }, (_, i) => row(who, `${who} listing ${i + 1}`, 'Not Shared', date));

/**
 * This week (2–6 Nov):
 * - Jan: 10, of which 2 posted and 1 pending: behind (8 expected by Thursday).
 * - Mika: 5, 4 posted: on track.
 * - Bea: 5, nothing posted: not started.
 * - Carlo: 2, both posted: done.
 * Last week (26–30 Oct): Jan 4 of 4; Mika 1 of 3, so 2 missed.
 */
const ASSIGNMENTS = {
  ok: true,
  assignments: [
    row(intern.name, 'Kapitolyo Ground Floor Retail, Pasig', 'Posted', WEEK, '1Kapitolyo'),
    row(intern.name, 'BGC Uptown Office 18F, 240 sqm', 'Posted', WEEK, '1BgcUptown'),
    row(intern.name, 'Seaside Residences 2BR, Pasay', 'Pending', WEEK, '1Seaside'),
    ...queue(intern.name, 7),
    ...Array.from({ length: 5 }, (_, i) => row('Mika Reyes', `Mika listing ${i + 1}`, i < 4 ? 'Posted' : 'Not Shared')),
    ...queue('Bea Lim', 5),
    row('Carlo Mendoza', 'Carlo listing 1', 'Posted'),
    row('Carlo Mendoza', 'Carlo listing 2', 'Posted'),
    ...Array.from({ length: 4 }, (_, i) => row(intern.name, `Old listing ${i + 1}`, 'Posted', LAST_WEEK)),
    row('Mika Reyes', 'Kapitolyo Ground Floor Retail, Pasig', 'Posted', LAST_WEEK, '1Kapitolyo'),
    ...queue('Mika Reyes', 2, LAST_WEEK),
  ],
};

const post = (who: string, title: string, status: string, date: string, time: string, link = '', propertyId = '') => ({
  date,
  time,
  type: '',
  title,
  status,
  fbAccount: who === intern.name ? 'APG Main' : 'Mika Reyes APG',
  postLink: link,
  postedBy: who,
  propertyId,
});

const JAN_KAPITOLYO = 'https://www.facebook.com/groups/apgmain/posts/111/';
const MIKA_KAPITOLYO = 'https://www.facebook.com/groups/apgmain/posts/99/';

const POSTS = {
  ok: true,
  posts: [
    post(intern.name, 'Kapitolyo Ground Floor Retail, Pasig', 'Posted', '2026-11-02', '09:41', JAN_KAPITOLYO, '1Kapitolyo'),
    post(intern.name, 'BGC Uptown Office 18F, 240 sqm', 'Posted', '2026-11-02', '10:15', 'https://www.facebook.com/groups/apgmain/posts/112/', '1BgcUptown'),
    post(intern.name, 'Seaside Residences 2BR, Pasay', 'Pending', '2026-11-03', '11:02', 'https://www.facebook.com/groups/apgmain/posts/113/', '1Seaside'),
    ...[2, 3, 4, 5].map((d, i) => post('Mika Reyes', `Mika listing ${i + 1}`, 'Posted', `2026-11-0${d}`, '09:00', `https://www.facebook.com/groups/x/posts/${d}/`)),
    post('Carlo Mendoza', 'Carlo listing 1', 'Posted', '2026-11-04', '13:00', 'https://www.facebook.com/groups/x/posts/c1/'),
    post('Carlo Mendoza', 'Carlo listing 2', 'Posted', '2026-11-04', '14:00', 'https://www.facebook.com/groups/x/posts/c2/'),
    ...Array.from({ length: 4 }, (_, i) => post(intern.name, `Old listing ${i + 1}`, 'Posted', '2026-10-27', '10:00', `https://www.facebook.com/groups/x/posts/o${i}/`)),
    post('Mika Reyes', 'Kapitolyo Ground Floor Retail, Pasig', 'Posted', '2026-10-28', '15:20', MIKA_KAPITOLYO, '1Kapitolyo'),
  ],
};

const server = (replies = {}) => fakeServer({ team: TEAM, assignments: ASSIGNMENTS, posts: POSTS, ...replies });
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
const rowOf = async (name: string) => (await screen.findByRole('button', { name: new RegExp(name), expanded: false })).closest('tr')!;
const names = () => Array.from(document.querySelectorAll('.week-table__name')).map((n) => n.textContent);
const stat = (label: string) => within(document.querySelector('.tracker-stats') as HTMLElement).getByText(label).nextElementSibling!.textContent;

describe('the Interns screen: the week', () => {
  it('lists the active interns worst first, with the week so far, posts per day, pace and last post', async () => {
    renderAt(THURSDAY, { platform: server() });
    expect(heading()).toBe('Agents');
    expect(screen.getByRole('group', { name: 'Week' }).textContent).toContain('2–6 Nov');
    await waitFor(() => expect(names()).toEqual(['Bea Lim', intern.name, 'Mika Reyes', 'Carlo Mendoza']));

    const jan = await rowOf(intern.name);
    expect(jan.querySelector('.week-bar__count')!.textContent).toBe('3 / 10');
    expect(within(jan).getByText('Behind')).toBeTruthy();
    expect(jan.textContent).toContain('Tue 3 Nov, 11:02');
    expect((jan.querySelector('.week-bar__posted') as HTMLElement).style.width).toBe('20%');
    expect((jan.querySelector('.week-bar__pending') as HTMLElement).style.width).toBe('10%');

    // Mon–Fri: 2, 1, 0, then today (Thursday, ringed) 0, and Friday still to come.
    const days = Array.from(jan.querySelectorAll('.week-days__day'));
    expect(days.map((d) => d.getAttribute('data-count'))).toEqual(['2', '1', '0', '0', '0']);
    expect(days[3]!.classList.contains('week-days__day--today')).toBe(true);
    expect(days[4]!.classList.contains('week-days__day--later')).toBe(true);
    expect(jan.textContent).toContain('Posts: Mon 2, Tue 1, Wed 0, Thu 0');

    expect(within(await rowOf('Bea Lim')).getByText('Not started')).toBeTruthy();
    expect(within(await rowOf('Mika Reyes')).getByText('On track')).toBeTruthy();
    expect(within(await rowOf('Carlo Mendoza')).getByText('Done')).toBeTruthy();

    // Admins and revoked interns are not in the table.
    const table = screen.getByRole('table');
    expect(table.textContent).not.toContain(manager.name);
    expect(table.textContent).not.toContain('Paolo Reyes');

    // The week in four numbers.
    expect(stat('Posted')).toBe('8 of 22');
    expect(stat('Pending')).toBe('1');
    expect(stat('Left')).toBe('13');
    expect(stat('Behind')).toBe('2 of 4');

    // Thursday: those behind are named for Friday, with what is left and how many a day.
    const friday = screen.getByText('2 agents behind schedule').closest('.notice')!;
    expect(friday.querySelectorAll('li')).toHaveLength(2);
    expect(friday.textContent).toMatch(/left, 2 days to go: about \d+ a day\./);
  });

  it('shows a week that is over as Missed, and opens on it at the weekend', async () => {
    // Saturday 31 Oct: the week of 26–30 Oct has just ended.
    renderApp({ platform: server(), user: admin, path: '/interns' });
    expect((await screen.findByRole('group', { name: 'Week' })).textContent).toContain('26–30 Oct');
    const mika = await rowOf('Mika Reyes');
    expect(within(mika).getByText('Missed 2')).toBeTruthy();
    expect(mika.querySelector('.week-bar__count')!.textContent).toBe('1 / 3');
    expect(names()[0]).toBe('Mika Reyes');
    expect(within(await rowOf(intern.name)).getByText('Done')).toBeTruthy();
    expect(within(await rowOf('Bea Lim')).getByText('No queue')).toBeTruthy();
    // No day is still to come.
    expect(mika.querySelectorAll('.week-days__day--later')).toHaveLength(0);
    expect(stat('Missed')).toBe('2');
    expect(stat('Behind')).toBe('1 of 4');
  });

  it('follows the week picker', async () => {
    renderAt(THURSDAY, { platform: server() });
    await rowOf('Bea Lim');
    await userEvent.click(screen.getByRole('button', { name: 'Week before' }));
    expect(screen.getByRole('group', { name: 'Week' }).textContent).toContain('26–30 Oct');
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Missed 2')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));
    await waitFor(() => expect(names()[0]).toBe('Bea Lim'));
  });
});

describe('the Interns screen: who posted?', () => {
  const search = () => screen.getByRole('searchbox', { name: /Who posted\?/ });

  it('finds every post of a listing by name, newest first, with who, when, the FB account and status', async () => {
    renderAt(THURSDAY, { platform: server() });
    await rowOf('Bea Lim');
    await userEvent.type(search(), 'kapitolyo');
    const results = screen.getByRole('region', { name: 'Who posted?' });
    expect(within(results).getByRole('status').textContent).toBe('2 posts');
    const answers = Array.from(results.querySelectorAll('.who-answer'));
    expect(answers.map((a) => a.querySelector('.who-answer__name')!.textContent)).toEqual([intern.name, 'Mika Reyes']);
    expect(answers[0]!.textContent).toContain('Mon 2 Nov, 09:41');
    expect(answers[0]!.textContent).toContain('APG Main');
    expect(answers[0]!.textContent).toContain('Posted');
    expect(answers[1]!.textContent).toContain('Mika Reyes APG');
  });

  it('finds the post by its pasted link, and opens it', async () => {
    const platform = server();
    renderAt(THURSDAY, { platform });
    await rowOf('Bea Lim');
    await userEvent.click(search());
    await userEvent.paste('facebook.com/groups/apgmain/posts/99');
    const results = screen.getByRole('region', { name: 'Who posted?' });
    expect(within(results).getByRole('status').textContent).toBe('1 post');
    expect(results.querySelector('.who-answer__name')!.textContent).toBe('Mika Reyes');
    await userEvent.click(within(results).getByRole('button', { name: /Open the post of Kapitolyo Ground Floor Retail, Pasig by Mika Reyes/ }));
    await waitFor(() => expect(platform.opened).toEqual([MIKA_KAPITOLYO]));
  });

  it('says when nothing matches, and Escape clears it and closes the answers', async () => {
    renderAt(THURSDAY, { platform: server() });
    await rowOf('Bea Lim');
    await userEvent.type(search(), 'zzz');
    expect(screen.getByRole('status').textContent).toBe('No post matches “zzz”');
    await userEvent.keyboard('{Escape}');
    expect((search() as HTMLInputElement).value).toBe('');
    expect(document.querySelector('.who-posted__results')).toBeNull();

    // From an answer too: back in the box, empty.
    await userEvent.type(search(), 'kapitolyo');
    within(screen.getByRole('region', { name: 'Who posted?' })).getAllByRole('button', { name: /Open the post/ })[0]!.focus();
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(search());
    expect(document.querySelector('.who-posted__results')).toBeNull();
  });
});

describe('the Interns screen: long answers and groups', () => {
  it('pages twelve posts of a listing ten at a time, and a long group in the panel', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      post(intern.name, 'Kapitolyo Ground Floor Retail, Pasig', 'Posted', `2026-10-${String(10 + i).padStart(2, '0')}`, '09:00'),
    );
    renderAt(THURSDAY, {
      platform: server({
        posts: { ok: true, posts: many },
        assignments: { ok: true, assignments: queue(intern.name, 14) },
      }),
    });
    await rowOf('Bea Lim');
    await userEvent.type(screen.getByRole('searchbox', { name: /Who posted\?/ }), 'kapitolyo');
    const results = screen.getByRole('region', { name: 'Who posted?' });
    expect(results.querySelectorAll('.who-answer')).toHaveLength(10);
    const nav = within(results).getByRole('navigation', { name: 'Posts, pages' });
    expect(results.textContent).toContain('1–10 of 12');
    await userEvent.click(within(nav).getByRole('button', { name: 'Next page' }));
    expect(results.querySelectorAll('.who-answer')).toHaveLength(2);
    expect(results.querySelector('.who-answer')!.textContent).toContain('11 Oct');
    // A new search starts again at the top.
    await userEvent.type(screen.getByRole('searchbox', { name: /Who posted\?/ }), ' pasig');
    await waitFor(() => expect(results.querySelectorAll('.who-answer')).toHaveLength(10));

    await userEvent.click(within(await rowOf(intern.name)).getByRole('button', { name: new RegExp(intern.name) }));
    const panel = screen.getByRole('complementary', { name: intern.name });
    const group = within(panel).getByRole('region', { name: /^Not shared/ });
    expect(group.querySelectorAll('.panel-item')).toHaveLength(10);
    const pages = within(group).getByRole('navigation', { name: 'Not shared, pages' });
    // Compact in the side pane: arrows only.
    expect(within(pages).getByRole('button', { name: 'Next page' }).textContent).toBe('');
    await userEvent.click(within(pages).getByRole('button', { name: 'Page 2' }));
    expect(Array.from(group.querySelectorAll('.panel-item__name')).map((n) => n.textContent)).toEqual([
      `${intern.name} listing 11`,
      `${intern.name} listing 12`,
      `${intern.name} listing 13`,
      `${intern.name} listing 14`,
    ]);
  });
});

describe("the Interns screen: an intern's week", () => {
  it('opens beside the list with the queue grouped, links to the posts, and the last four weeks', async () => {
    const platform = server();
    renderAt(THURSDAY, { platform });
    await userEvent.click(within(await rowOf(intern.name)).getByRole('button', { name: new RegExp(intern.name) }));

    const panel = screen.getByRole('complementary', { name: intern.name });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2, name: intern.name }));
    expect(within(screen.getByRole('table')).getByRole('button', { name: new RegExp(intern.name) }).getAttribute('aria-expanded')).toBe('true');
    expect(panel.querySelector('.week-bar__count')!.textContent).toBe('3 / 10');

    const group = (name: string) => within(panel).getByRole('region', { name: new RegExp(`^${name}`) });
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Last 4 weeks',
      'Not shared 7',
      'Pending 1',
      'Posted 2',
    ]);
    expect(group('Pending').textContent).toContain('Seaside Residences 2BR, Pasay');
    // Ten or fewer show whole, with no pages. Not shared has no link to open.
    expect(group('Not shared').querySelectorAll('.panel-item')).toHaveLength(7);
    expect(within(panel).queryByRole('navigation')).toBeNull();
    expect(within(group('Not shared')).queryByRole('button', { name: /Open/ })).toBeNull();
    await userEvent.click(within(group('Posted')).getByRole('button', { name: 'Open the post of Kapitolyo Ground Floor Retail, Pasig' }));
    await waitFor(() => expect(platform.opened).toEqual([JAN_KAPITOLYO]));

    // Last 4 weeks: 5, 12, 19 Oct with no queue, then 26 Oct, all 4 posted.
    const weeks = within(panel).getByRole('region', { name: 'Last 4 weeks' }).querySelectorAll('.history__week');
    expect(Array.from(weeks).map((w) => w.querySelector('.history__value')!.textContent)).toEqual(['–', '–', '–', '100%']);
    expect(weeks[3]!.textContent).toContain('26 Oct');
    expect(weeks[3]!.textContent).toContain('4 of 4');

    // A real way to reach them: their Facebook profile. No made-up Message button.
    expect(within(panel).queryByRole('button', { name: /Message/ })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'FB profile' }));
    await waitFor(() => expect(platform.opened).toContain('https://www.facebook.com/jan.delacruz'));
  });

  it('gives one button per FB account that has a profile link', async () => {
    const team = TEAM.team.map((m) =>
      m.name === 'Mika Reyes'
        ? {
            ...m,
            fbAccounts: ['Cyrus', 'Kevs', 'No Link'],
            fbProfiles: [
              { account: 'Cyrus', link: 'https://www.facebook.com/cyrus' },
              { account: 'Kevs', link: 'https://www.facebook.com/kevs' },
              { account: 'No Link', link: '' },
            ],
          }
        : m,
    );
    const platform = server({ team: { ok: true, team } });
    renderAt(THURSDAY, { platform });
    await userEvent.click(within(await rowOf('Mika Reyes')).getByRole('button', { name: /Mika Reyes/ }));
    const panel = screen.getByRole('complementary', { name: 'Mika Reyes' });

    expect(within(panel).queryByRole('button', { name: 'FB profile: No Link' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'FB profile: Kevs' }));
    await waitFor(() => expect(platform.opened).toEqual(['https://www.facebook.com/kevs']));
    expect(within(panel).getByRole('button', { name: 'FB profile: Cyrus' })).toBeTruthy();
  });

  it('shows Missed for a week that is over', async () => {
    renderAt(THURSDAY, { platform: server(), path: `/interns?week=${LAST_WEEK}` });
    await userEvent.click(within(await rowOf('Mika Reyes')).getByRole('button', { name: /Mika Reyes/ }));
    const panel = screen.getByRole('complementary', { name: 'Mika Reyes' });
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Last 4 weeks', 'Posted 1', 'Missed 2']);
  });

  it('closes with Escape or Close, and focus goes back to the row', async () => {
    renderAt(THURSDAY, { platform: server() });
    const open = within(await rowOf('Bea Lim')).getByRole('button', { name: /Bea Lim/ });
    await userEvent.click(open);
    expect(screen.getByRole('complementary', { name: 'Bea Lim' }).textContent).toContain('Not shared 5');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Bea Lim' })).toBeNull();
    expect(document.activeElement).toBe(open);

    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Bea Lim' })).toBeNull();
    // No FB profile on the Team tab: no button for it.
    await userEvent.click(open);
    expect(within(screen.getByRole('complementary', { name: 'Bea Lim' })).queryByRole('button', { name: 'FB profile' })).toBeNull();
  });

  it("opens the intern's queue in Assign", async () => {
    renderAt(THURSDAY, { platform: server() });
    await userEvent.click(within(await rowOf('Mika Reyes')).getByRole('button', { name: /Mika Reyes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open in Assign' }));
    expect(heading()).toBe('Mika Reyes');
  });
});

describe('the Interns screen', () => {
  it('keeps revoked people folded away at the bottom', async () => {
    renderAt(THURSDAY, { platform: server() });
    const revoked = await screen.findByRole('region', { name: 'Revoked' });
    expect(revoked.textContent).not.toContain('Paolo Reyes');

    const show = within(revoked).getByRole('button', { name: 'Show (1)' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(show);
    expect(within(revoked).getByRole('button', { name: 'Hide' }).getAttribute('aria-expanded')).toBe('true');
    expect(revoked.textContent).toContain('Paolo Reyes');
    expect(revoked.textContent).toContain('APG Rentals South');
    const table = screen.getByRole('table');
    expect(table.compareDocumentPosition(revoked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no Revoked section when nobody is revoked', async () => {
    renderAt(THURSDAY, { platform: server({ team: { ok: true, team: TEAM.team.filter((m) => m.active) } }) });
    await rowOf('Mika Reyes');
    expect(screen.queryByRole('region', { name: 'Revoked' })).toBeNull();
  });

  it("says when the team couldn't be read, and tries again", async () => {
    const platform = server({ team: { ok: false, error: 'unavailable', message: "The web app didn't answer. Try again in a minute." } });
    renderAt(THURSDAY, { platform });
    expect((await screen.findByRole('alert')).textContent).toContain("The web app didn't answer.");
    expect(screen.queryByRole('table')).toBeNull();

    platform.reply('team', TEAM);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('Mika Reyes')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('says how to add the first intern when the team has none', async () => {
    renderAt(THURSDAY, { platform: server({ team: { ok: true, team: [TEAM.team[1]] } }) });
    expect(await screen.findByRole('heading', { name: 'No agents yet' })).toBeTruthy();
    expect(screen.getByText('Add them in Settings → Team.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says it is reading the team until it arrives', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    const platform = server({ team: () => new Promise((resolve) => (answer = resolve)) });
    renderAt(THURSDAY, { platform });
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('Reading the team'))).toBe(true);
    await waitFor(() => expect(platform.posts.map((p) => p.action)).toContain('team'));
    answer(TEAM);
    expect(await rowOf('Mika Reyes')).toBeTruthy();
  });

  it("is an admin's screen: an intern who asks for it is sent to their queue", async () => {
    const platform = server();
    renderAt(THURSDAY, { platform, user: intern });
    expect(heading()).toBe('My queue');
    expect(platform.posts.map((p) => p.action)).not.toContain('team');
    expect(screen.queryByRole('searchbox', { name: /Who posted\?/ })).toBeNull();
  });

  it("is linked from the Tracker, whose This week card shows each intern's week", async () => {
    renderAt(THURSDAY, { platform: server(), path: '/tracker' });
    const card = await screen.findByRole('region', { name: 'This week' });
    await waitFor(() => expect(card.querySelectorAll('.intern-row')).toHaveLength(4));
    const jan = Array.from(card.querySelectorAll('.intern-row')).find((r) => r.textContent?.includes(intern.name))!;
    expect(jan.querySelector('.week-bar__count')!.textContent).toBe('3 / 10');
    expect(jan.textContent).toContain('Behind');
    // Still the day's tracker: today's posts, and the week's laggards counted.
    expect(stat('Agents behind')).toBe('2 of 4');

    await userEvent.click(within(card).getByRole('link', { name: 'See all agents' }));
    expect(heading()).toBe('Agents');
  });
});

describe('the Agents screen: spot checks (v16)', () => {
  const check = (link: string, result: string, by = manager.name) => ({
    postKey: link.replace('https://www.facebook.com/', '').replace(/\/$/, ''),
    link,
    agent: intern.name,
    posted: '2026-11-02',
    property: 'Kapitolyo Ground Floor Retail, Pasig',
    propertyId: '1Kapitolyo',
    result,
    checkedBy: by,
    checkedAt: '2026-11-05T09:00:00+08:00',
  });
  const checksCell = (row: HTMLElement) => row.querySelectorAll('td')[4]!.textContent;

  it('shows each agent’s checks in the table, a failure standing out', async () => {
    renderAt(THURSDAY, { platform: server({ spotChecks: { ok: true, checks: [check(JAN_KAPITOLYO, 'Not found')] } }) });
    expect(await screen.findByRole('columnheader', { name: 'Checks' })).toBeTruthy();

    const jan = await rowOf(intern.name);
    expect(within(jan).getByText('1 failed').classList.contains('pill--danger')).toBe(true);
    // Carlo's two posts are both picked; Mika posted four, so three are; Bea posted none.
    expect(checksCell(await rowOf('Carlo Mendoza'))).toBe('0 of 2 checked');
    expect(checksCell(await rowOf('Mika Reyes'))).toBe('0 of 3 checked');
    expect(checksCell(await rowOf('Bea Lim'))).toBe('–');
  });

  it("lists the agent's picked posts in their panel, and saves what was found", async () => {
    const user = userEvent.setup();
    const saved: Record<string, unknown>[] = [];
    let checks = [check(JAN_KAPITOLYO, 'Not found')];
    const platform = server({
      spotChecks: () => ({ ok: true, checks }),
      saveSpotCheck: (body: Readonly<Record<string, unknown>>) => {
        saved.push({ postLink: body['postLink'], result: body['result'] });
        const made = { ...check(String(body['postLink']), String(body['result'])), property: 'BGC Uptown Office 18F, 240 sqm' };
        checks = [...checks, made];
        return { ok: true, check: made };
      },
    });
    renderAt(THURSDAY, { platform });
    await user.click(within(await rowOf(intern.name)).getByRole('button', { name: new RegExp(intern.name) }));

    const panel = screen.getByRole('complementary', { name: intern.name });
    const section = within(panel).getByRole('region', { name: /Spot check/ });
    // Only Posted posts: the pending Seaside post isn't one to check.
    const items = section.querySelectorAll('.spot-item');
    expect(Array.from(items, (i) => i.querySelector('.spot-item__name')!.textContent)).toEqual([
      'Kapitolyo Ground Floor Retail, Pasig',
      'BGC Uptown Office 18F, 240 sqm',
    ]);
    expect(items[0]!.classList.contains('spot-item--failed')).toBe(true);
    expect(items[0]!.textContent).toContain(`Not found, checked by ${manager.name}`);
    expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Not found' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(within(items[1] as HTMLElement).getByRole('button', { name: 'Open the post of BGC Uptown Office 18F, 240 sqm' }));
    expect(platform.opened).toContain('https://www.facebook.com/groups/apgmain/posts/112/');

    await user.click(within(screen.getByRole('group', { name: 'What you found: BGC Uptown Office 18F, 240 sqm' })).getByRole('button', { name: 'Verified' }));
    expect(saved).toEqual([{ postLink: 'https://www.facebook.com/groups/apgmain/posts/112/', result: 'Verified' }]);
    await waitFor(() => expect(within(screen.getByRole('region', { name: /Spot check/ })).getByText(/Verified, checked by/)).toBeTruthy());
    expect(await screen.findByText('Saved: Verified.')).toBeTruthy();
  });

  it('goes on without them on a web app before v16', async () => {
    renderAt(THURSDAY, { platform: server() });
    await rowOf(intern.name);
    expect(screen.queryByRole('columnheader', { name: 'Checks' })).toBeNull();
  });
});
