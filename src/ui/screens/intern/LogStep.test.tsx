// @vitest-environment jsdom
/**
 * The log step on the listing: the FB account, the post link (required, and
 * Facebook's), then Posted or Pending approval. Saved, the next listing in
 * the queue opens.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CLEAN, fakeServer, intern, internAnyAccount, manager, PROPERTIES, propertyReply, renderApp, TODAY } from '../../state/testing';

const PATH = `/property/${CLEAN.id}`;
const LINK = 'https://www.facebook.com/groups/apgmain/posts/1029384801/';

const posted = () => screen.getByRole('button', { name: 'Posted' }) as HTMLButtonElement;
const pending = () => screen.getByRole('button', { name: 'Pending approval' }) as HTMLButtonElement;
const linkField = () => screen.findByLabelText('Post link') as Promise<HTMLInputElement>;
const logged = (platform: ReturnType<typeof fakeServer>) => platform.posts.filter((p) => p.action === 'logPost');

/** The `property` reply for whichever listing is asked for, named after its id. */
const anyProperty = (body: Readonly<Record<string, unknown>>) =>
  body['id'] === CLEAN.id
    ? propertyReply()
    : propertyReply({ id: body['id'], name: body['id'] === '1Kapitolyo' ? 'Kapitolyo Ground Floor Retail, Pasig' : String(body['id']) });

const QUEUE = {
  ok: true,
  assignments: [
    { date: TODAY, assignedTo: intern.name, property: CLEAN.name, propertyId: CLEAN.id, status: 'To post' },
    { date: TODAY, assignedTo: intern.name, property: 'Seaside Residences 2BR, Pasay', propertyId: '1Seaside', status: 'Posted' },
    { date: TODAY, assignedTo: intern.name, property: 'Kapitolyo Ground Floor Retail, Pasig', propertyId: '1Kapitolyo', status: 'To post' },
  ],
};

