// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, manager, renderApp, TODAY } from './state/testing';

/** The team the web app sends, out of order, with an admin and a revoked intern who must not be listed. */
const TEAM = {
  ok: true,
  team: [
    { name: 'Mika Reyes', role: 'Intern', email: '', fbAccounts: '', active: true },
    { name: manager.name, role: 'Admin', email: '', fbAccounts: '', active: true },
    { name: 'Paolo Reyes', role: 'Intern', email: '', fbAccounts: '', active: false },
    { name: intern.name, role: 'Intern', email: '', fbAccounts: 'APG Main', active: true },
  ],
};

const row = (who: string, property: string, status: string, date = TODAY) => ({ date, assignedTo: who, property, status, propertyId: '' });

/** Jan: 2 of 5 posted today, one post waiting for its link. Mika: a queue tomorrow only. */
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

const POSTS = {
  ok: true,
  posts: [
    { date: TODAY, time: '09:41', type: '', title: 'Kapitolyo Ground Floor Retail, Pasig', status: 'Posted', fbAccount: 'APG Main', postLink: 'https://www.facebook.com/groups/apgmain/posts/1/', postedBy: intern.name, propertyId: '' },
    { date: TODAY, time: '11:02', type: '', title: 'Seaside Residences 2BR, Pasay', status: 'Pending', fbAccount: 'APG Main', postLink: '', postedBy: intern.name, propertyId: '' },
  ],
};

const server = (replies = {}) => fakeServer({ team: TEAM, assignments: ASSIGNMENTS, posts: POSTS, ...replies });
const interns = () => screen.findByRole('region', { name: 'Interns' });
const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' });

describe('the sidebar', () => {
  afterEach(() => {
    window.innerWidth = 1024;
  });

  it("lists the team's active interns by name, each with today's progress and a dot for posts waiting for a link", async () => {
    renderApp({ platform: server(), user: admin, path: '/tracker' });
    const list = await interns();
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(2));
    const [jan, mika] = within(list).getAllByRole('link');

    expect(within(jan!).getByText(intern.name)).toBeTruthy();
    await waitFor(() => expect(jan!.textContent).toContain('2 of 5 posted'));
    expect(jan!.textContent).toContain('1 post waiting for a link');
    expect(jan!.querySelector('.sidebar__dot')).not.toBeNull();
    expect(jan!.querySelector('.sidebar__avatar')!.textContent).toBe('JD');

    expect(mika!.textContent).toContain('Mika Reyes');
    expect(mika!.textContent).toContain('No queue today');
    expect(mika!.querySelector('.sidebar__dot')).toBeNull();
    // Admins and revoked interns are not listed.
    expect(list.textContent).not.toContain(manager.name);
    expect(list.textContent).not.toContain('Paolo Reyes');
  });

  it("opens an intern's queue for today, and marks them while it is open", async () => {
    renderApp({ platform: server(), user: admin, path: '/tracker' });
    const list = await interns();
    const mika = await within(list).findByRole('link', { name: /Mika Reyes/ });
    expect(mika.getAttribute('href')).toBe(`#/assign?intern=Mika+Reyes&date=${TODAY}`);
    expect(mika.getAttribute('aria-current')).toBeNull();

    await userEvent.click(mika);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Assign');
    expect(within(list).getByRole('link', { name: /Mika Reyes/ }).getAttribute('aria-current')).toBe('true');
    expect(within(list).getByRole('link', { name: new RegExp(intern.name) }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Assign' }).getAttribute('aria-current')).toBe('page');
  });

  it("feeds the team to Assign's intern picker", async () => {
    renderApp({ platform: server(), user: admin, path: '/assign' });
    // The team's active interns, by name, though Mika is first in the reply; it opens on the first.
    const picker = await screen.findByRole('group', { name: 'Intern' });
    await waitFor(() => expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual([intern.name, 'Mika Reyes']));
    expect(within(picker).getByRole('button', { name: intern.name }).getAttribute('aria-pressed')).toBe('true');
  });

  it('collapses and expands by its button and by Ctrl+B, and remembers which', async () => {
    const platform = server();
    renderApp({ platform, user: admin, path: '/tracker' });
    await interns();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar().classList.contains('sidebar--collapsed')).toBe(true);
    // The rail keeps every name.
    expect(screen.getByRole('link', { name: 'Tracker' })).toBeTruthy();
    await waitFor(async () => expect(await platform.readLocal('sidebar')).toBe('collapsed'));

    await userEvent.keyboard('{Control>}b{/Control}');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-expanded')).toBe('true');
    expect(sidebar().classList.contains('sidebar--collapsed')).toBe(false);
    await waitFor(async () => expect(await platform.readLocal('sidebar')).toBe('expanded'));

    await userEvent.keyboard('{Control>}b{/Control}');
    expect(sidebar().classList.contains('sidebar--collapsed')).toBe(true);
    await waitFor(async () => expect(await platform.readLocal('sidebar')).toBe('collapsed'));
  });

  it('opens as it was left', async () => {
    const platform = server();
    await platform.writeLocal('sidebar', 'collapsed');
    renderApp({ platform, user: admin, path: '/tracker' });
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it('starts as a rail in a narrow window, whatever was kept', async () => {
    window.innerWidth = 900;
    const platform = server();
    await platform.writeLocal('sidebar', 'expanded');
    renderApp({ platform, user: admin, path: '/tracker' });
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    await interns();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it('gives an intern no intern list, and never asks for the team', async () => {
    const platform = server();
    renderApp({ platform, user: intern, path: '/queue' });
    await screen.findByRole('heading', { level: 1, name: 'My queue' });
    expect(screen.queryByRole('region', { name: 'Interns' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    expect(platform.posts.map((p) => p.action)).not.toContain('team');
  });

  it("says when the team couldn't be read, and tries again", async () => {
    const platform = server({ team: { ok: false, error: 'unavailable', message: "The web app didn't answer. Try again in a minute." } });
    renderApp({ platform, user: admin, path: '/tracker' });
    const list = await interns();
    expect((await within(list).findByRole('alert')).textContent).toContain("The web app didn't answer.");

    platform.reply('team', TEAM);
    await userEvent.click(within(list).getByRole('button', { name: 'Try again' }));
    expect(await within(list).findByRole('link', { name: /Mika Reyes/ })).toBeTruthy();
    expect(within(list).queryByRole('alert')).toBeNull();
  });

  it('says how to add the first intern when the team has none', async () => {
    renderApp({ platform: server({ team: { ok: true, team: [TEAM.team[1]] } }), user: admin, path: '/tracker' });
    const list = await interns();
    expect((await within(list).findByText(/No interns yet/)).textContent).toBe(
      'No interns yet. Add them on the Team tab with ADD_PERSON.',
    );
  });
});
