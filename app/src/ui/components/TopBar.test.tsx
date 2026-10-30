// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TopBar, chooseTopBarLayout, type TopBarNavItem } from './TopBar';

const nav: TopBarNavItem[] = [
  { key: 'queue', label: 'My queue', href: '#/queue', count: 6, countLabel: '6 to post' },
  { key: 'find', label: 'Find', href: '#/find' },
];

describe('chooseTopBarLayout: the first arrangement that fits', () => {
  const parts = { brand: 130, nav: 220, user: 300, gap: 24 };
  const oneRow = 130 + 24 + 220 + 24 + 300; // 698

  it('is one row when brand, nav and user fit side by side', () => {
    expect(chooseTopBarLayout({ ...parts, available: 1272 })).toBe('one-row');
    expect(chooseTopBarLayout({ ...parts, available: oneRow })).toBe('one-row');
  });

  it('is two rows as soon as one row does not fit', () => {
    expect(chooseTopBarLayout({ ...parts, available: oneRow - 1 })).toBe('two-rows');
  });

  it('stays two rows when even that is too wide (the nav then wraps)', () => {
    expect(chooseTopBarLayout({ ...parts, available: 200 })).toBe('two-rows');
  });

  it('counts only the parts that are there', () => {
    // Before sign-in: just the brand.
    expect(chooseTopBarLayout({ brand: 130, nav: 0, user: 0, gap: 24, available: 130 })).toBe('one-row');
  });
});

describe('TopBar', () => {
  it('names the brand, the nav and the person', () => {
    render(<TopBar nav={nav} currentKey="queue" user={{ name: 'Jan Dela Cruz', role: 'Intern' }} />);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'APG Post-It' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByText('Jan Dela Cruz')).toBeTruthy();
    expect(screen.getByText('Intern')).toBeTruthy();
  });

  it('marks the current screen, and only it', () => {
    render(<TopBar nav={nav} currentKey="find" />);
    expect(screen.getByRole('link', { name: 'Find' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /My queue/ }).getAttribute('aria-current')).toBeNull();
  });

  it('reads a count with what it counts', () => {
    render(<TopBar nav={nav} />);
    expect(screen.getByRole('link', { name: /My queue/ }).textContent).toContain('6 to post');
  });

  it('hands navigation to the app instead of following the link', () => {
    const onNavigate = vi.fn();
    render(<TopBar nav={nav} onNavigate={onNavigate} />);
    const followed = fireEvent.click(screen.getByRole('link', { name: 'Find' }));
    expect(onNavigate).toHaveBeenCalledWith('find');
    expect(followed).toBe(false); // default prevented
  });

  it('leaves a modified click to the browser', () => {
    const onNavigate = vi.fn();
    render(<TopBar nav={nav} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'Find' }), { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('signs out', () => {
    const onSignOut = vi.fn();
    render(<TopBar nav={nav} user={{ name: 'Jan Dela Cruz', role: 'Intern' }} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('has no nav before sign-in', () => {
    render(<TopBar />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  describe('measured layout', () => {
    let room = 1000;
    const observers: { cb: () => void }[] = [];

    beforeEach(() => {
      observers.length = 0;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          cb: () => void;
          constructor(cb: () => void) {
            this.cb = cb;
            observers.push(this);
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      // jsdom has no layout: give each part the width it would have.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const width = this.classList.contains('topbar__room')
          ? room
          : this.classList.contains('topbar__brand')
            ? 130
            : this.classList.contains('topbar__item')
              ? 110
              : this.classList.contains('topbar__user')
                ? 300
                : 0;
        return { width, height: 40, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 40, toJSON: () => ({}) } as DOMRect;
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const layout = () => document.querySelector('.topbar__inner')?.getAttribute('data-layout');

    it('takes one row when there is room, two when there is not, and follows the room as it changes', () => {
      // Needs 130 + 2 × 110 + 300 = 650 (jsdom reports no gaps or padding).
      room = 1000;
      render(<TopBar nav={nav} user={{ name: 'Jan Dela Cruz', role: 'Intern' }} onSignOut={() => {}} />);
      expect(layout()).toBe('one-row');

      room = 600;
      act(() => observers.forEach((o) => o.cb()));
      expect(layout()).toBe('two-rows');

      room = 650;
      act(() => observers.forEach((o) => o.cb()));
      expect(layout()).toBe('one-row');
    });
  });
});