describe('the log step', () => {
  it('needs a link: both buttons stay off until it is a valid Facebook link', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    const link = await linkField();

    expect(posted().disabled).toBe(true);
    expect(pending().disabled).toBe(true);

    // A group's page is Facebook, but not a post: still off.
    await userEvent.type(link, 'https://www.facebook.com/groups/x/posts/');
    expect(posted().disabled).toBe(true);
    await userEvent.type(link, '1');
    expect(posted().disabled).toBe(false);
    expect(pending().disabled).toBe(false);

    await userEvent.clear(link);
    expect(posted().disabled).toBe(true);
    await userEvent.type(link, '{Enter}');
    expect(logged(platform)).toHaveLength(0);
  });

  it("says what is wrong with a link that isn't Facebook's, and sends nothing", async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    const link = await linkField();
    await userEvent.type(link, 'https://www.example.com/post/1');

    expect(screen.getByText("That isn't a Facebook link.")).toBeTruthy();
    expect(link.getAttribute('aria-invalid')).toBe('true');
    expect(posted().disabled).toBe(true);
    expect(pending().disabled).toBe(true);
    await userEvent.type(link, '{Enter}');
    expect(logged(platform)).toHaveLength(0);
  });

  it('Posted sends status Posted with the link, the chosen account and the category', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name } });
    renderApp({ platform, path: PATH, state: { section: 'queue' } });

    const account = (await screen.findByLabelText('FB account')) as HTMLSelectElement;
    expect(account.tagName).toBe('SELECT');
    expect(account.value).toBe('APG Main');
    await userEvent.selectOptions(account, 'APG Rentals South');
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());

    await waitFor(() => expect(logged(platform)).toHaveLength(1));
    expect(logged(platform)[0]!.body).toMatchObject({
      property: CLEAN.name,
      propertyId: CLEAN.id,
      fbAccount: 'APG Rentals South',
      postLink: LINK,
      status: 'Posted',
      // The category as a fallback: the server writes the Property type from the Directory.
      type: 'CONDO / HOUSE AND LOT',
    });
    // Nothing the server decides is sent.
    expect(logged(platform)[0]!.body).not.toHaveProperty('postedBy');
    expect(logged(platform)[0]!.body).not.toHaveProperty('date');
    expect(await screen.findByText(`Saved as posted: ${CLEAN.name}.`)).toBeTruthy();
  });

  it('Pending approval sends status Pending with the link', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Pending', date: TODAY, postedBy: intern.name } });
    renderApp({ platform, path: PATH });
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(pending());

    await waitFor(() => expect(logged(platform)).toHaveLength(1));
    expect(logged(platform)[0]!.body).toMatchObject({ postLink: LINK, status: 'Pending' });
    expect(await screen.findByText(`Saved as pending: ${CLEAN.name}.`)).toBeTruthy();
  });

  it('opens the next listing in the queue once saved', async () => {
    const platform = fakeServer({
      assignments: QUEUE,
      property: anyProperty,
      logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name },
    });
    renderApp({ platform, path: PATH, state: { section: 'queue' } });
    await screen.findByRole('heading', { level: 1, name: CLEAN.name });
    await waitFor(() => expect(platform.posts.some((p) => p.action === 'assignments')).toBe(true));

    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());

    // Not the one just saved, not the one already posted: the next to post.
    expect(await screen.findByRole('heading', { level: 1, name: 'Kapitolyo Ground Floor Retail, Pasig' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'My queue' })).toBeTruthy();
    // A clean form for it.
    expect((await linkField()).value).toBe('');
  });

  it('opens the next listing on any day of the queue, not only its first: its rows carry its start (v14)', async () => {
    // Two weeks from Monday 26 Oct, due Friday 6 Nov, as the server writes them; today is Saturday 31 Oct.
    const running = { ok: true, assignments: QUEUE.assignments.map((a) => ({ ...a, date: '2026-10-26', due: '2026-11-06' })) };
    const platform = fakeServer({
      assignments: running,
      property: anyProperty,
      logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name },
    });
    renderApp({ platform, path: PATH, state: { section: 'queue' } });
    await screen.findByRole('heading', { level: 1, name: CLEAN.name });
    await waitFor(() => expect(platform.posts.some((p) => p.action === 'assignments')).toBe(true));

    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByRole('heading', { level: 1, name: 'Kapitolyo Ground Floor Retail, Pasig' })).toBeTruthy();
  });

  it("skips a listing gone from the property list, as My queue's Next up does", async () => {
    const row = (property: string, propertyId: string) => ({
      date: '2026-10-26',
      due: '2026-11-06',
      assignedTo: intern.name,
      property,
      propertyId,
      status: 'To post',
    });
    const assignments = {
      ok: true,
      assignments: [row(CLEAN.name, CLEAN.id), row('Gone Listing, Nowhere', '1Gone'), row('Kapitolyo Ground Floor Retail, Pasig', '1Kapitolyo')],
    };
    const platform = fakeServer({ assignments, property: anyProperty, logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name } });
    renderApp({ platform, path: PATH, state: { section: 'queue' } });
    await screen.findByRole('heading', { level: 1, name: CLEAN.name });
    await waitFor(() => expect(['assignments', 'properties'].every((a) => platform.posts.some((p) => p.action === a))).toBe(true));

    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByRole('heading', { level: 1, name: 'Kapitolyo Ground Floor Retail, Pasig' })).toBeTruthy();
  });

  it('skips a listing you already posted while the queue runs, as My queue does', async () => {
    // CLEAN, Seaside, Kapitolyo, none marked; but Seaside was posted on Tuesday, and its row wasn't told.
    const assignments = { ok: true, assignments: QUEUE.assignments.map((a) => ({ ...a, date: '2026-10-26', due: '2026-11-06', status: 'To post' })) };
    const seaside = {
      date: '2026-10-27',
      time: '10:00',
      type: 'Condo',
      title: 'Seaside Residences 2BR, Pasay',
      status: 'Posted',
      fbAccount: 'APG Main',
      postLink: 'https://www.facebook.com/groups/apg/posts/5/',
      postedBy: intern.name,
      propertyId: '1Seaside',
    };
    const platform = fakeServer({
      assignments,
      posts: { ok: true, posts: [seaside] },
      property: anyProperty,
      logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name },
    });
    renderApp({ platform, path: PATH, state: { section: 'queue' } });
    await screen.findByRole('heading', { level: 1, name: CLEAN.name });
    await waitFor(() => expect(['assignments', 'posts', 'properties'].every((a) => platform.posts.some((p) => p.action === a))).toBe(true));

    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByRole('heading', { level: 1, name: 'Kapitolyo Ground Floor Retail, Pasig' })).toBeTruthy();
  });

  it.each([
    ['no id', ''],
    ['a blank id', ' '],
    ['an id typed with a space', '1TowerSale '],
  ])("doesn't open the row this save completes, when another listing has its name: a row with %s", async (_, cell) => {
    // One name in two folders, for sale and for lease; the queue's row names it, its id cell as the server trims it.
    const NAME = 'Verdant Tower, Makati';
    const tower = (id: string, listingType: string) => ({
      id,
      name: NAME,
      category: 'CONDO / HOUSE AND LOT',
      listingType,
      subCategory: 'Condo',
      photoCount: 2,
      hasIssues: false,
    });
    const properties = { ok: true, properties: [...PROPERTIES.properties, tower('1TowerSale', 'FOR SALE'), tower('1TowerLease', 'FOR LEASE/ FOR RENT')] };
    const row = (property: string, propertyId: string) => ({ date: '2026-10-26', due: '2026-11-06', assignedTo: intern.name, property, propertyId, status: 'To post' });
    const platform = fakeServer({
      properties,
      assignments: { ok: true, assignments: [row(NAME, cell), row('Kapitolyo Ground Floor Retail, Pasig', '1Kapitolyo')] },
      property: (body) => (String(body['id']).startsWith('1Tower') ? propertyReply({ id: body['id'], name: NAME }) : anyProperty(body)),
      logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name },
    });
    renderApp({ platform, path: '/property/1TowerSale' });
    await screen.findByRole('heading', { level: 1, name: NAME });
    await waitFor(() => expect(['assignments', 'posts', 'properties'].every((a) => platform.posts.some((p) => p.action === a))).toBe(true));

    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    // The server moves that row for this post: the lease folder's page would be a listing just done.
    expect(await screen.findByRole('heading', { level: 1, name: 'Kapitolyo Ground Floor Retail, Pasig' })).toBeTruthy();
  });

  it("doesn't reopen the listing just posted when its row's id is an old one, found by its name", async () => {
    const row = (property: string, propertyId: string) => ({ date: '2026-10-26', due: '2026-11-06', assignedTo: intern.name, property, propertyId, status: 'To post' });
    const platform = fakeServer({
      assignments: { ok: true, assignments: [row('Kapitolyo Ground Floor Retail, Pasig', '1KapitolyoOld'), row(CLEAN.name, CLEAN.id)] },
      property: anyProperty,
      logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name },
    });
    // As My queue opens that row: by the listing its name finds.
    renderApp({ platform, path: '/property/1Kapitolyo', state: { section: 'queue' } });
    await screen.findByRole('heading', { level: 1, name: 'Kapitolyo Ground Floor Retail, Pasig' });
    await waitFor(() => expect(['assignments', 'posts', 'properties'].every((a) => platform.posts.some((p) => p.action === a))).toBe(true));

    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByRole('heading', { level: 1, name: CLEAN.name })).toBeTruthy();
  });

  it("opens the next listing of an admin's own queue too, when they came from it (D31)", async () => {
    const theirs = { ok: true, assignments: QUEUE.assignments.map((a) => ({ ...a, assignedTo: manager.name })) };
    const platform = fakeServer({
      assignments: theirs,
      property: anyProperty,
      logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: manager.name },
    });
    renderApp({ platform, user: manager, path: PATH, state: { section: 'queue' } });
    await screen.findByRole('heading', { level: 1, name: CLEAN.name });
    await waitFor(() => expect(platform.posts.some((p) => p.action === 'assignments')).toBe(true));

    await userEvent.type(await screen.findByLabelText('FB account'), 'APG Main');
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByRole('heading', { level: 1, name: 'Kapitolyo Ground Floor Retail, Pasig' })).toBeTruthy();
  });

  it('takes an admin who came from Find back to Find, not into their queue', async () => {
    const theirs = { ok: true, assignments: QUEUE.assignments.map((a) => ({ ...a, assignedTo: manager.name })) };
    const platform = fakeServer({
      assignments: theirs,
      property: anyProperty,
      logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: manager.name },
    });
    renderApp({ platform, user: manager, path: PATH, state: { section: 'find' } });
    await screen.findByRole('heading', { level: 1, name: CLEAN.name });
    await waitFor(() => expect(platform.posts.some((p) => p.action === 'assignments')).toBe(true));

    await userEvent.type(await screen.findByLabelText('FB account'), 'APG Main');
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByRole('heading', { level: 1, name: 'Find' })).toBeTruthy();
  });

  it('goes back to the queue when nothing is left in it', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: intern.name } });
    renderApp({ platform, path: PATH, state: { section: 'queue' } });
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
  });

  it("shows the server's sentence and the next allowed date when the cooldown refuses it", async () => {
    const sentence = 'Posted 3 days ago by Bea Ramos. You can post it again on Wed 4 Nov.';
    const platform = fakeServer({
      logPost: { ok: false, error: 'cooldown', lastPosted: '2026-10-28', nextAllowed: '2026-11-04', message: sentence },
    });
    renderApp({ platform, path: PATH });
    const link = await linkField();
    await userEvent.type(link, LINK);
    await userEvent.click(posted());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not saved: still in its cooldown');
    expect(alert.textContent).toContain(sentence);
    expect(alert.textContent).toContain('Next allowed: Wed 4 Nov 2026');
    // Still here, with what was typed.
    expect(link.value).toBe(LINK);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(CLEAN.name);
  });

  it('takes the account as typed when the team lists none for you', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Posted', date: TODAY, postedBy: internAnyAccount.name } });
    renderApp({ platform, user: internAnyAccount, path: PATH });

    const account = await screen.findByLabelText('FB account');
    expect(account.tagName).toBe('INPUT');
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByText('Type the FB account you posted from.')).toBeTruthy();
    expect(logged(platform)).toHaveLength(0);

    await userEvent.type(account, 'APG Industrial');
    await userEvent.click(posted());
    await waitFor(() => expect(logged(platform)[0]?.body).toMatchObject({ fbAccount: 'APG Industrial', status: 'Posted' }));
  });

  it('shows any other refusal as it was written', async () => {
    const platform = fakeServer({ logPost: { ok: false, error: 'forbidden', message: 'You are not assigned to APG Main.' } });
    renderApp({ platform, path: PATH });
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect((await screen.findByRole('alert')).textContent).toContain('You are not assigned to APG Main.');
  });

  it('keeps a post on this PC when the web app is busy, rather than losing it (never lose a log)', async () => {
    const platform = fakeServer({ logPost: { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' } });
    renderApp({ platform, path: PATH });
    await userEvent.type(await linkField(), LINK);
    await userEvent.click(posted());
    expect(await screen.findByText(`Kept on this PC: ${CLEAN.name}. It's saved when the connection is back.`)).toBeTruthy();
  });

  it('Alt+L puts you in the post link field', async () => {
    renderApp({ platform: fakeServer(), path: PATH });
    const link = await linkField();
    await userEvent.keyboard('{Alt>}l{/Alt}');
    expect(document.activeElement).toBe(link);
  });

  it('the old log address opens the listing, with the log step on it', async () => {
    renderApp({ platform: fakeServer(), path: `${PATH}/log`, state: { section: 'queue' } });
    expect(await screen.findByRole('heading', { level: 1, name: CLEAN.name })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Log the post' })).toBeTruthy();
    expect(document.querySelector('.back-link')?.textContent).toBe('My queue');
  });
});

describe('one gold button', () => {
  it('is Copy until the text is copied, then Posted', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: PATH });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' }).hasAttribute('disabled')).toBe(false));
    const gold = () => Array.from(document.querySelectorAll('.button--primary')).map((b) => b.textContent);
    expect(gold()).toEqual(['Copy']);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(gold()).toEqual(['Posted']));
  });
});
