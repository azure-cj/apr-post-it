// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, renderApp, TODAY } from '../../state/testing';

const TEAM = {
  ok: true,
  team: [
    { name: admin.name, role: 'Admin', email: '', fbAccounts: '', active: true },
    { name: intern.name, role: 'Intern', email: '', fbAccounts: 'APG Main', fbProfileLink: 'https://www.facebook.com/jan.delacruz', active: true },
    { name: 'Carlo Mendoza', role: 'Intern', email: '', fbAccounts: 'CARLO M', active: false },
    { name: 'Bea Lim', role: 'Admin', email: '', fbAccounts: 'BEA LIM', active: true },
  ],
};

const post = (date: string, time: string, status: 'Posted' | 'Pending', postedBy = intern.name) => ({
  date,
  time,
  type: 'Warehouse',
  title: 'Valenzuela Warehouse 1,200 sqm',
  status,
  fbAccount: 'APG Main',
  postLink: 'https://www.facebook.com/groups/x/posts/1/',
  postedBy,
  propertyId: '1Valenzuela',
});

// Sat 31 Oct: the week runs from Mon 26 Oct.
const POSTS = {
  ok: true,
  posts: [
    post('2026-10-20', '09:00', 'Posted'), // last week: not counted
    post('2026-10-26', '09:00', 'Posted'),
    post('2026-10-29', '10:15', 'Posted'),
    post('2026-10-30', '16:40', 'Pending'),
    post(TODAY, '08:30', 'Posted', 'Bea Lim'),
  ],
};

const actionsOf = (platform: ReturnType<typeof fakeServer>) => platform.posts.map((p) => p.action);
const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.querySelector('button')!.textContent);
const panel = (name: string) => screen.getByRole('complementary', { name: new RegExp(`^${name}`) });

async function openTeam(replies: Parameters<typeof fakeServer>[0] = {}) {
  const platform = fakeServer({ team: TEAM, posts: POSTS, ...replies });
  renderApp({ platform, user: admin, path: '/settings' });
  await screen.findByRole('button', { name: intern.name });
  return platform;
}

