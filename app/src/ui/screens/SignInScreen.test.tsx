// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInScreen } from './SignInScreen';

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
    expect(onSubmit).toHaveBeenCalledWith('https://script.google.com/macros/s/x/exec', '9b2c-41fe');
  });

  it('signs in on Enter', async () => {
    const onSubmit = vi.fn();
    render(<SignInScreen onSubmit={onSubmit} busy={false} initialUrl="https://x" />);
    await userEvent.type(screen.getByLabelText('Your key'), 'abc{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('https://x', 'abc');
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
    render(<SignInScreen onSubmit={() => {}} busy={false} error="That key isn't on the team. Ask your manager for yours." />);
    expect(screen.getByRole('alert').textContent).toContain("That key isn't on the team.");
  });

  it('shows no error line when there is none', () => {
    render(<SignInScreen onSubmit={() => {}} busy={false} error={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
