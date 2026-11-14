// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NO_ROLE } from '@/core/account';
import { createFakePlatform, type FakePlatform } from '@/platform/fake';
import type { FirebaseAccess, FirebaseAccount, FirebaseRole } from '@/platform/firebase';
import { AccountSignInScreen, RESET_SENT } from './screens/AccountSignIn';
import { AppStateProvider, LAST_EMAIL_KEY, useApp } from './state/AppState';
import { defaultAppSettings, serializeSettings, SETTINGS_KEY } from './state/settings';
import { EXEC, PROPERTIES, TEAM, renderApp } from './state/testing';

// Signing in with a Firebase account, the same as Alpha Listing Hub's (POST-IT-PLAN.md section 5). No key: every call
// to the web app carries the account's sign-in token, and the account says who you are and your role (v11).

interface Person {
  readonly uid: string;
  readonly password: string;
  readonly role: FirebaseRole | null;
}

const PEOPLE: Record<string, Person> = {
  'cj@aureo.com': { uid: 'uid-cj', password: 'right-password', role: 'agent' },
  'maria@apg.test': { uid: 'uid-maria', password: 'right-password', role: 'admin' },
  'scanner@apg.test': { uid: 'uid-scanner', password: 'right-password', role: 'scanner' },
};

/** Firebase as the app sees it, with the people above, and `signedIn` already signed in. */
function fakeFirebase(
  signedIn: string | null = null,
): FirebaseAccess & { readonly current: () => string | null; readonly resets: string[] } {
  let current = signedIn;
  const resets: string[] = [];
  const listeners = new Set<(a: FirebaseAccount | null) => void>();
  const account = (): FirebaseAccount | null => (current ? { uid: PEOPLE[current]!.uid, email: current, name: current } : null);
  const tell = () => listeners.forEach((l) => l(account()));
  return {
    target: 'emulator',
    current: () => current,
    resets,
    async resetPassword(email) {
      if (!email.includes('@')) throw Object.assign(new Error('bad'), { code: 'auth/invalid-email' });
      if (email === 'offline@apg.test') throw Object.assign(new Error('bad'), { code: 'auth/network-request-failed' });
      if (!PEOPLE[email]) throw Object.assign(new Error('bad'), { code: 'auth/user-not-found' });
      resets.push(email);
    },
    watch(changed) {
      listeners.add(changed);
      queueMicrotask(() => changed(account()));
      return () => listeners.delete(changed);
    },
    async role() {
      return current ? PEOPLE[current]!.role : null;
    },
    async signIn(email, password) {
      if (PEOPLE[email]?.password !== password) throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
      current = email;
      tell();
    },
    async signOut() {
      current = null;
      tell();
    },
    async changePassword() {},
    async token() {
      return current ? { uid: PEOPLE[current]!.uid, token: `token-for-${current}` } : null;
    },
    async call() {
      throw new Error('not used');
    },
  };
}

const PING_CJ = { ok: true, name: 'CJ Aureo', role: 'Intern', fbAccounts: ['Cyrus', 'Kevs'] };

function platformWith(firebase: FirebaseAccess, ping: unknown = PING_CJ, kept: Record<string, string> = {}): FakePlatform {
  return createFakePlatform({
    key: 'an-old-key',
    // The web app link this PC kept: the tests build none in, the app does.
    local: { [SETTINGS_KEY]: serializeSettings({ ...defaultAppSettings, scriptUrl: EXEC }), ...kept },
    firebase,
    replies: {
      ping: ping as Record<string, unknown>,
      properties: PROPERTIES,
      posts: { ok: true, posts: [] },
      assignments: { ok: true, assignments: [] },
      team: TEAM,
    },
  });
}

const bodies = (platform: FakePlatform) => platform.posts.map((p) => p.body as Record<string, unknown>);