describe('Settings → Team', () => {
  it('lists the team in a slim table, you tagged, with the filters counted', async () => {
    await openTeam();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'FB broker name', 'Status']);
    expect(names()).toEqual([admin.name, intern.name, 'Carlo Mendoza', 'Bea Lim']);
    const mine = screen.getByRole('button', { name: admin.name }).closest('tr')!;
    expect(within(mine).getByText('You')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Carlo Mendoza' }).closest('tr')!).getByText('Turned off')).toBeTruthy();

    const filters = screen.getByRole('group', { name: 'Show only' });
    expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual(['Interns2', 'Admins2', 'Turned off1']);
    // Add person is the one gold button.
    expect(screen.getByRole('button', { name: 'Add person' }).className).toContain('button--primary');
  });

  it('filters by role and by turned off, and searches names and FB broker names', async () => {
    await openTeam();
    await userEvent.click(screen.getByRole('button', { name: /^Interns/ }));
    expect(names()).toEqual([intern.name, 'Carlo Mendoza']);
    await userEvent.click(screen.getByRole('button', { name: /^Turned off/ }));
    expect(names()).toEqual(['Carlo Mendoza']);
    await userEvent.click(screen.getByRole('button', { name: /^Interns/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Turned off/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Admins/ }));
    expect(names()).toEqual([admin.name, 'Bea Lim']);
    await userEvent.click(screen.getByRole('button', { name: /^Admins/ }));

    const search = screen.getByRole('searchbox', { name: 'Search the team' });
    await userEvent.type(search, 'apg main');
    expect(names()).toEqual([intern.name]);
    await userEvent.clear(search);
    await userEvent.type(search, 'nobody');
    expect(screen.getByText('No one matches')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(names()).toHaveLength(4);
  });

  it('pages a team of more than ten, and a search starts at its first page', async () => {
    const interns = Array.from({ length: 13 }, (_, i) => ({
      name: `Intern ${String(i + 1).padStart(2, '0')}`,
      role: 'Intern',
      email: '',
      fbAccounts: `FB ${i + 1}`,
      active: true,
    }));
    await openTeam({ team: { ok: true, team: [...TEAM.team, ...interns] } });
    expect(names()).toHaveLength(10);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(nav.closest('.pagination')!.textContent).toContain('1–10 of 17');
    await userEvent.click(within(nav).getByRole('button', { name: 'Next page' }));
    expect(names()).toEqual(['Intern 07', 'Intern 08', 'Intern 09', 'Intern 10', 'Intern 11', 'Intern 12', 'Intern 13']);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the team' }), 'intern');
    expect(names()[0]).toBe('Intern 01');
  });

  it('says so when no one is on the team yet', async () => {
    renderApp({ platform: fakeServer({ team: { ok: true, team: [] } }), user: admin, path: '/settings' });
    expect(await screen.findByText('No one yet')).toBeTruthy();
    expect(screen.getByText('Add your first intern.')).toBeTruthy();
  });

  it('opens a row in the side panel, with this week counted from the posts', async () => {
    await openTeam();
    await userEvent.click(screen.getByRole('button', { name: intern.name }).closest('tr')!.querySelectorAll('td')[1]!);
    const side = panel(intern.name);
    expect(document.activeElement).toBe(within(side).getByRole('heading', { level: 2 }));
    expect(screen.getByRole('button', { name: intern.name }).getAttribute('aria-expanded')).toBe('true');

    const week = within(side).getByRole('region', { name: 'This week' });
    expect(within(week).getByText('Posted').nextElementSibling?.textContent).toBe('2');
    expect(within(week).getByText('Pending').nextElementSibling?.textContent).toBe('1');
    expect(within(week).getByText('Last post').nextElementSibling?.textContent).toBe('Yesterday, 16:40');
    expect(within(week).getByRole('heading', { level: 3 }).textContent).toBe('This week since Mon 26 Oct');

    // Escape closes it, and focus goes back to the row.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: intern.name })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: intern.name }));
  });

  it('opens with Enter, links to Interns, and opens the profile in the browser', async () => {
    const platform = await openTeam();
    screen.getByRole('button', { name: intern.name }).focus();
    await userEvent.keyboard('{Enter}');
    const side = panel(intern.name);
    await userEvent.click(within(side).getByRole('button', { name: 'Open APG Main profile' }));
    await waitFor(() => expect(platform.opened).toEqual(['https://www.facebook.com/jan.delacruz']));
    await userEvent.click(within(side).getByRole('button', { name: 'See their queue in Interns' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Interns');
  });

  it('edits the FB accounts, each with its own profile link, then reads the team again', async () => {
    const platform = await openTeam({
      updatePerson: (body) => ({
        ok: true,
        person: { name: body['name'], role: 'Intern', fbAccounts: body['fbAccounts'], fbProfiles: body['fbProfiles'], active: true },
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: intern.name }));
    expect(within(panel(intern.name)).getByText('Intern')).toBeTruthy();
    const details = within(panel(intern.name)).getByRole('region', { name: 'Details' });
    const save = within(details).getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);

    const broker = within(details).getByLabelText(/^FB broker name/);
    await userEvent.clear(broker);
    await userEvent.click(save);
    expect(within(details).getByText('Type the account name.')).toBeTruthy();
    expect(actionsOf(platform)).not.toContain('updatePerson');

    await userEvent.type(broker, 'CYRUS ORBANO');
    await userEvent.click(within(details).getByRole('button', { name: 'Add account' }));
    await userEvent.type(within(details).getByLabelText(/^FB broker name 2/), 'cyrus orbano');
    await userEvent.click(save);
    expect(within(details).getByText('Already listed.')).toBeTruthy();

    const second = within(details).getByLabelText(/^FB broker name 2/);
    await userEvent.clear(second);
    await userEvent.type(second, 'KEVS');
    await userEvent.type(within(details).getByLabelText(/^FB profile link 2/), 'm.facebook.com/kevs');
    const teamReads = actionsOf(platform).filter((a) => a === 'team').length;
    await userEvent.click(save);

    expect(await within(details).findByText('Saved')).toBeTruthy();
    const sent = platform.posts.find((p) => p.action === 'updatePerson')!.body;
    expect(sent).toEqual(
      expect.objectContaining({
        name: intern.name,
        fbProfiles: [
          { account: 'CYRUS ORBANO', link: 'https://www.facebook.com/jan.delacruz' },
          { account: 'KEVS', link: 'https://m.facebook.com/kevs' },
        ],
        fbAccounts: ['CYRUS ORBANO', 'KEVS'],
      }),
    );
    expect(sent).not.toHaveProperty('role');
    expect(sent).not.toHaveProperty('active');
    await waitFor(() => expect(actionsOf(platform).filter((a) => a === 'team').length).toBeGreaterThan(teamReads));
  });

  it('blocks a profile link that is not Facebook', async () => {
    const platform = await openTeam();
    await userEvent.click(screen.getByRole('button', { name: intern.name }));
    const details = within(panel(intern.name)).getByRole('region', { name: 'Details' });
    const link = within(details).getByLabelText(/^FB profile link/);
    await userEvent.clear(link);
    await userEvent.type(link, 'https://instagram.com/jan');
    await userEvent.click(within(details).getByRole('button', { name: 'Save' }));
    expect(within(details).getByText("That isn't a Facebook profile link.")).toBeTruthy();
    expect(document.activeElement).toBe(link);
    expect(actionsOf(platform)).not.toContain('updatePerson');
  });

  it('never offers New key or Turn off for yourself', async () => {
    await openTeam();
    await userEvent.click(screen.getByRole('button', { name: admin.name }));
    const access = within(panel(admin.name)).getByRole('region', { name: 'Access' });
    expect(within(access).queryByRole('button')).toBeNull();
    expect(within(access).getByText('This is you. Another admin can change your access.')).toBeTruthy();
  });

  it('asks before making a new key, then shows it once', async () => {
    const platform = await openTeam({ newKey: { ok: true, key: 'k-new-123' } });
    await userEvent.click(screen.getByRole('button', { name: intern.name }));
    await userEvent.click(within(panel(intern.name)).getByRole('button', { name: 'New key' }));
    const ask = screen.getByRole('dialog', { name: `New key for ${intern.name}?` });
    expect(within(ask).getByText('Their current key stops working at once.')).toBeTruthy();
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(actionsOf(platform)).not.toContain('newKey');

    await userEvent.click(within(ask).getByRole('button', { name: 'Make new key' }));
    const shown = await screen.findByRole('dialog', { name: `New key for ${intern.name}` });
    expect(within(shown).getByText('k-new-123')).toBeTruthy();
    expect(within(shown).getByText(/You won’t see this again/)).toBeTruthy();
    expect(platform.posts.find((p) => p.action === 'newKey')!.body).toMatchObject({ name: intern.name });
  });

  it('asks before turning someone off or on; no new key for someone turned off', async () => {
    const platform = await openTeam({
      setActive: (body) => ({ ok: true, person: { name: body['name'], role: 'Intern', active: body['active'] } }),
    });
    await userEvent.click(screen.getByRole('button', { name: intern.name }));
    await userEvent.click(within(panel(intern.name)).getByRole('button', { name: 'Turn off' }));
    const ask = screen.getByRole('dialog', { name: `Turn off ${intern.name}?` });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(actionsOf(platform)).not.toContain('setActive');

    await userEvent.click(screen.getByRole('button', { name: 'Carlo Mendoza' }));
    const access = within(panel('Carlo Mendoza')).getByRole('region', { name: 'Access' });
    expect(within(access).queryByRole('button', { name: 'New key' })).toBeNull();
    await userEvent.click(within(access).getByRole('button', { name: 'Turn on' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Turn on Carlo Mendoza?' })).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(platform.posts.find((p) => p.action === 'setActive')!.body).toMatchObject({ name: 'Carlo Mendoza', active: true });
  });

  it('adds a person and shows the key once, with the profile-link warning', async () => {
    const platform = await openTeam({
      addPerson: (body) => ({
        ok: true,
        person: { name: body['name'], role: body['role'], fbAccounts: (body['fbAccounts'] as string[]).join(', '), active: true },
        key: 'k-9f3a-77',
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    const dialog = screen.getByRole('dialog', { name: 'Add person' });
    const order = Array.from(dialog.querySelectorAll('label.field__label, legend')).map((l) => l.textContent);
    expect(order).toEqual(['Intern name', 'Role', 'FB broker name', 'FB profile link (optional)']);
    await userEvent.type(within(dialog).getByLabelText('Intern name'), 'Mika Reyes');
    await userEvent.type(within(dialog).getByLabelText(/^FB broker name/), 'APG Main ');
    await userEvent.type(within(dialog).getByLabelText(/^FB profile link/), 'facebook.com/mika.reyes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await userEvent.type(within(dialog).getByLabelText(/^FB broker name 2/), 'APG South');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));

    const shown = await screen.findByRole('dialog', { name: 'Mika Reyes added' });
    expect(platform.posts.find((p) => p.action === 'addPerson')!.body).toMatchObject({
      name: 'Mika Reyes',
      role: 'Intern',
      fbAccounts: ['APG Main', 'APG South'],
      fbProfileLink: 'https://facebook.com/mika.reyes',
      fbProfiles: [
        { account: 'APG Main', link: 'https://facebook.com/mika.reyes' },
        { account: 'APG South', link: '' },
      ],
    });
    expect(within(shown).getByText('k-9f3a-77')).toBeTruthy();
    // This fake answers like an older web app: no fbProfileLink in the person.
    expect(within(shown).getByText('Profile link not saved')).toBeTruthy();
    await userEvent.click(within(shown).getByRole('button', { name: 'Copy the key' }));
    await waitFor(() => expect(platform.copied).toEqual(['k-9f3a-77']));
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('k-9f3a-77')).toBeNull();
  });

  it('says a duplicate name before asking the server, and requires a broker name for an intern', async () => {
    const platform = await openTeam();
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    const dialog = screen.getByRole('dialog', { name: 'Add person' });
    await userEvent.type(within(dialog).getByLabelText('Intern name'), 'jan dela cruz');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));
    expect(within(dialog).getByText('Jan Dela Cruz is already on the team.')).toBeTruthy();
    expect(within(dialog).getByText('Type their FB broker name.')).toBeTruthy();
    expect(actionsOf(platform)).not.toContain('addPerson');
  });
});
