// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, manager, renderApp, TODAY } from './state/testing';

// No web app link built in: these tests sign in with the two-field form and
// must not depend on the real link in src/config.ts.
vi.mock('@/config', () => ({ BUILT_IN_SCRIPT_URL: '' }));

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
    expect(navNames()).toEqual(['Tracker', 'Assign', 'Interns', 'Records', 'Find', 'Settings']);
    const interns = screen.getByRole('link', { name: 'Interns' });
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
    await userEvent.click(screen.getByRole('link', { name: 'Interns' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Interns');
    expect(screen.getByRole('link', { name: 'Interns' }).getAttribute('aria-current')).toBe('page');
    expect(document.title).toBe('Interns · APG Post-It');
  });

  it('gives an intern no Interns item, and never asks for the team', async () => {
    const platform = server();
    renderApp({ platform, user: intern, path: '/queue' });
    await screen.findByRole('heading', { level: 1, name: 'My queue' });
    expect(navNames()).toEqual(['My queue', 'Find']);
    expect(screen.queryByRole('link', { name: 'Interns' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    expect(platform.posts.map((p) => p.action)).not.toContain('team');
  });

  it("feeds the team to Assign's intern picker", async () => {
    renderApp({ platform: server(), user: admin, path: '/assign' });
    // The team's active interns, by name, though Mika is first in the reply; it opens on the first.
    const picker = await screen.findByRole('group', { name: 'Intern' });
    await waitFor(() => expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual([intern.name, 'Mika Reyes']));
    expect(within(picker).getByRole('button', { name: intern.name }).getAttribute('aria-pressed')).toBe('true');
    expect(within(picker).queryByRole('button', { name: manager.name })).toBeNull();
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
    expect(screen.getByRole('link', { name: 'Interns' })).toBeTruthy();
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
