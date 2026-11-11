// @vitest-environment jsdom
/**
 * Never lose a log (PI-E14): a post whose save fails on the way is kept on
 * this PC, shown as waiting, and sent again, dated when it was logged. A
 * refusal is still the server's answer, shown at once, and a kept post is only
 * ever sent while its own person is signed in.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OUTBOX_KEY } from '@/core/outbox';
import { CLEAN, fakeServer, intern, renderApp } from './state/testing';

const PATH = `/property/${CLEAN.id}`;
const LINK = 'https://www.facebook.com/groups/apgmain/posts/555/';
const OK = { ok: true, status: 'Posted', date: '2026-10-31', postedBy: intern.name };

const logged = (platform: ReturnType<typeof fakeServer>) => platform.posts.filter((p) => p.action === 'logPost');

async function logIt() {
  await userEvent.type(await screen.findByLabelText('Post link'), LINK);
  await userEvent.click(screen.getByRole('button', { name: 'Posted' }));
}

describe('a post whose save fails on the way', () => {
  it('is kept on this PC and shown as waiting, then saved by Retry now, dated when it was logged', async () => {
    const platform = fakeServer({ logPost: new Error('offline') });
    renderApp({ platform, path: PATH });
    await logIt();

    expect(await screen.findByText(`Kept on this PC: ${CLEAN.name}. It's saved when the connection is back.`)).toBeTruthy();
    expect(await screen.findByText('1 post waiting to save')).toBeTruthy();
    const kept = JSON.parse((await platform.readLocal(OUTBOX_KEY))!) as { kept: { who: string; loggedAt: string }[] };
    expect(kept.kept).toHaveLength(1);
    expect(kept.kept[0]!.who).toBe(intern.name);

    platform.reply('logPost', OK);
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await waitFor(() => expect(screen.queryByText('1 post waiting to save')).toBeNull());
    const retry = logged(platform).at(-1)!.body as Record<string, unknown>;
    expect(retry).toMatchObject({ postLink: LINK, propertyId: CLEAN.id, loggedAt: kept.kept[0]!.loggedAt });
  }, 20_000); // a whole sign-in, log and retry: slow when every test file runs at once

  it('shows why when the web app then refuses it, until dismissed', async () => {
    const platform = fakeServer({ logPost: new Error('offline') });
    renderApp({ platform, path: PATH });
    await logIt();
    await screen.findByText('1 post waiting to save');

    platform.reply('logPost', { ok: false, error: 'cooldown', message: 'Posted 2 days ago (29 Oct).', nextAllowed: '2026-11-05' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(await screen.findByText(`Not saved: ${CLEAN.name}`)).toBeTruthy();
    expect(screen.queryByText('1 post waiting to save')).toBeNull();

    // A web app before v18 didn't tell the admin: the agent is asked to.
    expect(screen.getByText('Posted 2 days ago (29 Oct). This post is on Facebook but not on the tracker: tell your admin.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: `Dismiss: ${CLEAN.name}` }));
    expect(screen.queryByText(`Not saved: ${CLEAN.name}`)).toBeNull();
  });

  it("shows the web app's own words when it has told the admin (v18)", async () => {
    const platform = fakeServer({ logPost: new Error('offline') });
    renderApp({ platform, path: PATH });
    await logIt();
    await screen.findByText('1 post waiting to save');

    const words =
      'Logged 31 Oct at 9:00 AM, but Ana Reyes posted it on 29 Oct, inside the cooldown of 7 days. ' +
      'It is on Facebook but not on the tracker. Your admin has been told.';
    platform.reply('logPost', { ok: false, error: 'cooldown', message: words, nextAllowed: '2026-11-05', lastPostedBy: 'Ana Reyes', reported: true });
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(await screen.findByText(`Not saved: ${CLEAN.name}`)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
  });

  it('is not kept when the server refuses it at once: the refusal shows, as before', async () => {
    const platform = fakeServer({ logPost: { ok: false, error: 'cooldown', message: 'Posted today (31 Oct).', nextAllowed: '2026-11-07' } });
    renderApp({ platform, path: PATH });
    await logIt();

    expect(await screen.findByText('Not saved: still in its cooldown')).toBeTruthy();
    expect(screen.queryByText(/waiting to save/)).toBeNull();
    expect(await platform.readLocal(OUTBOX_KEY)).toBeNull();
  });

  it("never sends someone else's kept post", async () => {
    const theirs = {
      kept: [
        {
          id: 'k1',
          who: 'Someone Else',
          input: { propertyId: CLEAN.id, propertyName: CLEAN.name, fbAccount: 'APG Main', postLink: LINK, status: 'Posted' },
          loggedAt: '2026-10-31T01:00:00.000Z',
          tries: 1,
          lastError: 'offline',
        },
      ],
      refused: [],
    };
    const platform = fakeServer({ logPost: OK });
    await platform.writeLocal(OUTBOX_KEY, JSON.stringify(theirs));
    renderApp({ platform, path: '/find' });

    await screen.findByRole('heading', { level: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(logged(platform)).toHaveLength(0);
    expect(screen.queryByText(/waiting to save/)).toBeNull();
  });
});
