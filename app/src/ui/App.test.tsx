// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UserFacingError, type User } from '@/core/types';
import { AppShell, routerFuture, type AppProps } from './App';

const intern: User = { name: 'Jan Dela Cruz', role: 'Intern', fbAccounts: ['APG Main'] };
const manager: User = { name: 'Maria Santos', role: 'Manager', fbAccounts: [] };
const admin: User = { name: 'Ana Reyes', role: 'Admin', fbAccounts: [] };

function renderAt(path: string, props: AppProps = {}) {
  return render(
    <MemoryRouter initialEntries={[path]} future={routerFuture}>
      <AppShell {...props} />
    </MemoryRouter>,
  );
}

const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
const navNames = () =>
  screen
    .queryAllByRole('link')
    .filter((a) => a.closest('nav'))
    .map((a) => a.textContent);

async function signIn() {
  await userEvent.type(screen.getByLabelText('Web app link'), 'https://script.google.com/macros/s/x/exec');
  await userEvent.type(screen.getByLabelText('Your key'), 'key-1');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('App shell', () => {
  it('sends anyone signed out to sign in, whatever they asked for', () => {
    renderAt('/tracker');
    expect(heading()).toBe('Sign in');
    expect(navNames()).toEqual([]);
  });

  it('says plainly when sign-in is not wired up yet', async () => {
    renderAt('/sign-in');
    await signIn();
    expect(screen.getByRole('alert').textContent).toContain("isn't connected");
  });

  it('signs an intern in to their queue, with their nav', async () => {
    const signInFn = vi.fn().mockResolvedValue(intern);
    renderAt('/sign-in', { signIn: signInFn });
    await signIn();
    expect(signInFn).toHaveBeenCalledWith('https://script.google.com/macros/s/x/exec', 'key-1');
    expect(heading()).toBe('My queue');
    expect(navNames()).toEqual(['My queue', 'Find']);
    expect(screen.getByRole('link', { name: 'My queue' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Jan Dela Cruz')).toBeTruthy();
  });

  it('signs a manager in to the tracker; only an admin gets Settings', () => {
    const { unmount } = renderAt('/', { initialUser: manager });
    expect(heading()).toBe('Tracker');
    expect(navNames()).toEqual(['Tracker', 'Assign', 'Find']);
    unmount();

    renderAt('/', { initialUser: admin });
    expect(navNames()).toEqual(['Tracker', 'Assign', 'Find', 'Settings']);
  });

  it('shows the server’s refusal as it is said', async () => {
    renderAt('/sign-in', {
      signIn: vi.fn().mockRejectedValue(new UserFacingError("That key isn't on the team. Ask your manager for yours.")),
    });
    await signIn();
    expect(screen.getByRole('alert').textContent).toContain("That key isn't on the team.");
    expect(heading()).toBe('Sign in');
  });

  it('calls anything else a connection problem', async () => {
    renderAt('/sign-in', { signIn: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    await signIn();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't reach the web app");
  });

  it('keeps an intern out of the manager screens', () => {
    renderAt('/assign', { initialUser: intern });
    expect(heading()).toBe('My queue');
    expect(screen.queryByText('Assign')).toBeNull();
  });

  it('keeps a manager who is not an admin out of Settings', () => {
    renderAt('/settings', { initialUser: manager });
    expect(heading()).toBe('Tracker');
  });

  it('moves between screens from the nav, names the window, and starts at the heading', async () => {
    renderAt('/queue', { initialUser: intern });
    await userEvent.click(screen.getByRole('link', { name: 'Find' }));
    expect(heading()).toBe('Find a property');
    expect(document.title).toBe('Find a property · APG Post-It');
    expect(screen.getByRole('link', { name: 'Find' }).getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('opens a property and its log page as placeholders', () => {
    const { unmount } = renderAt('/property/abc123', { initialUser: intern });
    expect(heading()).toBe('Property');
    expect(screen.getByRole('link', { name: 'Find' }).getAttribute('aria-current')).toBe('page');
    unmount();
    renderAt('/property/abc123/log', { initialUser: intern });
    expect(heading()).toBe('Log a post');
  });

  it('signs out back to the sign-in screen', async () => {
    const onSignOut = vi.fn();
    renderAt('/queue', { initialUser: intern, onSignOut });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
    expect(heading()).toBe('Sign in');
    expect(navNames()).toEqual([]);
  });

  it('offers a way past the top bar', () => {
    renderAt('/queue', { initialUser: intern });
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
  });
});
