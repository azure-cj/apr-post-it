// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, manager, renderApp, TODAY } from '../../state/testing';

// No web app link built in: these tests sign in with the two-field form and
// must not depend on the real link in src/config.ts.
vi.mock('@/config', () => ({ BUILT_IN_SCRIPT_URL: '' }));

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
  ],
};

const row = (who: string, property: string, status: string, date = TODAY) => ({ date, assignedTo: who, property, status, propertyId: '' });

/** Jan: 2 of 5 posted today. Mika: a queue tomorrow only. */
const ASSIGNMENTS = {
  ok: true,
  assignments: [
    row(intern.name, 'Kapitolyo Ground Floor Retail, Pasig', 'Posted'),
    row(intern.name, 'BGC Uptown Office 18F, 240 sqm', 'Posted'),
    row(intern.name, 'Seaside Residences 2BR, Pasay', 'Pending'),
    row(intern.name, 'Valenzuela Warehouse 1,200 sqm', 'To post'),
    row(intern.name, 'Verdant Hills Lot 12, Tagaytay', 'To post'),
    row('Mika Reyes', 'Kapitolyo Ground Floor Retail, Pasig', 'To post', '2026-11-01'),
  ],
};

const post = (who: string, title: string, status: string, date: string, time: string) => ({
  date,
  time,
  type: '',
  title,
  status,
  fbAccount: 'APG Main',
  postLink: status === 'Posted' ? 'https://www.facebook.com/groups/apgmain/posts/1/' : '',
  postedBy: who,
  propertyId: '',
});

/** Jan posted twice today, one still waiting for approval. Mika last posted on Thursday. */
const POSTS = {
  ok: true,
  posts: [
    post(intern.name, 'Kapitolyo Ground Floor Retail, Pasig', 'Posted', TODAY, '09:41'),
    post(intern.name, 'Seaside Residences 2BR, Pasay', 'Pending', TODAY, '11:02'),
    post('Mika Reyes', 'BGC Uptown Office 18F, 240 sqm', 'Posted', '2026-10-29', '15:20'),
  ],
};