async function signInWith(email: string, password: string) {
  await userEvent.type(await screen.findByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in with an account', () => {
  it('asks for email and password only: no role, no key', async () => {
    renderApp({ platform: platformWith(fakeFirebase()), user: null });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.queryByText('Sign in as')).toBeNull();
    expect(screen.queryByLabelText('Your key')).toBeNull();
  });

  it('says so when the password is wrong', async () => {
    renderApp({ platform: platformWith(fakeFirebase()), user: null });
    await signInWith('cj@aureo.com', 'nope');
    expect(await screen.findByText('Wrong email or password.')).toBeTruthy();
  });

  it("signs in as the Team tab's person, sending the account's token and never a key", async () => {
    const platform = platformWith(fakeFirebase());
    renderApp({ platform, user: null });
    await signInWith('cj@aureo.com', 'right-password');

    expect(await screen.findByText('CJ Aureo')).toBeTruthy();
    const sent = bodies(platform);
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent) {
      expect(body['idToken']).toBe('token-for-cj@aureo.com');
      expect(body).not.toHaveProperty('key');
    }
  });

  it('goes straight in on launch when the account is still signed in', async () => {
    renderApp({ platform: platformWith(fakeFirebase('cj@aureo.com')), user: null });
    expect(await screen.findByText('CJ Aureo')).toBeTruthy();
  });

  it('signs out with the web app\'s sentence when it turns the sign-in away', async () => {
    const firebase = fakeFirebase();
    const message = 'Your sign-in has ended. Sign in again.';
    renderApp({ platform: platformWith(firebase, { ok: false, error: 'unauthorized', message }), user: null });
    await signInWith('cj@aureo.com', 'right-password');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(firebase.current()).toBeNull();
  });

  it("signs out when the role was changed since the sign-in was kept", async () => {
    const firebase = fakeFirebase();
    renderApp({ platform: platformWith(firebase, { ...PING_CJ, role: 'Admin' }), user: null });
    await signInWith('cj@aureo.com', 'right-password');
    expect(await screen.findByText('Your role was changed. Sign in again.')).toBeTruthy();
    expect(firebase.current()).toBeNull();
  });

  it('turns away an account Post-It has no role for, and signs it out', async () => {
    const firebase = fakeFirebase();
    const platform = platformWith(firebase);
    renderApp({ platform, user: null });
    await signInWith('scanner@apg.test', 'right-password');
    expect(await screen.findByText(NO_ROLE)).toBeTruthy();
    expect(firebase.current()).toBeNull();
    expect(platform.posts).toHaveLength(0);
  });

  it('signs out to email and password, and signs in again', async () => {
    const firebase = fakeFirebase('cj@aureo.com');
    renderApp({ platform: platformWith(firebase), user: null });
    await userEvent.click(await screen.findByRole('button', { name: /Sign out/ }));
    const dialog = screen.getByRole('dialog', { name: 'Sign out of Post-It?' });
    expect(within(dialog).getByText("You'll need your email and password to sign in again.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(firebase.current()).toBeNull();
    await signInWith('cj@aureo.com', 'right-password');
    await waitFor(() => expect(screen.getByText('CJ Aureo')).toBeTruthy());
  });
});

