// @vitest-environment jsdom
/**
 * Rewording the public text with Claude (AID-129): Post-It's `paraphrase`
 * function is sent what Copy would copy and nothing else, the reword is shown
 * beside the original, gets the same checks, and Copy takes whichever the
 * person chooses.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '@/platform/fake';
import type { FirebaseAccess } from '@/platform/firebase';
import { CLEAN, PROPERTIES, TEAM, intern, propertyReply, renderApp } from '../../state/testing';

const PATH = `/property/${CLEAN.id}`;
const OWNER = 'Owner: Mrs. Navarro, 0918 555 0199';
const REWORD = 'Verdant Hills lot for sale, 320 sqm\nAsking ₱4.2M\nCall 0917 555 0142';

type Paraphrase = (data: { readonly text: string }) => Promise<unknown>;

/** Firebase with one account signed in, whose `paraphrase` answers with `paraphrase`. Records what it was sent. */
function fakeFirebase(paraphrase: Paraphrase): FirebaseAccess & { readonly sent: { readonly text: string }[] } {
  const sent: { readonly text: string }[] = [];
  return {
    target: 'emulator',
    sent,
    watch(changed) {
      queueMicrotask(() => changed({ uid: 'uid-jan', email: 'jan@example.com', name: intern.name }));
      return () => undefined;
    },
    role: async () => 'agent',
    signIn: async () => undefined,
    signOut: async () => undefined,
    changePassword: async () => undefined,
    token: async () => ({ uid: 'uid-jan', token: 'token-for-jan' }),
    async call<T>(name: string, data: object = {}) {
      if (name !== 'paraphrase') throw new Error(`not used: ${name}`);
      sent.push(data as { text: string });
      return (await paraphrase(data as { text: string })) as T;
    },
  };
}

/** A function's refusal, as Firebase's SDK throws it. */
const refused = (code: string, message: string) => Object.assign(new Error(message), { code: `functions/${code}` });

function platformWith(firebase: FirebaseAccess | null, property = propertyReply({ internalText: OWNER })): FakePlatform {
  return createFakePlatform({
    key: 'test-key',
    firebase,
    replies: {
      properties: PROPERTIES,
      property,
      posts: { ok: true, posts: [] },
      assignments: { ok: true, assignments: [] },
      team: TEAM,
    },
  });
}

const copyButton = () => screen.getByRole('button', { name: /^Copy/ }) as HTMLButtonElement;
const rewordButton = () => screen.findByRole('button', { name: 'Reword' });

async function ready() {
  await waitFor(() => expect(screen.getByText('Ready to copy. Every check passed.')).toBeTruthy(), { timeout: 5000 });
}

