// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, renderApp } from '../../state/testing';

const TEAM = {
  ok: true,
  team: [
    { name: admin.name, role: 'Admin', email: '', fbAccounts: '', active: true },
    { name: intern.name, role: 'Intern', email: '', fbAccounts: 'APG Main', fbProfileLink: 'https://www.facebook.com/jan.delacruz', active: true },
    { name: 'Carlo Mendoza', role: 'Intern', email: '', fbAccounts: '', active: false },
  ],
};

const actionsOf = (platform: ReturnType<typeof fakeServer>) => platform.posts.map((p) => p.action);
const PROFILE = 'https://www.facebook.com/cyrus.orbano';

/** The Add person form, opened. */
async function openAdd(platform: ReturnType<typeof fakeServer>) {
  renderApp({ platform, user: admin, path: '/settings' });
  await screen.findByRole('cell', { name: intern.name });
  await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
  return screen.getByRole('dialog', { name: 'Add person' });
}

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
    await userEvent.type(within(dialog).getByLabelText('Intern name'), 'Mika Reyes');
    await userEvent.type(within(dialog).getByLabelText(/^FB broker name/), 'APG Main, , APG South ');
    await userEvent.type(within(dialog).getByLabelText(/^FB profile link/), 'facebook.com/mika.reyes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));

    const shown = await screen.findByRole('dialog', { name: 'Mika Reyes added' });
    const sent = platform.posts.find((p) => p.action === 'addPerson')!.body;
    expect(sent).toMatchObject({
      name: 'Mika Reyes',
      role: 'Intern',
      fbAccounts: ['APG Main', 'APG South'],
      fbProfileLink: 'https://facebook.com/mika.reyes',
    });
    expect(within(shown).getByText('k-9f3a-77')).toBeTruthy();
    expect(within(shown).getByText(/You won’t see this again/)).toBeTruthy();
    // This fake answers like an older web app: no fbProfileLink in the person.
    expect(within(shown).getByText('Profile link not saved')).toBeTruthy();
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
    await userEvent.type(within(dialog).getByLabelText('Intern name'), 'jan dela cruz');
    await userEvent.type(within(dialog).getByLabelText(/^FB broker name/), 'JAN DELA CRUZ');
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

    // Your own row can be edited, never turned off or given a new key.
    expect(within(row(admin.name)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Edit']);
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

  it('lays out the form in order: Intern name, Role, FB broker name, FB profile link', async () => {
    const dialog = await openAdd(fakeServer({ team: TEAM }));

    const order = Array.from(dialog.querySelectorAll('label.field__label, legend')).map((l) => l.textContent);
    expect(order).toEqual(['Intern name', 'Role', 'FB broker name', 'FB profile link (optional)']);
    expect(within(dialog).getByRole('radio', { name: 'Intern' })).toHaveProperty('checked', true);
    expect(within(dialog).getByText('The name shown on Facebook.')).toBeTruthy();
    expect(within(dialog).getByLabelText(/^FB profile link/).getAttribute('placeholder')).toBe('https://www.facebook.com/…');

    // An Admin is a "Name", and their broker name is optional.
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Admin' }));
    const after = Array.from(dialog.querySelectorAll('label.field__label, legend')).map((l) => l.textContent);
    expect(after).toEqual(['Name', 'Role', 'FB broker name (optional)', 'FB profile link (optional)']);
  });

  it('requires the broker name for an intern, not for an admin', async () => {
    const platform = fakeServer({
      team: TEAM,
      addPerson: (body) => ({ ok: true, person: { name: body['name'], role: body['role'], active: true }, key: 'k-1' }),
    });
    const dialog = await openAdd(platform);
    await userEvent.type(within(dialog).getByLabelText('Intern name'), 'Mika Reyes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));

    expect(within(dialog).getByText('Type their FB broker name.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/^FB broker name/));
    expect(actionsOf(platform)).not.toContain('addPerson');

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Admin' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));
    await screen.findByRole('dialog', { name: 'Mika Reyes added' });
    expect(platform.posts.find((p) => p.action === 'addPerson')!.body).toMatchObject({ name: 'Mika Reyes', role: 'Admin' });
  });

  it('checks the profile link as it is typed, and a bad one blocks Add', async () => {
    const platform = fakeServer({ team: TEAM });
    const dialog = await openAdd(platform);
    await userEvent.type(within(dialog).getByLabelText('Intern name'), 'Cyrus Orbano');
    await userEvent.type(within(dialog).getByLabelText(/^FB broker name/), 'CYRUS ORBANO');
    const link = within(dialog).getByLabelText(/^FB profile link/);
    await userEvent.type(link, 'https://instagram.com/cyrus');
    await userEvent.tab();

    expect(within(dialog).getByText("That isn't a Facebook profile link.")).toBeTruthy();
    expect(link.getAttribute('aria-invalid')).toBe('true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));
    expect(actionsOf(platform)).not.toContain('addPerson');
    expect(document.activeElement).toBe(link);

    // Fixed as it is typed: the message goes.
    await userEvent.clear(link);
    await userEvent.type(link, PROFILE);
    expect(within(dialog).queryByText("That isn't a Facebook profile link.")).toBeNull();
  });

  it('shows the broker name and an Open link to the profile, which opens it in the browser', async () => {
    const platform = fakeServer({ team: TEAM });
    renderApp({ platform, user: admin, path: '/settings' });
    await screen.findByRole('cell', { name: intern.name });

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Name', 'Role', 'FB broker name', 'FB profile', 'Active', 'Actions']);
    expect(within(row(intern.name)).getByText('APG Main')).toBeTruthy();
    expect(within(row(admin.name)).queryByRole('button', { name: /Facebook profile/ })).toBeNull();

    await userEvent.click(within(row(intern.name)).getByRole('button', { name: `Open ${intern.name}'s Facebook profile` }));
    await waitFor(() => expect(platform.opened).toEqual(['https://www.facebook.com/jan.delacruz']));
  });

  it('edits only the broker name and the link, then reads the team again', async () => {
    const platform = fakeServer({
      team: TEAM,
      updatePerson: (body) => ({
        ok: true,
        person: { name: body['name'], role: 'Intern', fbAccounts: body['fbAccounts'], fbProfileLink: body['fbProfileLink'], active: true },
      }),
    });
    renderApp({ platform, user: admin, path: '/settings' });
    await screen.findByRole('cell', { name: intern.name });

    await userEvent.click(screen.getByRole('button', { name: `Edit ${intern.name}` }));
    const dialog = screen.getByRole('dialog', { name: `Edit ${intern.name}` });
    expect(within(dialog).getByLabelText('Intern name')).toHaveProperty('readOnly', true);
    expect(within(dialog).getByLabelText('Intern name')).toHaveProperty('value', intern.name);
    expect(within(dialog).getByLabelText('Role')).toHaveProperty('readOnly', true);
    expect(within(dialog).queryByRole('radio')).toBeNull();
    const broker = within(dialog).getByLabelText(/^FB broker name/);
    expect(broker).toHaveProperty('value', 'APG Main');
    expect(document.activeElement).toBe(broker);

    await userEvent.clear(broker);
    await userEvent.type(broker, 'CYRUS ORBANO');
    const link = within(dialog).getByLabelText(/^FB profile link/);
    await userEvent.clear(link);
    await userEvent.type(link, 'm.facebook.com/cyrus.orbano');
    const teamReads = actionsOf(platform).filter((a) => a === 'team').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(platform.posts.find((p) => p.action === 'updatePerson')!.body).toEqual(
      expect.objectContaining({
        name: intern.name,
        fbAccounts: ['CYRUS ORBANO'],
        fbProfileLink: 'https://m.facebook.com/cyrus.orbano',
      }),
    );
    const sent = platform.posts.find((p) => p.action === 'updatePerson')!.body;
    expect(sent).not.toHaveProperty('role');
    expect(sent).not.toHaveProperty('active');
    await waitFor(() => expect(actionsOf(platform).filter((a) => a === 'team').length).toBeGreaterThan(teamReads));
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
