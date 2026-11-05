// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admin, fakeServer, intern, renderApp } from '../../state/testing';

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
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox', { name: /Reyes|Dela Cruz/ })).toHaveLength(2));
    expect((within(dialog).getByRole('checkbox', { name: intern.name }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('checkbox', { name: 'Mika Reyes' }) as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).queryByRole('checkbox', { name: 'Carlo Mendoza' })).toBeNull();
    expect((within(dialog).getByRole('checkbox', { name: 'Keep existing queues' }) as HTMLInputElement).checked).toBe(true);
    // Saturday: the week is the coming one, and the target is the week's.
    expect(within(dialog).getByText('2–6 Nov')).toBeTruthy();
    expect((within(dialog).getByLabelText('Per week') as HTMLInputElement).value).toBe('40');

    const per = within(dialog).getByLabelText('Per week');
    await userEvent.clear(per);
    await userEvent.type(per, '2');
    expect(within(dialog).getByRole('button', { name: 'Save all' }).hasAttribute('disabled')).toBe(true);
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
      queues: { assignedTo: string; items: { propertyName: string }[] }[];
    };
    expect(sent.week).toBe('2026-11-02');
    expect(sent.queues.map((q) => q.assignedTo).sort()).toEqual([intern.name, 'Mika Reyes']);
    expect(sent.queues.every((q) => q.items.length === 2)).toBe(true);
    expect(sent.queues.flatMap((q) => q.items.map((i) => i.propertyName))).not.toContain('Kapitolyo Ground Floor Retail, Pasig');
    expect(await screen.findByText(/Saved 2 queues for 2–6 Nov/)).toBeTruthy();
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
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    // 5 listings for 2 interns at 40 each.
    expect(within(dialog).getByText(/75 listings short of 40 each/)).toBeTruthy();
  });
});
