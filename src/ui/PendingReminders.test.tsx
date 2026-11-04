// @vitest-environment jsdom
/**
 * Pending reminders (PI-E16): posts still waiting for the group admin's
 * approval are shown oldest first in My queue (PI-87), a Windows notification
 * says so once a day after the days set (PI-88), and the admin sees how long
 * each intern's oldest has waited.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { waitedFor, waitingPosts } from '@/core/summary';
import type { PostLogEntry } from '@/core/types';
import { REMINDED_KEY } from './PendingNotifier';
import { fakeServer, intern, manager, renderApp, TODAY } from './state/testing';

function post(title: string, date: string, status: 'Pending' | 'Posted' = 'Pending', postedBy = intern.name): PostLogEntry {
  return { date, time: '10:00', type: 'Lot', title, status, fbAccount: 'APG Main', postLink: `https://www.facebook.com/groups/apg/posts/${title.length}${date}/`, postedBy, propertyId: `id-${title}` };
}

// TODAY is Sat 31 Oct 2026.
const OLD = post('Old Lot, Silang', '2026-10-26');
const NEWER = post('Newer Lot, Tagaytay', '2026-10-30');
const LIVE = post('Live Lot, Imus', '2026-10-27', 'Posted');
const SOMEONE_ELSES = post('Their Lot', '2026-10-20', 'Pending', 'Ana Reyes');

const POSTS = { ok: true, posts: [NEWER, LIVE, OLD, SOMEONE_ELSES] };

describe('waitingPosts', () => {
  it("is a person's Pending posts, oldest first, with how many days each has waited", () => {
    expect(waitingPosts([NEWER, LIVE, OLD, SOMEONE_ELSES], intern.name, TODAY).map((w) => [w.post.title, w.days])).toEqual([
      ['Old Lot, Silang', 5],
      ['Newer Lot, Tagaytay', 1],
    ]);
  });

  it('says how long in words', () => {
    expect([0, 1, 4].map(waitedFor)).toEqual(['today', '1 day', '4 days']);
  });
});

describe('My queue', () => {
  it('lists the posts waiting for approval, oldest first, and Approved marks one posted with its own link', async () => {
    const platform = fakeServer({ posts: POSTS, addLink: { ok: true } });
    renderApp({ platform, path: '/queue' });

    const card = (await screen.findByText('2 posts waiting for approval')).closest('.waiting')!;
    const rows = Array.from(card.querySelectorAll('.waiting__title')).map((t) => t.textContent);
    expect(rows).toEqual(['Old Lot, Silang', 'Newer Lot, Tagaytay']);
    expect(within(card as HTMLElement).getByText('Waiting 5 days')).toBeTruthy();

    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Approved: Old Lot, Silang' }));
    await waitFor(() => expect(platform.posts.some((p) => p.action === 'addLink')).toBe(true));
    expect(platform.posts.find((p) => p.action === 'addLink')!.body).toMatchObject({ postLink: OLD.postLink });
  });

  it('shows nothing when nothing is waiting', async () => {
    renderApp({ platform: fakeServer({ posts: { ok: true, posts: [LIVE] } }), path: '/queue' });
    await screen.findByRole('heading', { name: 'My queue' });
    expect(screen.queryByText(/waiting for approval/)).toBeNull();
  });
});

describe('the Windows reminder', () => {
  it('says how many have waited the days set, and the oldest, once a day', async () => {
    const platform = fakeServer({ posts: POSTS });
    renderApp({ platform, path: '/queue' });

    await waitFor(() => expect(platform.notified).toHaveLength(1));
    // Two days by default: only the old one counts.
    expect(platform.notified[0]).toEqual({
      title: '1 post still waiting for approval',
      body: 'Oldest: Old Lot, Silang, waiting 5 days. Check them in My queue.',
    });
    expect(await platform.readLocal(REMINDED_KEY)).toBe(`${TODAY}|${intern.name}`);
  });

  it('does not remind again the same day', async () => {
    const platform = fakeServer({ posts: POSTS });
    await platform.writeLocal(REMINDED_KEY, `${TODAY}|${intern.name}`);
    renderApp({ platform, path: '/queue' });
    await screen.findByText('2 posts waiting for approval');
    await new Promise((r) => setTimeout(r, 50));
    expect(platform.notified).toHaveLength(0);
  });

  it("is set in Settings → App, and kept on this PC", async () => {
    const platform = fakeServer({ posts: { ok: true, posts: [post('Admin Lot', '2026-10-20', 'Pending', manager.name)] } });
    renderApp({ platform, user: manager, path: '/settings?tab=app' });

    const reminders = await screen.findByRole('group', { name: 'Remind me after' });
    await userEvent.click(within(reminders).getByRole('radio', { name: 'Off' }));
    await waitFor(async () => expect(JSON.parse((await platform.readLocal('postit.settings'))!)).toMatchObject({ pendingReminderDays: 0 }));
  });
});

describe('the Interns screen', () => {
  it("shows how many of each intern's posts are waiting, and the oldest", async () => {
    const platform = fakeServer({ posts: POSTS });
    renderApp({ platform, user: manager, path: '/interns' });
    const row = (await screen.findByRole('button', { name: new RegExp(intern.name) })).closest('tr')!;
    expect(within(row).getByText('2 · oldest 5 days')).toBeTruthy();
  });
});
