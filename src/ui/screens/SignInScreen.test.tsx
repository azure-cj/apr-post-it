// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakePlatform } from '@/platform/fake';
import { renderApp } from '../state/testing';
import { SignInScreen } from './SignInScreen';
import { SIGN_IN_ROLE_KEY } from './SignInScreen.role';

const description = (input: HTMLElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('SignInScreen', () => {
  it('starts in the link field', () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Web app link'));
  });

  it('starts in the key field when the link is already known', () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} initialUrl="https://script.google.com/macros/s/x/exec" />);
    expect((screen.getByLabelText('Web app link') as HTMLInputElement).value).toBe('https://script.google.com/macros/s/x/exec');
    expect(document.activeElement).toBe(screen.getByLabelText('Your key'));
  });

  it('says the key is your identity and not to share it', () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} />);
    const said = description(screen.getByLabelText('Your key'));
    expect(said).toMatch(/identity/);
    expect(said).toMatch(/Don't share it/);
  });

  it('sends the trimmed link and key', async () => {
    const onSubmit = vi.fn();
    render(<SignInScreen onSubmit={onSubmit} busy={false} />);
    await userEvent.type(screen.getByLabelText('Web app link'), '  https://script.google.com/macros/s/x/exec ');
    await userEvent.type(screen.getByLabelText('Your key'), ' 9b2c-41fe ');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit).toHaveBeenCalledWith('https://script.google.com/macros/s/x/exec', '9b2c-41fe', 'Intern');
  });

  it('signs in on Enter', async () => {
    const onSubmit = vi.fn();
    render(<SignInScreen onSubmit={onSubmit} busy={false} initialUrl="https://x" />);
    await userEvent.type(screen.getByLabelText('Your key'), 'abc{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('https://x', 'abc', 'Intern');
  });

  it('says what is missing instead of sending, and goes to the first gap', async () => {
    const onSubmit = vi.fn();
    render(<SignInScreen onSubmit={onSubmit} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Paste the web app link.')).toBeTruthy();
    expect(screen.getByText('Paste your key.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Web app link'));
    expect(screen.getByLabelText('Web app link').getAttribute('aria-invalid')).toBe('true');
  });

  it('clears a field’s complaint as soon as it is filled', async () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(screen.getByLabelText('Web app link'), 'h');
    expect(screen.queryByText('Paste the web app link.')).toBeNull();
    expect(screen.getByText('Paste your key.')).toBeTruthy();
  });

  it('hides the key until asked', async () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} />);
    const key = screen.getByLabelText('Your key') as HTMLInputElement;
    expect(key.type).toBe('password');
    await userEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(key.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide key' })).toBeTruthy();
  });

  it('while busy, says so and does not send twice', () => {
    const onSubmit = vi.fn();
    render(<SignInScreen onSubmit={onSubmit} busy initialUrl="https://x" />);
    const button = screen.getByRole('button', { name: 'Signing in…' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.change(screen.getByLabelText('Your key'), { target: { value: 'abc' } });
    fireEvent.submit(button.closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows why the last attempt failed, as an alert', () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} error="That key isn't on the team. Ask your admin for yours." />);
    expect(screen.getByRole('alert').textContent).toContain("That key isn't on the team.");
  });

  it('shows no error line when there is none', () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} error={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('Cancel', () => {
    it('sits beside Sign in, and cannot be pressed while there is nothing to clear', () => {
      render(<SignInScreen onSubmit={() => {}} busy={false} />);
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(cancel.hasAttribute('disabled')).toBe(true);
      expect(cancel.getAttribute('type')).toBe('button');
      expect(cancel.parentElement).toBe(screen.getByRole('button', { name: 'Sign in' }).parentElement);
    });

    it('clears both fields and any complaint, says so to the caller, and goes back to the link', async () => {
      const onCancel = vi.fn();
      const onSubmit = vi.fn();
      render(<SignInScreen onSubmit={onSubmit} onCancel={onCancel} busy={false} initialUrl="https://x" />);
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      expect(screen.getByText('Paste your key.')).toBeTruthy();
      await userEvent.type(screen.getByLabelText('Your key'), 'abc');

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
      expect((screen.getByLabelText('Web app link') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('Your key') as HTMLInputElement).value).toBe('');
      expect(screen.queryByText('Paste your key.')).toBeNull();
      expect(document.activeElement).toBe(screen.getByLabelText('Web app link'));
      expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    });

    it('can be pressed while signing in, even with nothing typed', async () => {
      const onCancel = vi.fn();
      render(<SignInScreen onSubmit={() => {}} onCancel={onCancel} busy />);
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(cancel.hasAttribute('disabled')).toBe(false);
      await userEvent.click(cancel);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('can be pressed to clear an error', () => {
      render(<SignInScreen onSubmit={() => {}} busy={false} error="That key isn't on the team." />);
      expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false);
    });
  });

  describe('with a link built into this version', () => {
    const BUILT_IN = 'https://script.google.com/macros/s/BUILT-IN/exec';

    it('asks only for the key, starts there, and sends the built-in link', async () => {
      const onSubmit = vi.fn();
      render(<SignInScreen onSubmit={onSubmit} busy={false} builtInUrl={BUILT_IN} initialUrl="https://old.example/exec" />);
      expect(screen.queryByLabelText('Web app link')).toBeNull();
      expect(document.activeElement).toBe(screen.getByLabelText('Your key'));
      await userEvent.type(screen.getByLabelText('Your key'), ' abc {Enter}');
      expect(onSubmit).toHaveBeenCalledWith(BUILT_IN, 'abc', 'Intern');
    });
  });

  describe('Intern or Admin', () => {
    it('starts on Intern, sends the role picked, and says where each key comes from', async () => {
      const onSubmit = vi.fn();
      render(<SignInScreen onSubmit={onSubmit} busy={false} initialUrl="https://x" />);
      expect((screen.getByRole('radio', { name: 'Agent' }) as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText('Ask your admin.')).toBeTruthy();

      await userEvent.click(screen.getByRole('radio', { name: 'Admin' }));
      expect(screen.getByText(/ADD_PERSON in Apps Script \(first time only\), or Settings → Team/)).toBeTruthy();
      await userEvent.type(screen.getByLabelText('Your key'), 'abc{Enter}');
      expect(onSubmit).toHaveBeenCalledWith('https://x', 'abc', 'Admin');
    });
  });
});

describe('signing in as the wrong role', () => {
  const EXEC = 'https://script.google.com/macros/s/AKfy-test/exec';

  it('does not sign in, says whose key it is, keeps the key in the field and keeps nothing', async () => {
    const platform = createFakePlatform({
      key: null,
      local: { [SIGN_IN_ROLE_KEY]: 'Admin', 'postit.settings': JSON.stringify({ scriptUrl: EXEC }) },
      replies: { ping: { ok: true, name: 'Jan Dela Cruz', role: 'Intern', fbAccounts: [] } },
    });
    renderApp({ platform, user: null, path: '/sign-in' });
    const admin = (await screen.findByRole('radio', { name: 'Admin' })) as HTMLInputElement;
    // The last choice, read back from this computer.
    await waitFor(() => expect(admin.checked).toBe(true));
    const key = screen.getByLabelText('Your key') as HTMLInputElement;
    await userEvent.type(key, 'intern-key{Enter}');

    expect((await screen.findByRole('alert')).textContent).toContain('This key is for an Agent.');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(key.value).toBe('intern-key');
    expect(await platform.readKey()).toBeNull();

    // Picking Intern then signs in, and is remembered.
    await userEvent.click(screen.getByRole('radio', { name: 'Agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My queue' })).toBeTruthy();
    expect(await platform.readLocal(SIGN_IN_ROLE_KEY)).toBe('Intern');
  });
});
