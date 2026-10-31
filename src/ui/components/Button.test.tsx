// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Open Drive folder</Button>);
    const button = screen.getByRole('button', { name: 'Open Drive folder' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('button--ghost');
  });

  it('calls onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks the primary action', () => {
    render(<Button variant="primary">Sign in</Button>);
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toContain('button--primary');
  });

  it('while busy, ignores clicks but stays focusable and says it is busy', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" busy onClick={onClick}>
        Signing in…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Signing in…' });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Not the disabled attribute: that would throw focus away mid-wait.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('while busy, does not submit its form again', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" busy>
          Signing in…
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Copy
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps its icon out of its name', () => {
    render(<Button icon={<svg data-testid="icon" />}>Sign out</Button>);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });
});