describe('the sign-in screen', () => {
  it('says why to sign in, under the title', () => {
    render(<AccountSignInScreen onSubmit={() => {}} busy={false} />);
    expect(screen.getByText('Use your Alpha Listing Hub account. Your queue, listings and posts are waiting.')).toBeTruthy();
  });

  it('starts empty, on the email, when no email was kept', () => {
    render(<AccountSignInScreen onSubmit={() => {}} busy={false} initialEmail={null} />);
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    expect(email.value).toBe('');
    expect(document.activeElement).toBe(email);
    expect(screen.queryByRole('button', { name: 'Use another email' })).toBeNull();
  });

  it('fills in the kept email and goes straight to the password', async () => {
    const onSubmit = vi.fn();
    render(<AccountSignInScreen onSubmit={onSubmit} busy={false} initialEmail="cj@aureo.com" />);
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('cj@aureo.com');
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));

    await userEvent.keyboard('right-password{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('cj@aureo.com', 'right-password');
  });

  it('"Use another email" empties the email and puts you in it', async () => {
    render(<AccountSignInScreen onSubmit={() => {}} busy={false} initialEmail="cj@aureo.com" />);
    expect(screen.getByText(/Not you\?/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use another email' }));
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    expect(email.value).toBe('');
    expect(document.activeElement).toBe(email);
    expect(screen.queryByRole('button', { name: 'Use another email' })).toBeNull();
  });

  it('has no "Forgot password?" without a way to send the link', () => {
    render(<AccountSignInScreen onSubmit={() => {}} busy={false} />);
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).toBeNull();
  });

  it('asks for the email first before sending a reset link', async () => {
    const onForgotPassword = vi.fn(async () => {});
    render(<AccountSignInScreen onSubmit={() => {}} busy={false} onForgotPassword={onForgotPassword} />);
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText('Type your email first.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
    expect(onForgotPassword).not.toHaveBeenCalled();
  });

  it('sends one reset link to the typed email and says to check the inbox', async () => {
    let send: () => void = () => {};
    const onForgotPassword = vi.fn(() => new Promise<void>((resolve) => (send = resolve)));
    render(<AccountSignInScreen onSubmit={() => {}} busy={false} onForgotPassword={onForgotPassword} />);
    await userEvent.type(screen.getByLabelText('Email'), ' cj@aureo.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    // A second click while it sends does nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Sending link…' }));
    expect(onForgotPassword).toHaveBeenCalledTimes(1);
    expect(onForgotPassword).toHaveBeenCalledWith('cj@aureo.com');

    send();
    expect(await screen.findByText(RESET_SENT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeTruthy();
  });

  it("says why when the link couldn't be sent", async () => {
    const onForgotPassword = vi.fn(async () => {
      throw new Error("That email doesn't look right.");
    });
    render(<AccountSignInScreen onSubmit={() => {}} busy={false} onForgotPassword={onForgotPassword} />);
    await userEvent.type(screen.getByLabelText('Email'), 'cj');
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(await screen.findByText("That email doesn't look right.")).toBeTruthy();
    expect(screen.queryByText(RESET_SENT)).toBeNull();
  });
});

describe('the email kept on this PC, and reset links', () => {
  const appWith = (platform: FakePlatform) =>
    renderHook(() => useApp(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AppStateProvider platform={platform} now={() => 0}>
          {children}
        </AppStateProvider>
      ),
    });

  it('keeps the email once a sign-in works, and not after a wrong password', async () => {
    const platform = platformWith(fakeFirebase());
    renderApp({ platform, user: null });
    await signInWith('cj@aureo.com', 'nope');
    expect(await screen.findByText('Wrong email or password.')).toBeTruthy();
    expect(await platform.readLocal(LAST_EMAIL_KEY)).toBeNull();

    const password = screen.getByLabelText('Password');
    await userEvent.clear(password);
    await userEvent.type(password, 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('CJ Aureo')).toBeTruthy();
    expect(await platform.readLocal(LAST_EMAIL_KEY)).toBe('cj@aureo.com');
  });

  it('reads the kept email on launch, and keeps it on sign-out', async () => {
    const { result } = appWith(platformWith(fakeFirebase('cj@aureo.com'), PING_CJ, { [LAST_EMAIL_KEY]: 'cj@aureo.com' }));
    await waitFor(() => expect(result.current.session.status).toBe('signed-in'));
    expect(result.current.lastEmail).toBe('cj@aureo.com');
    await act(() => result.current.signOut());
    await waitFor(() => expect(result.current.session.status).toBe('account'));
    expect(result.current.lastEmail).toBe('cj@aureo.com');
  });

  it('sends a reset link, and says the same when the email has no account', async () => {
    const firebase = fakeFirebase();
    const { result } = appWith(platformWith(firebase));
    await waitFor(() => expect(result.current.usesAccounts).toBe(true));

    await expect(result.current.resetPassword(' cj@aureo.com ')).resolves.toBeUndefined();
    expect(firebase.resets).toEqual(['cj@aureo.com']);
    await expect(result.current.resetPassword('nobody@apg.test')).resolves.toBeUndefined();
    expect(firebase.resets).toEqual(['cj@aureo.com']);
  });

  it('says why a reset link was not sent', async () => {
    const { result } = appWith(platformWith(fakeFirebase()));
    await waitFor(() => expect(result.current.usesAccounts).toBe(true));
    await expect(result.current.resetPassword('cj')).rejects.toThrow("That email doesn't look right.");
    await expect(result.current.resetPassword('offline@apg.test')).rejects.toThrow(
      "Couldn't reach the sign-in server. Check your connection, then try again.",
    );
  });
});
