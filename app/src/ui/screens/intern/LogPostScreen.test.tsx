// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CLEAN, fakeServer, intern, internAnyAccount, renderApp } from '../../state/testing';

const PATH = `/property/${CLEAN.id}/log`;
const LINK = 'https://www.facebook.com/groups/apgmain/posts/1029384801/';

const save = () => screen.getByRole('button', { name: /^Save/ });
const logged = (platform: ReturnType<typeof fakeServer>) => platform.posts.filter((p) => p.action === 'logPost');

describe('Log a post', () => {
  it("shows the server's sentence and the next allowed date when the cooldown refuses it", async () => {
    const sentence = 'Posted 3 days ago by Bea Ramos. You can post it again on Wed 4 Nov.';
    const platform = fakeServer({
      logPost: { ok: false, error: 'cooldown', lastPosted: '2026-10-28', nextAllowed: '2026-11-04', message: sentence },
    });
    renderApp({ platform, path: PATH });

    await userEvent.type(await screen.findByLabelText('Post link'), LINK);
    await userEvent.click(save());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Not saved: it's still in its cooldown");
    expect(alert.textContent).toContain(sentence);
    expect(alert.textContent).toContain('Next allowed: Wed 4 Nov 2026');
    // Still here, with what was typed, to read and decide.
    expect((screen.getByLabelText('Post link') as HTMLInputElement).value).toBe(LINK);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Log a post');
  });

  it('logs the chosen account and the link; the rest of the row is filled in', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Posted', date: '2026-10-31', postedBy: intern.name } });
    renderApp({ platform, path: PATH, state: { section: 'queue' } });

    // Arrives in the field to paste into, with an account already chosen.
    const link = await screen.findByLabelText('Post link');
    await waitFor(() => expect(document.activeElement).toBe(link));
    expect((screen.getByRole('radio', { name: 'APG Main' }) as HTMLInputElement).checked).toBe(true);

    await userEvent.click(screen.getByRole('radio', { name: 'APG Rentals South' }));
    await userEvent.type(link, `${LINK}{Enter}`);

    await waitFor(() => expect(logged(platform)).toHaveLength(1));
    expect(logged(platform)[0]!.body).toMatchObject({
      property: CLEAN.name,
      propertyId: CLEAN.id,
      fbAccount: 'APG Rentals South',
      postLink: LINK,
      type: 'Condo / house and lot',
    });
    // Nothing the server decides is sent: not the date, the time, or who posted it.
    expect(logged(platform)[0]!.body).not.toHaveProperty('postedBy');
    expect(logged(platform)[0]!.body).not.toHaveProperty('date');

    // Back to the queue it came from, saying so.
    expect(await screen.findByText(`Logged. ${CLEAN.name}, posted from APG Rentals South.`)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My queue');
  });

  it('logs a post without its link as pending', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Pending', date: '2026-10-31', postedBy: intern.name } });
    renderApp({ platform, path: PATH });
    await screen.findByLabelText('Post link');
    expect(screen.getByText('Pending', { selector: '.pill' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save as pending' }));
    await waitFor(() => expect(logged(platform)[0]?.body).toMatchObject({ postLink: '' }));
    expect(await screen.findByText(/Logged as pending/)).toBeTruthy();
  });

  it('takes the account as typed when the team lists none for you', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Posted', date: '2026-10-31', postedBy: internAnyAccount.name } });
    renderApp({ platform, user: internAnyAccount, path: PATH });

    const account = await screen.findByLabelText('FB account');
    expect(screen.queryByRole('radio')).toBeNull();
    await userEvent.type(screen.getByLabelText('Post link'), LINK);
    await userEvent.click(save());
    expect(await screen.findByText('Type the FB account you posted from.')).toBeTruthy();
    expect(logged(platform)).toHaveLength(0);

    await userEvent.type(account, 'APG Industrial');
    await userEvent.click(save());
    await waitFor(() => expect(logged(platform)[0]?.body).toMatchObject({ fbAccount: 'APG Industrial' }));
  });

  it("refuses a link that isn't Facebook's before sending anything", async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    await userEvent.type(await screen.findByLabelText('Post link'), 'https://www.example.com/post/1');
    await userEvent.click(save());
    expect(await screen.findByText(/That isn't a Facebook link/)).toBeTruthy();
    expect(logged(platform)).toHaveLength(0);
  });

  it('shows any other refusal as it was written', async () => {
    const platform = fakeServer({
      logPost: { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' },
    });
    renderApp({ platform, path: PATH });
    await userEvent.type(await screen.findByLabelText('Post link'), LINK);
    await userEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('Someone else is saving right now. Try again in a moment.');
  });
});
