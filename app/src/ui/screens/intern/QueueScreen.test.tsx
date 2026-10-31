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
    item('Verdant Hills Lot 12, Tagaytay', '1VerdantHillsLot12', 'To post'),
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
  it("lists today's items in the manager's order, with the pending one pinned on top, and counts them", async () => {
    renderApp({ platform: fakeServer({ assignments: QUEUE, posts: POSTS }), path: '/queue' });

    await screen.findByText('Seaside Residences 2BR, Pasay');
    const names = Array.from(document.querySelectorAll('.queue__list > li .queue-item__name')).map((n) => n.textContent);
    expect(names).toEqual([
      'Seaside Residences 2BR, Pasay',
      'Verdant Hills Lot 12, Tagaytay',
      'Valenzuela Warehouse 1,200 sqm',
      'Kapitolyo Ground Floor Retail, Pasig',
    ]);
    // Tomorrow's item is not today's work.
    expect(screen.queryByText('BGC Uptown Office 18F, 240 sqm')).toBeNull();

    const counts = screen.getByRole('list', { name: "Today's counts" }).textContent;
    expect(counts).toContain('2to post');
    expect(counts).toContain('1waiting for a link');
    expect(counts).toContain('1posted');

    // The next one to post is the one gold button; it opens from the queue.
    const next = screen.getByRole('link', { name: /Verdant Hills Lot 12, Tagaytay.*next to post/ });
    expect(next.querySelector('.button--primary')).toBeTruthy();
    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);
    expect(screen.getByText('Logged at 11:02 from APG Main. Waiting for the group to approve it. Add the live link once it\'s up.')).toBeTruthy();

    // The count in the nav: what is left today.
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /My queue/ }).textContent).toContain('3 left in your queue today');
  });

  it('completes a pending post with its live link', async () => {
    const platform = fakeServer({ assignments: QUEUE, posts: POSTS, addLink: { ok: true, row: 3 } });
    renderApp({ platform, path: '/queue' });

    const field = await screen.findByLabelText('Live post link');
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(await screen.findByText('Paste the link of the live post.')).toBeTruthy();

    await userEvent.type(field, 'https://www.facebook.com/groups/apgmain/posts/2/');
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));

    await waitFor(() => expect(platform.posts.some((p) => p.action === 'addLink')).toBe(true));
    expect(platform.posts.find((p) => p.action === 'addLink')?.body).toMatchObject({
      propertyId: '1Seaside',
      property: 'Seaside Residences 2BR, Pasay',
      postLink: 'https://www.facebook.com/groups/apgmain/posts/2/',
    });
    expect(await screen.findByText('Link added. Seaside Residences 2BR, Pasay is marked posted.')).toBeTruthy();
  });

  it('opens a listing from the queue, and the listing knows it came from there', async () => {
    renderApp({ platform: fakeServer({ assignments: QUEUE, posts: POSTS }), path: '/queue' });
    await userEvent.click(await screen.findByRole('link', { name: /Verdant Hills Lot 12, Tagaytay/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'My queue' })).toBeTruthy();
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
