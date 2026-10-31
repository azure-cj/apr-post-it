// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createFakePlatform, type FakePlatformOptions } from '@/platform/fake';
import { AppShell, routerFuture } from './App';
import { AppStateProvider } from './state';
import { parseSettings } from './state/settings';
import { admin, EXEC, fakeServer, intern, NOW, PROPERTIES, renderApp } from './state/testing';

/** The link built into this version: the test sets it, as src/config.ts would. */
const config = vi.hoisted(() => ({ url: '' }));
vi.mock('@/config', () => ({
  get BUILT_IN_SCRIPT_URL() {
    return config.url;
  },
}));

const BUILT_IN = 'https://script.google.com/macros/s/BUILT-IN/exec';
const OLD = 'https://script.google.com/macros/s/OLD-DEPLOYMENT/exec';
const PING_INTERN = { ok: true, name: intern.name, role: 'Intern', fbAccounts: intern.fbAccounts };

function launch(options: FakePlatformOptions) {
  const platform = createFakePlatform({
    hasFileSystem: true,
    ...options,
    replies: { properties: PROPERTIES, posts: { ok: true, posts: [] }, assignments: { ok: true, assignments: [] }, ...options.replies },
  });
  render(
    <AppStateProvider platform={platform} now={() => NOW}>
      <MemoryRouter initialEntries={['/']} future={routerFuture}>
        <AppShell />
      </MemoryRouter>
    </AppStateProvider>,
  );
  return platform;
}

describe('with a link built into this version', () => {
  beforeEach(() => {
    config.url = BUILT_IN;
  });
  afterEach(() => {
    config.url = '';
  });

  it('asks only for the key, and signs in through the built-in link', async () => {
    const platform = launch({ replies: { ping: PING_INTERN } });
    const key = await screen.findByLabelText('Your key');
    expect(screen.queryByLabelText('Web app link')).toBeNull();
    expect(screen.getByText('Paste your own key. Your admin sends it to you.')).toBeTruthy();
    expect(document.activeElement).toBe(key);

    await userEvent.type(key, '9b2c-41fe');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(platform.posts[0]).toMatchObject({ url: BUILT_IN, action: 'ping' });
    expect(platform.posts[0]!.body).toMatchObject({ key: '9b2c-41fe' });
    expect(await platform.readKey()).toBe('9b2c-41fe');
  });

  it('keeps Cancel: it clears the key and goes back to it', async () => {
    launch({});
    const key = await screen.findByLabelText('Your key');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.hasAttribute('disabled')).toBe(true);
    await userEvent.type(key, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((key as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(key);
  });

  it('says only the key is missing', async () => {
    launch({});
    await screen.findByLabelText('Your key');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Paste your key.')).toBeTruthy();
    expect(screen.queryByText('Paste the web app link.')).toBeNull();
  });

  it('ignores a link an older install kept, on launch and in what it keeps', async () => {
    const platform = launch({
      key: 'kept-key',
      local: { 'postit.settings': JSON.stringify({ scriptUrl: OLD, cooldownDays: 9 }) },
      replies: { ping: PING_INTERN },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(platform.posts.map((p) => p.url)).not.toContain(OLD);
    expect(platform.posts[0]).toMatchObject({ url: BUILT_IN, action: 'ping' });

    expect(parseSettings(JSON.stringify({ scriptUrl: OLD, cooldownDays: 9 }))).toMatchObject({ scriptUrl: BUILT_IN, cooldownDays: 9 });
    expect(parseSettings(null).scriptUrl).toBe(BUILT_IN);
  });

  it('shows the link read-only in Settings, marked as built in, with Copy', async () => {
    const platform = fakeServer();
    renderApp({ platform, user: admin, path: '/settings' });
    const link = screen.getByLabelText('Web app link') as HTMLInputElement;
    // The test signs in with another link; the built-in one wins.
    expect(link.value).toBe(BUILT_IN);
    expect(link.readOnly).toBe(true);
    expect(screen.getAllByText(/Built into this version of the app/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Copy the web app link' }));
    await waitFor(() => expect(platform.copied).toEqual([BUILT_IN]));
  });
});

describe('with no link built in', () => {
  it('asks for the link and the key, as before', async () => {
    const platform = launch({ replies: { ping: PING_INTERN } });
    await userEvent.type(await screen.findByLabelText('Web app link'), EXEC);
    await userEvent.type(screen.getByLabelText('Your key'), 'key-1');
    expect(screen.getByText('Paste the web app link and your own key. Your admin sends you both.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(platform.posts[0]).toMatchObject({ url: EXEC, action: 'ping' });
  });

  it('keeps a saved link, and Settings does not call it built in', () => {
    expect(parseSettings(JSON.stringify({ scriptUrl: OLD })).scriptUrl).toBe(OLD);
    renderApp({ platform: fakeServer(), user: admin, path: '/settings' });
    expect((screen.getByLabelText('Web app link') as HTMLInputElement).value).toBe(EXEC);
    expect(screen.queryByText(/Built into this version of the app/)).toBeNull();
  });
});