describe('rewording with Claude', () => {
  it('sends the public text only, shows the reword beside the original, and copies the one chosen', async () => {
    const firebase = fakeFirebase(async () => ({ text: REWORD }));
    const platform = platformWith(firebase);
    renderApp({ platform, path: PATH });
    await ready();

    await userEvent.click(await rewordButton());
    const choices = await screen.findByRole('group', { name: 'Which text Copy takes' });
    expect(firebase.sent).toEqual([{ text: CLEAN.publicText }]);
    expect(firebase.sent[0]?.text).not.toContain('Navarro');

    // Side by side, the original still chosen.
    const original = within(choices).getByRole('radio', { name: 'Original' }) as HTMLInputElement;
    const reword = within(choices).getByRole('radio', { name: /^Reword/ }) as HTMLInputElement;
    expect(original.checked).toBe(true);
    expect(within(choices).getByRole('document', { name: 'Reword' }).textContent).toBe(REWORD);
    expect(within(choices).getByRole('document', { name: 'Public text' }).textContent).toBe(CLEAN.publicText);

    await userEvent.click(reword);
    expect(reword.checked).toBe(true);
    expect(screen.getByText('On the reword')).toBeTruthy();
    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual([REWORD]));
    expect(await screen.findByText('Copied the reword. Paste it into Facebook.')).toBeTruthy();

    await userEvent.click(original);
    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual([REWORD, CLEAN.publicText]));
    expect(platform.copied.join()).not.toContain('Navarro');
    // Many clicks: more than the default 5 seconds while the whole suite runs.
  }, 15_000);

  it('works on a listing found by searching, and the post is saved to the person signed in', async () => {
    const LINK = 'https://www.facebook.com/groups/apgmain/posts/1029384801/';
    const platform = createFakePlatform({
      key: 'test-key',
      firebase: fakeFirebase(async () => ({ text: REWORD })),
      replies: {
        properties: PROPERTIES,
        property: propertyReply({ internalText: OWNER }),
        posts: { ok: true, posts: [] },
        assignments: { ok: true, assignments: [] },
        team: TEAM,
        logPost: { ok: true, status: 'Posted', date: '2026-11-13', postedBy: intern.name },
      },
    });
    renderApp({ platform, path: '/find' });

    const box = await screen.findByRole('searchbox', { name: 'Search listings' });
    await userEvent.type(box, 'verdant{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: CLEAN.name })).toBeTruthy();
    await ready();

    await userEvent.click(await rewordButton());
    await userEvent.click(await screen.findByRole('radio', { name: /^Reword/ }));
    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual([REWORD]));

    await userEvent.type(await screen.findByLabelText('Post link'), LINK);
    await userEvent.click(screen.getByRole('button', { name: 'Posted' }));
    const logged = () => platform.posts.filter((p) => p.action === 'logPost');
    await waitFor(() => expect(logged()).toHaveLength(1));
    expect(logged()[0]!.body).toMatchObject({ propertyId: CLEAN.id, postLink: LINK, status: 'Posted' });
    // Who posted it is the server's to say, from the sign-in: never sent from here.
    expect(logged()[0]!.body).not.toHaveProperty('postedBy');
    expect(await screen.findByText(`Saved as posted: ${CLEAN.name}.`)).toBeTruthy();
  }, 20_000);

  it("won't let a reword that changes a number be chosen", async () => {
    const platform = platformWith(fakeFirebase(async () => ({ text: REWORD.replace('4.2M', '4.5M') })));
    renderApp({ platform, path: PATH });
    await ready();

    await userEvent.click(await rewordButton());
    const reword = (await screen.findByRole('radio', { name: /^Reword/ })) as HTMLInputElement;
    expect(reword.disabled).toBe(true);
    expect(screen.getByText(/Can’t be posted\. It changes the numbers: it adds “4\.5” and leaves out “4\.2”\./)).toBeTruthy();
    await userEvent.click(copyButton());
    await waitFor(() => expect(platform.copied).toEqual([CLEAN.publicText]));
  });

  it("won't let a reword with commission wording be chosen", async () => {
    const platform = platformWith(fakeFirebase(async () => ({ text: `${REWORD}\nCommission for agents` })));
    renderApp({ platform, path: PATH });
    await ready();

    await userEvent.click(await rewordButton());
    expect(((await screen.findByRole('radio', { name: /^Reword/ })) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/^Can’t be posted\. No commission wording: Found "Commission"/)).toBeTruthy();
  });

  it("says why when the hub's limit is reached, and the original stays", async () => {
    const message = "You've used today's $5 of Claude. Claude is back tomorrow.";
    // As Firebase's SDK words it: the function's message, then the HTTP status.
    const platform = platformWith(fakeFirebase(async () => Promise.reject(refused('resource-exhausted', `${message} [429]`))));
    renderApp({ platform, path: PATH });
    await ready();

    await userEvent.click(await rewordButton());
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Which text Copy takes' })).toBeNull();
    expect(copyButton().disabled).toBe(false);
  });

  it.each([
    ['internal', 'internal [500]', "Claude didn't answer. Try again, or post the original."],
    ['internal', 'internal', "Claude didn't answer. Try again, or post the original."],
    // No answer it could read: offline, or turned away before the function ran.
    ['internal', 'internal [0]', "Couldn't reach Claude. Try again, or post the original."],
  ])("puts Firebase's own failure %s %j in words", async (code, raw, words) => {
    const platform = platformWith(fakeFirebase(async () => Promise.reject(refused(code, raw))));
    renderApp({ platform, path: PATH });
    await ready();

    await userEvent.click(await rewordButton());
    expect(await screen.findByText(words)).toBeTruthy();
  });

  it('is not offered without an account', async () => {
    renderApp({ platform: platformWith(null), path: PATH });
    await ready();
    expect(screen.queryByRole('button', { name: 'Reword' })).toBeNull();
  });

  it('is not offered for text that fails a check', async () => {
    const failing = platformWith(
      fakeFirebase(async () => ({ text: REWORD })),
      propertyReply({ publicText: `${CLEAN.publicText}\nReferral fee for co-brokers.` }),
    );
    renderApp({ platform: failing, path: PATH });
    await waitFor(() => expect(copyButton().disabled).toBe(true), { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Reword' })).toBeNull();
  });
});
