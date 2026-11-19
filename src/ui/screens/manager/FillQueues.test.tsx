// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, manager, renderApp } from '../../state/testing';

const TEAM = {
  ok: true,
  team: [
    { name: admin.name, role: 'Admin', email: '', fbAccounts: '', active: true },
    { name: intern.name, role: 'Intern', email: '', fbAccounts: '', active: true },
    { name: 'Mika Reyes', role: 'Intern', email: '', fbAccounts: '', active: true },
    { name: 'Carlo Mendoza', role: 'Intern', email: '', fbAccounts: '', active: false },
  ],
};

/** Kapitolyo was posted yesterday: in its cooldown tomorrow. */
const POSTS = {
  ok: true,
  posts: [
    {
      date: '2026-10-30',
      time: '10:00',
      type: 'Group post',
      title: 'Kapitolyo Ground Floor Retail, Pasig',
      status: 'Posted',
      fbAccount: 'APG Main',
      postLink: 'https://www.facebook.com/groups/x/posts/1/',
      postedBy: intern.name,
      propertyId: '1Kapitolyo',
    },
  ],
};

describe('Assign → Fill queues', () => {
  it('previews a plan for every active intern, then saves all of it at once', async () => {
    const platform = fakeServer({ team: TEAM, posts: POSTS, saveQueues: (body) => ({ ok: true, saved: 4, echo: body }) });
    renderApp({ platform, user: admin, path: '/assign' });
    // Step one, choosing an intern, is still there.
    expect(await screen.findByRole('list', { name: 'Agents' })).toBeTruthy();

    await userEvent.click(await screen.findByRole('button', { name: 'Fill queues' }));
    const dialog = screen.getByRole('dialog', { name: 'Fill queues' });
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox', { name: /Reyes|Dela Cruz/ })).toHaveLength(3));
    expect((within(dialog).getByRole('checkbox', { name: intern.name }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('checkbox', { name: 'Mika Reyes' }) as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).queryByRole('checkbox', { name: 'Carlo Mendoza' })).toBeNull();
    expect(within(dialog).getByRole('group', { name: 'Agents 2 of 2' })).toBeTruthy();
    // D31: an admin may be given a queue too, in a group of their own, but isn't ticked to start.
    expect((within(dialog).getByRole('checkbox', { name: admin.name }) as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByRole('group', { name: 'Admins 0 of 1' })).toBeTruthy();
    expect((within(dialog).getByRole('checkbox', { name: 'Keep existing queues' }) as HTMLInputElement).checked).toBe(true);
    // Saturday: the week is the coming one, and the target is the week's.
    expect(within(dialog).getByText('2–6 Nov')).toBeTruthy();
    expect((within(dialog).getByLabelText('Per week') as HTMLInputElement).value).toBe('40');

    const per = within(dialog).getByLabelText('Per week');
    await userEvent.clear(per);
    await userEvent.type(per, '2');
    expect(within(dialog).getByRole('button', { name: 'Save all' }).hasAttribute('disabled')).toBe(true);
    // v14: new queues run 2 weeks by default; this plan is for 1.
    expect(within(dialog).getByRole('button', { name: '2 weeks' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(dialog).getByRole('button', { name: '1 week' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));

    const preview = within(dialog).getByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('4 listings')).toBeTruthy();
    expect(within(preview).getByText('In cooldown').nextElementSibling?.textContent).toBe('1');
    // Open one intern's list.
    await userEvent.click(within(preview).getByText('Mika Reyes'));
    expect(within(within(preview).getByRole('list', { name: "Mika's queue" })).getAllByRole('listitem')).toHaveLength(2);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save all' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = platform.posts.find((p) => p.action === 'saveQueues')!.body as {
      week: string;
      queues: { assignedTo: string; start: string; due: string; items: { propertyName: string }[] }[];
    };
    expect(sent.week).toBe('2026-11-02');
    // Saturday: each new queue starts on Monday, and runs the week.
    expect(sent.queues.every((q) => q.start === '2026-11-02' && q.due === '2026-11-06')).toBe(true);
    expect(sent.queues.map((q) => q.assignedTo).sort()).toEqual([intern.name, 'Mika Reyes']);
    expect(sent.queues.every((q) => q.items.length === 2)).toBe(true);
    expect(sent.queues.flatMap((q) => q.items.map((i) => i.propertyName))).not.toContain('Kapitolyo Ground Floor Retail, Pasig');
    expect(await screen.findByText(/Saved 2 queues, 4 listings/)).toBeTruthy();
    // The assignments are read again.
    await waitFor(() => {
      const actions = platform.posts.map((p) => p.action);
      expect(actions.lastIndexOf('assignments')).toBeGreaterThan(actions.indexOf('saveQueues'));
    });
  });

  it('says how short the plan fell', async () => {
    const platform = fakeServer({ team: TEAM });
    renderApp({ platform, user: admin, path: '/assign' });
    await userEvent.click(await screen.findByRole('button', { name: 'Fill queues' }));
    const dialog = screen.getByRole('dialog', { name: 'Fill queues' });
    // Two agents and an admin, then Keep existing queues.
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox')).toHaveLength(4));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    // 5 listings for 2 interns at 40 a week, for 2 weeks each: the admin isn't ticked.
    expect(within(dialog).getByText(/155 listings short of 40 a week each/)).toBeTruthy();
  });

  it("ticks no one while the team can't be read: the tracker's names may be admins (D31)", async () => {
    const assignments = {
      ok: true,
      assignments: [{ date: '2026-10-26', assignedTo: manager.name, property: 'Verdant Hills Lot 12, Tagaytay', status: 'Posted', propertyId: '' }],
    };
    const team = { ok: false, error: 'unavailable', message: "The web app didn't answer. Try again in a minute." };
    renderApp({ platform: fakeServer({ team, posts: POSTS, assignments }), user: admin, path: '/assign' });
    await userEvent.click(await screen.findByRole('button', { name: 'Fill queues' }));
    const dialog = screen.getByRole('dialog', { name: 'Fill queues' });
    // Everyone the tracker mentions, less you: an agent and an admin, neither ticked.
    await waitFor(() => expect(within(dialog).getByRole('group', { name: 'Agents 0 of 2' })).toBeTruthy());
    expect((within(dialog).getByRole('checkbox', { name: manager.name }) as HTMLInputElement).checked).toBe(false);
    expect((within(dialog).getByRole('checkbox', { name: intern.name }) as HTMLInputElement).checked).toBe(false);
  });

  it('ticks the agents once the team arrives, when Fill queues was opened before it did (D31)', async () => {
    let arrive!: () => void;
    const late = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const assignments = {
      ok: true,
      assignments: [{ date: '2026-10-26', assignedTo: intern.name, property: 'Verdant Hills Lot 12, Tagaytay', status: 'Posted', propertyId: '' }],
    };
    const team = async () => {
      await late;
      return TEAM;
    };
    renderApp({ platform: fakeServer({ team, posts: POSTS, assignments }), user: admin, path: '/assign' });
    await userEvent.click(await screen.findByRole('button', { name: 'Fill queues' }));
    const dialog = screen.getByRole('dialog', { name: 'Fill queues' });
    // The tracker's names while the team is on its way: nobody ticked.
    await waitFor(() => expect(within(dialog).getByRole('group', { name: 'Agents 0 of 1' })).toBeTruthy());

    arrive();
    // The team's active agents, ticked; its admins in their own group, not.
    await waitFor(() => expect(within(dialog).getByRole('group', { name: 'Agents 2 of 2' })).toBeTruthy());
    expect(within(dialog).getByRole('group', { name: 'Admins 0 of 1' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Preview' }).hasAttribute('disabled')).toBe(false);
  });

  it('fills an admin’s queue too, once ticked (D31)', async () => {
    const platform = fakeServer({ team: TEAM, saveQueues: (body) => ({ ok: true, saved: 3, echo: body }) });
    renderApp({ platform, user: admin, path: '/assign' });
    await userEvent.click(await screen.findByRole('button', { name: 'Fill queues' }));
    const dialog = screen.getByRole('dialog', { name: 'Fill queues' });
    const mine = await within(dialog).findByRole('checkbox', { name: admin.name });
    // Only the admin: both agents unticked.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: intern.name }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Mika Reyes' }));
    await userEvent.click(mine);
    expect(within(dialog).getByRole('group', { name: 'Agents 0 of 2' })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Admins 1 of 1' })).toBeTruthy();

    const per = within(dialog).getByLabelText('Per week');
    await userEvent.clear(per);
    await userEvent.type(per, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: '1 week' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save all' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = platform.posts.find((p) => p.action === 'saveQueues')!.body as { queues: { assignedTo: string; items: unknown[] }[] };
    expect(sent.queues.map((q) => q.assignedTo)).toEqual([admin.name]);
    expect(sent.queues[0]!.items).toHaveLength(3);
  });
});
