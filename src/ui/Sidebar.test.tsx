// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, manager, renderApp, TODAY } from './state/testing';

// No web app link built in: these tests sign in with the two-field form and
// must not depend on the real link in src/config.ts.
vi.mock('@/config', () => ({ BUILT_IN_SCRIPT_URL: '' }));

/** The team the web app sends, out of order: an admin (listed in Assign as an admin, D31) and a revoked intern, listed nowhere. */
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

const server = (replies = {}) => fakeServer({ team: TEAM, assignments: ASSIGNMENTS, ...replies });
const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' });
const navNames = () => within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link').map((a) => a.firstChild?.textContent);

describe('the sidebar', () => {
  afterEach(() => {
    window.innerWidth = 1024;
  });

  it('gives an admin Tracker, Assign, Interns, Records, Find and Settings, and no list of people', async () => {
    renderApp({ platform: server(), user: admin, path: '/tracker' });
    expect(navNames()).toEqual(['Tracker', 'Assign', 'Agents', 'Records', 'Find', 'Settings']);
    const interns = screen.getByRole('link', { name: 'Agents' });
    expect(interns.getAttribute('href')).toBe('#/interns');
    expect(interns.querySelector('svg')).not.toBeNull();
    // Nobody is listed in the sidebar itself, however long the team.
    await screen.findByRole('heading', { level: 1, name: 'Tracker' });
    expect(within(sidebar()).queryByRole('region')).toBeNull();
    expect(within(sidebar()).queryByText('Mika Reyes')).toBeNull();
    expect(sidebar().querySelector('.sidebar__avatar:not(.sidebar__avatar--me)')).toBeNull();
  });

  it('opens the Interns screen from the nav, and marks it', async () => {
    renderApp({ platform: server(), user: admin, path: '/tracker' });
    await userEvent.click(screen.getByRole('link', { name: 'Agents' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents');
    expect(screen.getByRole('link', { name: 'Agents' }).getAttribute('aria-current')).toBe('page');
    expect(document.title).toBe('Agents · APG Post-It');
  });

  it('gives an intern no Interns item, and never asks for the team', async () => {
    const platform = server();
    renderApp({ platform, user: intern, path: '/queue' });
    await screen.findByRole('heading', { level: 1, name: 'My queue' });
    expect(navNames()).toEqual(['My queue', 'Find', 'Settings']);
    expect(screen.queryByRole('link', { name: 'Agents' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    expect(platform.posts.map((p) => p.action)).not.toContain('team');
  });

  it('gives an admin with a queue My queue, before Find, with what is left of it (D31)', async () => {
    const theirs = {
      ok: true,
      assignments: [
        ...ASSIGNMENTS.assignments,
        row(admin.name, 'Seaside Residences 2BR, Pasay', 'Not Shared'),
        row(admin.name, 'BGC Uptown Office 18F, 240 sqm', 'Posted'),
      ],
    };
    renderApp({ platform: server({ assignments: theirs }), user: admin, path: '/tracker' });
    await waitFor(() => expect(navNames()).toEqual(['Tracker', 'Assign', 'Agents', 'Records', 'My queue', 'Find', 'Settings']));
    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /My queue/ });
    expect(link.textContent).toContain('1 left in your queue this week');

    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    // Their own queue, none of the agents'.
    expect(await screen.findByText('Seaside Residences 2BR, Pasay')).toBeTruthy();
    expect(screen.queryByText('Valenzuela Warehouse 1,200 sqm')).toBeNull();
  });

  it('keeps My queue for an admin whose queue is over while a post of theirs waits, and while they mark it approved (D31)', async () => {
    let approved = false;
    const waiting = {
      date: '2026-10-29',
      time: '10:00',
      type: 'Lot',
      title: 'Seaside Residences 2BR, Pasay',
      fbAccount: 'APG Main',
      postLink: 'https://www.facebook.com/groups/apg/posts/7/',
      postedBy: admin.name,
      propertyId: '',
    };
    // Their queue of 19–23 Oct is over: nothing of it counts now.
    const over = { ok: true, assignments: [...ASSIGNMENTS.assignments, row(admin.name, 'BGC Uptown Office 18F, 240 sqm', 'Posted', '2026-10-19')] };
    const platform = server({
      assignments: over,
      posts: () => ({ ok: true, posts: [{ ...waiting, status: approved ? 'Posted' : 'Pending' }] }),
      addLink: () => {
        approved = true;
        return { ok: true, row: 2 };
      },
    });
    renderApp({ platform, user: admin, path: '/tracker' });
    await waitFor(() => expect(navNames()).toEqual(['Tracker', 'Assign', 'Agents', 'Records', 'My queue', 'Find', 'Settings']));
    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /My queue/ });
    expect(link.textContent).not.toContain('left in your queue');

    await userEvent.click(link);
    expect(await screen.findByText('1 post waiting for approval')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Approved: Seaside Residences 2BR, Pasay' }));
    await waitFor(() => expect(screen.queryByText('1 post waiting for approval')).toBeNull());

    // Nothing waits now, but they are on it: it stays, marked, until they leave.
    expect(navNames()).toContain('My queue');
    expect(screen.getByRole('link', { name: /My queue/ }).getAttribute('aria-current')).toBe('page');
    await userEvent.click(screen.getByRole('link', { name: 'Find' }));
    await waitFor(() => expect(navNames()).toEqual(['Tracker', 'Assign', 'Agents', 'Records', 'Find', 'Settings']));
  });

  it("feeds the team's admins to Assign's picker too, after the agents, and marks yours (D31)", async () => {
    const team = { ok: true, team: [...TEAM.team, { name: admin.name, role: 'Admin', email: '', fbAccounts: '', active: true }] };
    renderApp({ platform: server({ team }), user: admin, path: '/assign' });
    const admins = await screen.findByRole('list', { name: 'Admins' });
    // After the agents.
    expect(screen.getByRole('list', { name: 'Agents' }).compareDocumentPosition(admins) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cards = within(admins).getAllByRole('button');
    expect(cards.map((b) => b.querySelector('.assign-pick__name')?.textContent).sort()).toEqual([admin.name, manager.name].sort());
    expect(cards.find((b) => b.textContent?.includes(admin.name))?.querySelector('.assign-pick__you')?.textContent).toBe('You');
    expect(cards.find((b) => b.textContent?.includes(manager.name))?.querySelector('.assign-pick__you')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Agents' })).queryByText(manager.name)).toBeNull();

    // An admin's queue opens as an agent's does.
    await userEvent.click(cards.find((b) => b.textContent?.includes(manager.name))!);
    expect(await screen.findByRole('heading', { level: 1, name: manager.name })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(await screen.findByRole('list', { name: 'Admins' })).toBeTruthy();
  });

  it("feeds the team to Assign's intern picker", async () => {
    renderApp({ platform: server(), user: admin, path: '/assign' });
    // The team's active interns, and only them. Their order is by pace (Behind
    // first; AssignPicker's own tests cover it), so only the set is checked here.
    const picker = await screen.findByRole('list', { name: 'Agents' });
    await waitFor(() =>
      expect(
        within(picker)
          .getAllByRole('button')
          .map((b) => b.querySelector('.assign-pick__name')?.textContent)
          .sort(),
      ).toEqual([intern.name, 'Mika Reyes'].sort()),
    );
    expect(within(picker).queryByText(manager.name)).toBeNull();
  });

  it('collapses and expands by its button and by Ctrl+B, and remembers which', async () => {
    const platform = server();
    renderApp({ platform, user: admin, path: '/tracker' });

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar().classList.contains('sidebar--collapsed')).toBe(true);
    // The rail keeps every name.
    expect(screen.getByRole('link', { name: 'Tracker' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Agents' })).toBeTruthy();
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });
});
