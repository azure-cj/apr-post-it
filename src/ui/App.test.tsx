// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
      replies: { ping: { ok: false, error: 'unauthorized', message: "That key isn't on the team. Ask your admin for yours." } },
    });
    await signIn();
    expect((await screen.findByRole('alert')).textContent).toContain("That key isn't on the team.");
    expect(heading()).toBe('Sign in');
    expect(await platform.readKey()).toBeNull();
  });

  it('Cancel stops a sign-in that is running: a late reply signs nobody in and keeps no key', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    const { platform, app } = launch({ replies: { ping: () => new Promise((resolve) => (answer = resolve)) } });
    await signIn('9b2c-41fe');
    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect((screen.getByLabelText('Web app link') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Your key') as HTMLInputElement).value).toBe('');

    answer(PING_INTERN);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heading()).toBe('Sign in');
    expect(app().user).toBeNull();
    expect(await platform.readKey()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  });

  it('Cancel clears the error a failed sign-in left, and a late failure says nothing', async () => {
    let calls = 0;
    let fail: (err: Error) => void = () => undefined;
    launch({
      replies: {
        ping: () => {
          calls++;
          if (calls === 1) return { ok: false, error: 'unauthorized', message: "That key isn't on the team. Ask your admin for yours." };
          return new Promise((_resolve, reject) => (fail = reject));
        },
      },
    });
    await signIn();
    expect((await screen.findByRole('alert')).textContent).toContain("That key isn't on the team.");
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();

    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    fail(new TypeError('Failed to fetch'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('aria-busy')).toBeNull();
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
    expect(dialog.textContent).toContain("Post-It will forget your key on this computer. To sign in again you'll need the key your admin gave you.");
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
  it('gives every admin the tracker, Assign and Settings (D14)', () => {
    // Maria's Team row once said Manager; that is Admin now, with everything an admin has.
    for (const user of [manager, admin]) {
      const { unmount } = renderApp({ platform: fakeServer(), user });
      expect(heading()).toBe('Tracker');
      expect(navNames()).toEqual(['Tracker', 'Assign', 'Interns', 'Records', 'Find', 'Settings']);
      unmount();
    }
  });

  it("keeps an intern out of the admin's screens, and lets an admin into Settings", async () => {
    for (const path of ['/assign', '/tracker', '/interns', '/settings']) {
      const { unmount } = renderApp({ platform: fakeServer(), user: intern, path });
      expect(heading()).toBe('My queue');
      unmount();
    }
    renderApp({ platform: fakeServer(), user: manager, path: '/settings' });
    expect(heading()).toBe('Settings');
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

describe("the manager's screens", () => {
  const QUEUED = {
    ok: true,
    assignments: [
      { date: '2026-11-01', assignedTo: intern.name, property: 'BGC Uptown Office 18F, 240 sqm', status: 'To post', propertyId: '1BgcUptown' },
    ],
  };

  it('are all reachable by an admin, from the nav', async () => {
    renderApp({ platform: fakeServer({ assignments: QUEUED }), user: admin, path: '/tracker' });
    expect(heading()).toBe('Tracker');
    await userEvent.click(screen.getByRole('link', { name: 'Assign' }));
    expect(heading()).toBe('Assign');
    await userEvent.click(screen.getByRole('link', { name: 'Interns' }));
    expect(heading()).toBe('Interns');
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(heading()).toBe('Settings');
    // The team the web app sent, in Settings' table.
    expect(await screen.findByRole('cell', { name: intern.name })).toBeTruthy();
  });

  it.each(['/tracker', '/assign', '/interns', '/settings'])('send an intern who asks for %s back to their queue', (path) => {
    renderApp({ platform: fakeServer(), user: intern, path });
    expect(heading()).toBe('My queue');
  });

  it("save a queue through the tracker, as the intern's on the day shown", async () => {
    const platform = fakeServer({ assignments: QUEUED, saveQueue: { ok: true, saved: 2 } });
    renderApp({ platform, user: manager, path: `/assign?intern=${encodeURIComponent(intern.name)}` });
    // Opens on tomorrow, on the intern in the link.
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search listings' }), 'Kapitolyo');
    await userEvent.click(await screen.findByRole('button', { name: /^Add Kapitolyo/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Save queue/ }));

    await waitFor(() => expect(platform.posts.map((p) => p.action)).toContain('saveQueue'));
    const save = platform.posts.find((p) => p.action === 'saveQueue')!.body as Record<string, unknown>;
    expect(save['date']).toBe('2026-11-01');
    expect(save['assignedTo']).toBe(intern.name);
    expect(JSON.stringify(save['items'])).toContain('Kapitolyo Ground Floor Retail, Pasig');
  });

  it('ask before leaving Assign with unsaved changes, and staying keeps them', async () => {
    renderApp({ platform: fakeServer({ assignments: QUEUED }), user: manager, path: `/assign?intern=${encodeURIComponent(intern.name)}` });
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search listings' }), 'Kapitolyo');
    await userEvent.click(await screen.findByRole('button', { name: /^Add Kapitolyo/ }));

    await userEvent.click(screen.getByRole('link', { name: 'Tracker' }));
    const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(heading()).toBe(intern.name);
    expect(screen.getByRole('button', { name: /^Save queue/ })).toBeTruthy();

    // The brand link asks too; leaving drops the changes.
    await userEvent.click(screen.getByRole('link', { name: /APG Post-It/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave without saving' }));
    expect(heading()).toBe('Tracker');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Nothing unsaved any more: moving on asks nothing.
    await userEvent.click(screen.getByRole('link', { name: 'Find' }));
    expect(heading()).toBe('Find a property');
  });

});

describe("the window's own controls", () => {
  const windowed = (replies = {}) => fakeServer(replies, 'test-key', { hasWindowControls: true });
  const controls = () => screen.queryByRole('group', { name: 'Window' });

  it('are not drawn in a browser, where there is no window to control', () => {
    renderApp({ platform: fakeServer(), user: null });
    expect(controls()).toBeNull();
    expect(document.querySelector('[data-tauri-drag-region]')).toBeNull();
  });

  it('are drawn on the sign-in screen too, and the bar is what the window is dragged by', async () => {
    const platform = windowed();
    launchWith(platform);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    const group = controls()!;
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Minimize', 'Maximize', 'Close']);
    expect(document.querySelector('header')!.hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('minimize, and maximize then restore, following the window however it changed', async () => {
    const platform = windowed();
    renderApp({ platform, user: manager });
    await userEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(platform.window.minimized).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(platform.window.maximized).toBe(true);
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeTruthy();

    // Win+Down, a snap, or a double-click on the bar.
    act(() => platform.setMaximizedFromOutside(false));
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy();
  });

  it('close asks first, starting on Cancel, and Cancel keeps the window open', async () => {
    const platform = windowed();
    renderApp({ platform, user: manager });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    const dialog = screen.getByRole('dialog', { name: 'Close APG Post-It?' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(platform.window.destroyed).toBe(false);
  });

  it('closes once confirmed', async () => {
    const platform = windowed();
    renderApp({ platform, user: manager });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(platform.window.destroyed).toBe(true));
  });

  it('asks the same question for Alt+F4 and the taskbar, and Escape stays', async () => {
    const platform = windowed();
    renderApp({ platform, user: intern, path: '/queue' });
    await screen.findByText('Nothing in your queue today');

    act(() => platform.closeFromOutside());
    expect(screen.getByRole('dialog', { name: 'Close APG Post-It?' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(platform.window.destroyed).toBe(false);

    act(() => platform.closeFromOutside());
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(platform.window.destroyed).toBe(true));
  });

  it('with unsaved changes on Assign, asks once, saying they will be lost', async () => {
    const platform = windowed({
      assignments: {
        ok: true,
        assignments: [
          { date: '2026-11-01', assignedTo: intern.name, property: 'BGC Uptown Office 18F, 240 sqm', status: 'To post', propertyId: '1BgcUptown' },
        ],
      },
    });
    renderApp({ platform, user: manager, path: `/assign?intern=${encodeURIComponent(intern.name)}` });
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search listings' }), 'Kapitolyo');
    await userEvent.click(await screen.findByRole('button', { name: /^Add Kapitolyo/ }));

    act(() => platform.closeFromOutside());
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]!.getAttribute('aria-labelledby')).toBeTruthy();
    expect(within(dialogs[0]!).getByRole('heading').textContent).toBe('Close APG Post-It?');
    expect(dialogs[0]!.textContent).toMatch(/changes that aren't saved\. Closing now loses them/);

    // Even when the leave question was already open, there is one question.
    await userEvent.click(within(dialogs[0]!).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('link', { name: 'Tracker' }));
    expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeTruthy();
    act(() => platform.closeFromOutside());
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Close APG Post-It?' }).textContent).toMatch(/changes that aren't saved/);

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(platform.window.destroyed).toBe(true));
  });
});

/** The window as it opens on a given platform, nobody signed in. */
function launchWith(platform: ReturnType<typeof fakeServer>) {
  render(
    <AppStateProvider platform={platform} now={() => NOW}>
      <MemoryRouter initialEntries={['/']} future={routerFuture}>
        <AppShell />
      </MemoryRouter>
    </AppStateProvider>,
  );
}