const server = (replies = {}) => fakeServer({ team: TEAM, assignments: ASSIGNMENTS, posts: POSTS, ...replies });
const table = () => screen.findByRole('table');
const rowOf = async (name: string) => (await screen.findByRole('rowheader', { name: new RegExp(name) })).closest('tr')!;
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('the Interns screen', () => {
  it("lists the team's active interns by name, with the day's progress, pending posts, last post and FB accounts", async () => {
    renderApp({ platform: server(), user: admin, path: '/interns' });
    expect(heading()).toBe('Interns');
    const rows = within(await table()).getAllByRole('row').slice(1);
    await waitFor(() => expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['JD' + intern.name, 'MRMika Reyes']));

    const jan = await rowOf(intern.name);
    await waitFor(() => expect(jan.textContent).toContain('2 of 5 posted'));
    expect(jan.textContent).toContain('1 pending');
    expect(jan.textContent).toContain('Today, 11:02');
    expect(jan.textContent).toContain('APG Main, APG Rentals South');
    expect((jan.querySelector('.interns-progress__posted') as HTMLElement).style.width).toBe('40%');

    const mika = await rowOf('Mika Reyes');
    expect(mika.textContent).toContain('No queue');
    expect(mika.textContent).toContain('None');
    expect(mika.textContent).toContain('Thu 29 Oct, 15:20');
    expect(within(mika).getByText('Any')).toBeTruthy();

    // Admins and revoked interns are not in the table.
    expect(screen.getByRole('table').textContent).not.toContain(manager.name);
    expect(screen.getByRole('table').textContent).not.toContain('Paolo Reyes');

    // The numbers: 2 active, 0 of 1 done, 1 with pending posts, 1 with no queue.
    const stats = document.querySelector('.tracker-stats') as HTMLElement;
    expect(within(stats).getByText('Active interns').nextElementSibling!.textContent).toBe('2');
    expect(within(stats).getByText('Done today').nextElementSibling!.textContent).toBe('0 of 1');
    expect(within(stats).getByText('With pending posts').nextElementSibling!.textContent).toBe('1');
    expect(within(stats).getByText('No queue today').nextElementSibling!.textContent).toBe('1');
  });

  it("shows each intern's FB broker name, with their profile a click away", async () => {
    const platform = server();
    renderApp({ platform, user: admin, path: '/interns' });
    await table();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('FB broker name');

    const jan = await rowOf(intern.name);
    await userEvent.click(within(jan).getByRole('button', { name: `Open ${intern.name}'s Facebook profile` }));
    await waitFor(() => expect(platform.opened).toEqual(['https://www.facebook.com/jan.delacruz']));
    // No link on the Team tab: no Profile.
    expect(within(await rowOf('Mika Reyes')).queryByRole('button', { name: /Facebook profile/ })).toBeNull();
  });

  it('follows the day picker', async () => {
    renderApp({ platform: server(), user: admin, path: '/interns' });
    await rowOf('Mika Reyes');
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    const mika = await rowOf('Mika Reyes');
    await waitFor(() => expect(mika.textContent).toContain('0 of 1 posted'));
    expect((await rowOf(intern.name)).textContent).toContain('No queue');
  });

  it('filters by name as you type', async () => {
    renderApp({ platform: server(), user: admin, path: '/interns' });
    await rowOf('Mika Reyes');
    const search = screen.getByRole('searchbox', { name: 'Search interns by name' });

    await userEvent.type(search, 'mika');
    expect(within(screen.getByRole('table')).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['MRMika Reyes']);

    await userEvent.clear(search);
    await userEvent.type(search, 'zz');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/No active intern.s name matches/)).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(within(await table()).getAllByRole('rowheader')).toHaveLength(2);
  });

  it("opens an intern's queue for the day shown, and plans tomorrow's", async () => {
    renderApp({ platform: server(), user: admin, path: '/interns' });
    const mika = await rowOf('Mika Reyes');
    await userEvent.click(within(mika).getByRole('button', { name: 'Open queue of Mika Reyes' }));
    expect(heading()).toBe('Assign');
    const picker = await screen.findByRole('group', { name: 'Intern' });
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'Mika Reyes' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('group', { name: 'Day' }).textContent).toContain('Sat 31 Oct 2026');

    await userEvent.click(screen.getByRole('link', { name: 'Interns' }));
    await userEvent.click(within(await rowOf(intern.name)).getByRole('button', { name: `Plan tomorrow for ${intern.name}` }));
    expect(heading()).toBe('Assign');
    expect(screen.getByRole('group', { name: 'Day' }).textContent).toContain('Sun 1 Nov 2026');
  });

  it('keeps revoked people folded away at the bottom', async () => {
    renderApp({ platform: server(), user: admin, path: '/interns' });
    const revoked = await screen.findByRole('region', { name: 'Revoked' });
    expect(revoked.textContent).not.toContain('Paolo Reyes');

    const show = within(revoked).getByRole('button', { name: 'Show revoked (1)' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(show);
    expect(within(revoked).getByRole('button', { name: 'Hide revoked' }).getAttribute('aria-expanded')).toBe('true');
    expect(revoked.textContent).toContain('Paolo Reyes');
    expect(revoked.textContent).toContain('APG Rentals South');
    // After the active interns, not among them.
    const table = screen.getByRole('table');
    expect(table.compareDocumentPosition(revoked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no Revoked section when nobody is revoked', async () => {
    renderApp({ platform: server({ team: { ok: true, team: TEAM.team.filter((m) => m.active) } }), user: admin, path: '/interns' });
    await rowOf('Mika Reyes');
    expect(screen.queryByRole('region', { name: 'Revoked' })).toBeNull();
  });

  it("says when the team couldn't be read, and tries again", async () => {
    const platform = server({ team: { ok: false, error: 'unavailable', message: "The web app didn't answer. Try again in a minute." } });
    renderApp({ platform, user: admin, path: '/interns' });
    expect((await screen.findByRole('alert')).textContent).toContain("The web app didn't answer.");
    expect(screen.queryByRole('table')).toBeNull();

    platform.reply('team', TEAM);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('Mika Reyes')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('says how to add the first intern when the team has none', async () => {
    renderApp({ platform: server({ team: { ok: true, team: [TEAM.team[1]] } }), user: admin, path: '/interns' });
    expect(await screen.findByRole('heading', { name: 'No interns yet' })).toBeTruthy();
    expect(screen.getByText('Add them in Settings → Team.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says it is reading the team until it arrives', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    const platform = server({ team: () => new Promise((resolve) => (answer = resolve)) });
    renderApp({ platform, user: admin, path: '/interns' });
    expect(screen.getByRole('status').textContent).toContain('Reading the team');
    await waitFor(() => expect(platform.posts.map((p) => p.action)).toContain('team'));
    answer(TEAM);
    expect(await rowOf('Mika Reyes')).toBeTruthy();
  });

  it("is an admin's screen: an intern who asks for it is sent to their queue", async () => {
    const platform = server();
    renderApp({ platform, user: intern, path: '/interns' });
    expect(heading()).toBe('My queue');
    expect(platform.posts.map((p) => p.action)).not.toContain('team');
  });

  it('is linked from the Tracker', async () => {
    renderApp({ platform: server(), user: admin, path: '/tracker' });
    await userEvent.click(await screen.findByRole('link', { name: 'See all interns' }));
    expect(heading()).toBe('Interns');
  });
});
