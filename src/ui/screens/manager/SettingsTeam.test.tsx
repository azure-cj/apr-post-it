// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, renderApp } from '../../state/testing';

const TEAM = {
  ok: true,
  team: [
    { name: admin.name, role: 'Admin', email: '', fbAccounts: '', active: true },
    { name: intern.name, role: 'Intern', email: '', fbAccounts: 'APG Main', active: true },
    { name: 'Carlo Mendoza', role: 'Intern', email: '', fbAccounts: '', active: false },
  ],
};

const actionsOf = (platform: ReturnType<typeof fakeServer>) => platform.posts.map((p) => p.action);
const row = (name: string) => screen.getByRole('cell', { name: new RegExp(`^${name}`) }).closest('tr')!;

describe('Settings → Team', () => {
  it('adds a person and shows the key once, with Copy', async () => {
    const platform = fakeServer({
      team: TEAM,
      addPerson: (body) => ({
        ok: true,
        person: { name: body['name'], role: body['role'], fbAccounts: (body['fbAccounts'] as string[]).join(', '), active: true },
        key: 'k-9f3a-77',
      }),
    });
    renderApp({ platform, user: admin, path: '/settings' });
    await screen.findByRole('cell', { name: intern.name });

    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    const dialog = screen.getByRole('dialog', { name: 'Add person' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Mika Reyes');
    await userEvent.type(within(dialog).getByLabelText('FB accounts'), 'APG Main, , APG South ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));

    const shown = await screen.findByRole('dialog', { name: 'Mika Reyes added' });
    const sent = platform.posts.find((p) => p.action === 'addPerson')!.body;
    expect(sent).toMatchObject({ name: 'Mika Reyes', role: 'Intern', fbAccounts: ['APG Main', 'APG South'] });
    expect(within(shown).getByText('k-9f3a-77')).toBeTruthy();
    expect(within(shown).getByText(/You won’t see this again/)).toBeTruthy();
    await userEvent.click(within(shown).getByRole('button', { name: 'Copy the key' }));
    await waitFor(() => expect(platform.copied).toEqual(['k-9f3a-77']));

    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('k-9f3a-77')).toBeNull();
    // The team is read again after the change.
    await waitFor(() => expect(actionsOf(platform).filter((a) => a === 'team').length).toBeGreaterThan(1));
  });

  it('says a duplicate name before asking the server', async () => {
    const platform = fakeServer({ team: TEAM });
    renderApp({ platform, user: admin, path: '/settings' });
    await screen.findByRole('cell', { name: intern.name });
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    const dialog = screen.getByRole('dialog', { name: 'Add person' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'jan dela cruz');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));
    expect(within(dialog).getByText('Jan Dela Cruz is already on the team.')).toBeTruthy();
    expect(actionsOf(platform)).not.toContain('addPerson');
  });

  it('asks before making a new key, then shows it once', async () => {
    const platform = fakeServer({ team: TEAM, newKey: { ok: true, key: 'k-new-123' } });
    renderApp({ platform, user: admin, path: '/settings' });
    await screen.findByRole('cell', { name: intern.name });

    await userEvent.click(screen.getByRole('button', { name: `New key for ${intern.name}` }));
    const ask = screen.getByRole('dialog', { name: `New key for ${intern.name}?` });
    expect(within(ask).getByText('Their current key stops working at once.')).toBeTruthy();
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(actionsOf(platform)).not.toContain('newKey');

    await userEvent.click(within(ask).getByRole('button', { name: 'Make new key' }));
    const shown = await screen.findByRole('dialog', { name: `New key for ${intern.name}` });
    expect(within(shown).getByText('k-new-123')).toBeTruthy();
    expect(platform.posts.find((p) => p.action === 'newKey')!.body).toMatchObject({ name: intern.name });
  });

  it('asks before turning someone off or on, and never offers to turn yourself off', async () => {
    const platform = fakeServer({
      team: TEAM,
      setActive: (body) => ({ ok: true, person: { name: body['name'], role: 'Intern', active: body['active'] } }),
    });
    renderApp({ platform, user: admin, path: '/settings' });
    await screen.findByRole('cell', { name: intern.name });

    expect(within(row(admin.name)).queryByRole('button')).toBeNull();
    expect(within(row(admin.name)).getByText('You')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: `Turn off ${intern.name}` }));
    const ask = screen.getByRole('dialog', { name: `Turn off ${intern.name}?` });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(actionsOf(platform)).not.toContain('setActive');

    await userEvent.click(screen.getByRole('button', { name: 'Turn on Carlo Mendoza' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Turn on Carlo Mendoza?' })).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(platform.posts.find((p) => p.action === 'setActive')!.body).toMatchObject({ name: 'Carlo Mendoza', active: true });
  });

  it('shows the listings check as counts and folded lists', async () => {
    const platform = fakeServer({
      team: TEAM,
      indexCheck: {
        ok: true,
        checkedAt: '31 Oct 2026, 10:00',
        directoryCount: 1474,
        checkerCount: 1471,
        directoryOnly: [{ id: 'd1', name: 'Kapitolyo Ground Floor Retail, Pasig' }],
        checkerOnly: [],
        sold: [{ id: 's1', name: 'Seaside Residences 2BR, Pasay' }],
      },
    });
    renderApp({ platform, user: admin, path: '/settings' });
    const card = screen.getByRole('region', { name: 'Listings check' });
    await userEvent.click(within(card).getByRole('button', { name: 'Check' }));
    expect(await within(card).findByText('1,474')).toBeTruthy();
    expect(within(card).getByText('1,471')).toBeTruthy();
    expect(within(card).getByText('Only in Directory').closest('summary')).not.toBeNull();
    expect(within(card).getByText('Only in checker').closest('summary')).toBeNull();
    expect(within(card).getByText('Seaside Residences 2BR, Pasay')).toBeTruthy();
  });

  it.each([
    ['checker-off', 'The listings check is turned off.'],
    ['checker-unavailable', "The listing checker can't be reached right now. Try again later."],
  ])('says %s as one quiet line, not an error', async (code, line) => {
    const platform = fakeServer({ team: TEAM, indexCheck: { ok: false, error: code, message: 'Server words.' } });
    renderApp({ platform, user: admin, path: '/settings' });
    const card = screen.getByRole('region', { name: 'Listings check' });
    await userEvent.click(within(card).getByRole('button', { name: 'Check' }));

    expect(await within(card).findByText(line)).toBeTruthy();
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(card.querySelector('.notice')).toBeNull();
  });
});
