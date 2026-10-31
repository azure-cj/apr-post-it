// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createFakePlatform, type FakePlatformOptions } from '@/platform/fake';
import { AppShell, routerFuture } from './App';
import { AppStateProvider, useApp } from './state';
import { admin, EXEC, fakeServer, intern, manager, NOW, PROPERTIES, renderApp } from './state/testing';

const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
const navNames = () =>
  screen
    .queryAllByRole('link')
    .filter((a) => a.closest('nav'))
    .map((a) => a.firstChild?.textContent);

const KEPT = { 'postit.settings': JSON.stringify({ scriptUrl: EXEC }) };
const PING_INTERN = { ok: true, name: intern.name, role: 'Intern', fbAccounts: intern.fbAccounts };

/** The window as it opens: from whatever the platform kept, with no one signed in by the test. */
function launch(options: FakePlatformOptions, path = '/') {
  const platform = createFakePlatform({
    hasFileSystem: true,
    ...options,
    replies: { properties: PROPERTIES, posts: { ok: true, posts: [] }, assignments: { ok: true, assignments: [] }, ...options.replies },
  });
  let app: ReturnType<typeof useApp> | null = null;
  function Spy() {
    app = useApp();
    return null;
  }
  render(
    <AppStateProvider platform={platform} now={() => NOW}>
      <Spy />
      <MemoryRouter initialEntries={[path]} future={routerFuture}>
        <AppShell />
      </MemoryRouter>
    </AppStateProvider>,
  );
  return { platform, app: () => app! };
}

async function signIn(key = 'key-1') {
  await userEvent.type(await screen.findByLabelText('Web app link'), EXEC);
  await userEvent.type(screen.getByLabelText('Your key'), key);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in', () => {
  it('sends anyone signed out to sign in, whatever they asked for', async () => {
    launch({}, '/tracker');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(navNames()).toEqual([]);
  });

  it('signs an intern in to their queue, and keeps the key and the link for next time', async () => {
    const { platform } = launch({ replies: { ping: PING_INTERN } });
    await signIn('9b2c-41fe');

    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(navNames()).toEqual(['My queue', 'Find']);
    expect(screen.getByText('Jan Dela Cruz')).toBeTruthy();
    expect(platform.posts[0]!.body).toMatchObject({ action: 'ping', key: '9b2c-41fe' });
    expect(await platform.readKey()).toBe('9b2c-41fe');
    expect(JSON.parse((await platform.readLocal('postit.settings'))!)).toMatchObject({ scriptUrl: EXEC });
  });

  it("keeps nothing, and shows the server's sentence, when the key is refused", async () => {
    const { platform } = launch({
      replies: { ping: { ok: false, error: 'unauthorized', message: "That key isn't on the team. Ask your manager for yours." } },
    });
    await signIn();
    expect((await screen.findByRole('alert')).textContent).toContain("That key isn't on the team.");
    expect(heading()).toBe('Sign in');
    expect(await platform.readKey()).toBeNull();
  });

  it('signs in again on launch with the key the PC kept, saying what it is waiting for', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    launch({ key: 'kept-key', local: KEPT, replies: { ping: () => new Promise((resolve) => (answer = resolve)) } }, '/find');

    expect(await screen.findByText('Checking your key with the web app…', { selector: '.opening__text' })).toBeTruthy();
    answer(PING_INTERN);
    // Where it was asked for, not the home screen.
    expect(await screen.findByRole('heading', { level: 1, name: 'Find a property' })).toBeTruthy();
  });

  it('offers to try again, with nothing typed, when the kept key cannot be checked', async () => {
    let calls = 0;
    launch({
      key: 'kept-key',
      local: KEPT,
      replies: {
        ping: () => {
          calls++;
          if (calls === 1) throw new TypeError('Failed to fetch');
          return PING_INTERN;
        },
      },
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach Google. Check your connection and try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
  });
});

describe('signing out', () => {
  it('asks first, and staying signed in changes nothing', async () => {
    const { platform } = launch({ key: 'kept-key', local: KEPT, replies: { ping: PING_INTERN } });
    await screen.findByRole('heading', { level: 1, name: 'My queue' });

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign out of Post-It?' });
    expect(dialog.textContent).toContain("Post-It will forget your key on this computer. To sign in again you'll need the key your manager gave you.");
    // Focus starts on the safe choice.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Stay signed in' }));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay signed in' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(heading()).toBe('My queue');
    expect(await platform.readKey()).toBe('kept-key');

    // Escape is staying, too.
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await platform.readKey()).toBe('kept-key');
  });

  it('clears the key and the property list once confirmed', async () => {
    const { platform, app } = launch({ key: 'kept-key', local: KEPT, replies: { ping: PING_INTERN } });
    await screen.findByRole('heading', { level: 1, name: 'My queue' });
    await waitFor(() => expect(app().directory.peek()).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(await platform.readKey()).toBeNull();
    expect(app().directory.peek()).toBeNull();
    expect(app().user).toBeNull();
    expect(navNames()).toEqual([]);
    // The link stays, so signing back in needs only the key.
    expect((screen.getByLabelText('Web app link') as HTMLInputElement).value).toBe(EXEC);
  });

  it('stays signed in, and says why, when the key cannot be removed', async () => {
    launch({ key: 'kept-key', local: KEPT, replies: { ping: PING_INTERN }, failures: { writeKey: 'Could not remove your key: the store is locked.' } });
    await screen.findByRole('heading', { level: 1, name: 'My queue' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not remove your key: the store is locked.');
    expect(screen.getByText('Jan Dela Cruz')).toBeTruthy();
  });
});

describe('the shell', () => {
  it('gives a manager the tracker and an admin Settings too', () => {
    const { unmount } = renderApp({ platform: fakeServer(), user: manager });
    expect(heading()).toBe('Tracker');
    expect(navNames()).toEqual(['Tracker', 'Assign', 'Find']);
    unmount();

    renderApp({ platform: fakeServer(), user: admin });
    expect(navNames()).toEqual(['Tracker', 'Assign', 'Find', 'Settings']);
  });

  it('keeps an intern out of the manager screens, and a manager out of Settings', async () => {
    const { unmount } = renderApp({ platform: fakeServer(), user: intern, path: '/assign' });
    expect(heading()).toBe('My queue');
    unmount();
    renderApp({ platform: fakeServer(), user: manager, path: '/settings' });
    expect(heading()).toBe('Tracker');
  });

  it('moves between screens from the nav, names the window, and starts at the heading', async () => {
    renderApp({ platform: fakeServer(), path: '/queue' });
    await screen.findByText('Nothing in your queue today');
    await userEvent.click(screen.getByRole('link', { name: 'Find' }));
    expect(heading()).toBe('Find a property');
    expect(document.title).toBe('Find a property · APG Post-It');
    expect(screen.getByRole('link', { name: 'Find' }).getAttribute('aria-current')).toBe('page');
  });

  it('marks Find in the nav for a listing opened from anywhere but the queue, and names the window after it', async () => {
    renderApp({ platform: fakeServer(), path: '/property/1VerdantHillsLot12' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Find' }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(document.title).toBe('Verdant Hills Lot 12, Tagaytay · APG Post-It'));
  });

  it('offers a way past the top bar', () => {
    renderApp({ platform: fakeServer(), path: '/queue' });
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
  });
});
