// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeServer, intern, renderApp, TODAY } from '../../state/testing';

const item = (property: string, propertyId: string, status: string, date = TODAY, assignedTo = intern.name) => ({
  date,
  assignedTo,
  property,
  propertyId,
  status,
});

const QUEUE = {
  ok: true,
  assignments: [
    // "Not Shared" is the interns' word; "To post", in older rows, is the same.
    item('Verdant Hills Lot 12, Tagaytay', '1VerdantHillsLot12', 'Not Shared'),
    item('Kapitolyo Ground Floor Retail, Pasig', '1Kapitolyo', 'Posted'),
    item('Seaside Residences 2BR, Pasay', '1Seaside', 'Pending'),
    item('Valenzuela Warehouse 1,200 sqm', '1Valenzuela', 'To post'),
    item('BGC Uptown Office 18F, 240 sqm', '1BgcUptown', 'To post', '2026-11-01'),
  ],
};

const POSTS = {
  ok: true,
  posts: [
    { date: TODAY, time: '09:41', type: '', title: 'Kapitolyo Ground Floor Retail, Pasig', status: 'Posted', fbAccount: 'APG Main', postLink: 'https://www.facebook.com/groups/apgmain/posts/1/', postedBy: intern.name, propertyId: '1Kapitolyo' },
    { date: TODAY, time: '11:02', type: '', title: 'Seaside Residences 2BR, Pasay', status: 'Pending', fbAccount: 'APG Main', postLink: '', postedBy: intern.name, propertyId: '1Seaside' },
  ],
};

describe('My queue', () => {
  it('puts the next one up on top, then each row with its name, category and status', async () => {
    renderApp({ platform: fakeServer({ assignments: QUEUE, posts: POSTS }), path: '/queue' });

    const nextUp = await screen.findByRole('region', { name: 'Next up' });
    expect(nextUp.textContent).toContain('Verdant Hills Lot 12, Tagaytay');
    expect(nextUp.textContent).toContain('Condo / house and lot');
    // The next one is the one gold button; it opens from the queue.
    const open = within(nextUp).getByRole('link', { name: /Verdant Hills Lot 12, Tagaytay.*next to post/ });
    expect(open.querySelector('.button--primary')).toBeTruthy();
    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);

    // The rest: pending first, then what is left, then what is done. Tomorrow's item isn't today's work.
    const rows = Array.from(document.querySelectorAll('.queue__list > li'));
    expect(rows.map((r) => r.querySelector('.queue-item__name')?.textContent)).toEqual([
      'Seaside Residences 2BR, Pasay',
      'Valenzuela Warehouse 1,200 sqm',
      'Kapitolyo Ground Floor Retail, Pasig',
    ]);
    expect(rows.map((r) => r.querySelector('.pill')?.textContent)).toEqual(['Pending', 'Not shared', 'Posted']);
    expect(rows[1]!.textContent).toContain('Warehouse');
    expect(screen.queryByText('BGC Uptown Office 18F, 240 sqm')).toBeNull();

    const counts = screen.getByRole('list', { name: "Today's counts" }).textContent;
    expect(counts).toContain('2 not shared');
    expect(counts).toContain('1 pending');
    expect(counts).toContain('1 posted');

    // The count in the nav: what is left today.
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /My queue/ }).textContent).toContain('3 left in your queue today');
  });

  it('opens any row in one click', async () => {
    renderApp({ platform: fakeServer({ assignments: QUEUE, posts: POSTS }), path: '/queue' });
    await userEvent.click(await screen.findByRole('link', { name: 'Valenzuela Warehouse 1,200 sqm' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
    expect(document.querySelector('.back-link')?.textContent).toBe('My queue');
  });

  it('marks a pending post posted in one click, its link already logged', async () => {
    const withLink = {
      ok: true,
      posts: POSTS.posts.map((p) => (p.status === 'Pending' ? { ...p, postLink: 'https://www.facebook.com/groups/apgmain/posts/2/' } : p)),
    };
    const platform = fakeServer({ assignments: QUEUE, posts: withLink, setStatus: { ok: true } });
    renderApp({ platform, path: '/queue' });

    await userEvent.click(await screen.findByRole('button', { name: 'Mark Seaside Residences 2BR, Pasay posted' }));
    await waitFor(() => expect(platform.posts.some((p) => p.action === 'setStatus')).toBe(true));
    expect(platform.posts.find((p) => p.action === 'setStatus')?.body).toMatchObject({
      propertyId: '1Seaside',
      property: 'Seaside Residences 2BR, Pasay',
      assignedTo: intern.name,
      status: 'Posted',
    });
    expect(await screen.findByText('Marked posted: Seaside Residences 2BR, Pasay.')).toBeTruthy();
    // The server marks the post itself Posted too: the posts are read again, not only the queue.
    const after = (action: string) =>
      platform.posts.slice(platform.posts.findIndex((p) => p.action === 'setStatus')).some((p) => p.action === action);
    await waitFor(() => expect(after('posts')).toBe(true));
    expect(after('assignments')).toBe(true);
  });

  it('asks an old pending post, logged without a link, for its link first', async () => {
    const platform = fakeServer({ assignments: QUEUE, posts: POSTS, addLink: { ok: true, row: 3 } });
    renderApp({ platform, path: '/queue' });

    const field = await screen.findByLabelText('Post link');
    await userEvent.type(field, 'https://www.example.com/1');
    await userEvent.click(screen.getByRole('button', { name: 'Mark posted' }));
    expect(await screen.findByText("That isn't a Facebook link.")).toBeTruthy();
    expect(platform.posts.some((p) => p.action === 'addLink')).toBe(false);

    await userEvent.clear(field);
    await userEvent.type(field, 'https://www.facebook.com/groups/apgmain/posts/2/');
    await userEvent.click(screen.getByRole('button', { name: 'Mark posted' }));
    await waitFor(() =>
      expect(platform.posts.find((p) => p.action === 'addLink')?.body).toMatchObject({
        propertyId: '1Seaside',
        postLink: 'https://www.facebook.com/groups/apgmain/posts/2/',
      }),
    );
  });

  it('opens a listing from the queue, and the listing knows it came from there', async () => {
    renderApp({ platform: fakeServer({ assignments: QUEUE, posts: POSTS }), path: '/queue' });
    await userEvent.click(await screen.findByRole('link', { name: /Verdant Hills Lot 12, Tagaytay/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
    expect(document.querySelector('.back-link')?.textContent).toBe('My queue');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /My queue/ }).getAttribute('aria-current')).toBe('page');
  });

  it('says plainly when nothing is assigned today', async () => {
    renderApp({ platform: fakeServer(), path: '/queue' });
    expect(await screen.findByText('Nothing in your queue today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find a property' })).toBeTruthy();
  });

  it("shows the server's sentence when the queue can't be read", async () => {
    renderApp({
      platform: fakeServer({ assignments: { ok: false, error: 'forbidden', message: 'Your account cannot do that.' } }),
      path: '/queue',
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Your account cannot do that.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
