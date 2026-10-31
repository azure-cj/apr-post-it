// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastRegion, toastDurations, useToasts, type Toasts } from './Toast';

let api: Toasts;

function Harness() {
  api = useToasts();
  return <ToastRegion toasts={api.toasts} onDismiss={api.dismiss} />;
}

const messages = () => screen.queryAllByRole('listitem').map((li) => li.textContent);

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('live in a polite region that is there before anything arrives', () => {
    render(<Harness />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.children.length).toBe(0);
  });

  it('show, then dismiss themselves when their time is up', () => {
    render(<Harness />);
    act(() => {
      api.show('Copied. Paste it into Facebook.');
    });
    expect(messages()).toEqual(['Copied. Paste it into Facebook.']);

    act(() => {
      vi.advanceTimersByTime(toastDurations.ok - 1);
    });
    expect(messages()).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Fading out, then gone.
    expect(document.querySelector('.toast--leaving')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(messages()).toEqual([]);
  });

  it('wait while the pointer is on them, then take the time that was left', () => {
    render(<Harness />);
    act(() => {
      api.show('Copied.');
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.mouseEnter(document.querySelector('.toast')!);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(messages()).toEqual(['Copied.']);

    fireEvent.mouseLeave(document.querySelector('.toast')!);
    act(() => {
      vi.advanceTimersByTime(toastDurations.ok - 3000 + 150);
    });
    expect(messages()).toEqual([]);
  });

  it('keep problems up longer than confirmations', () => {
    expect(toastDurations.danger).toBeGreaterThan(toastDurations.ok);
    expect(toastDurations.warn).toBeGreaterThan(toastDurations.info);
  });

  it('close from their button', () => {
    render(<Harness />);
    act(() => {
      api.show('8 photos saved.', 'info');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(messages()).toEqual([]);
  });

  it('show at most three, dropping the oldest', () => {
    render(<Harness />);
    act(() => {
      ['One', 'Two', 'Three', 'Four'].forEach((m) => api.show(m));
    });
    expect(messages()).toEqual(['Two', 'Three', 'Four']);
  });
});
