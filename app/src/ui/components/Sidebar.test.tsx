// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Sidebar, type SidebarNavItem, type SidebarProps } from './Sidebar';
import { TitleBar } from './TitleBar';

const nav: SidebarNavItem[] = [
  { key: 'queue', label: 'My queue', href: '#/queue', icon: 'inbox', count: 6, countLabel: '6 to post' },
  { key: 'find', label: 'Find', href: '#/find', icon: 'search' },
];

const me = { name: 'Jan Dela Cruz', role: 'Intern' };

function renderSidebar(props: Partial<SidebarProps> = {}) {
  return render(<Sidebar nav={nav} user={me} collapsed={false} onToggleCollapsed={() => {}} {...props} />);
}

describe('Sidebar', () => {
  it('names the brand, the nav and the person', () => {
    renderSidebar({ currentKey: 'queue' });
    expect(screen.getByRole('link', { name: 'APG Post-It' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByText('Jan Dela Cruz')).toBeTruthy();
    expect(screen.getByText('Intern')).toBeTruthy();
  });

  it('marks the current screen, and only it', () => {
    renderSidebar({ currentKey: 'find' });
    expect(screen.getByRole('link', { name: 'Find' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /My queue/ }).getAttribute('aria-current')).toBeNull();
  });

  it('reads a count with what it counts', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /My queue/ }).textContent).toContain('6 to post');
  });

  it('hands navigation to the app instead of following the link, but leaves a modified click alone', () => {
    const onNavigate = vi.fn();
    renderSidebar({ onNavigate });
    expect(fireEvent.click(screen.getByRole('link', { name: 'Find' }))).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith('find');
    fireEvent.click(screen.getByRole('link', { name: 'Find' }), { ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('signs out', () => {
    const onSignOut = vi.fn();
    renderSidebar({ onSignOut });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('says whether it is expanded, and toggles', () => {
    const onToggleCollapsed = vi.fn();
    const { rerender } = renderSidebar({ onToggleCollapsed });
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Control+B');
    fireEvent.click(toggle);
    expect(onToggleCollapsed).toHaveBeenCalled();

    rerender(<Sidebar nav={nav} user={me} collapsed onToggleCollapsed={onToggleCollapsed} />);
    expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps every name in the rail, and shows it in a tooltip on hover and focus', () => {
    renderSidebar({ collapsed: true });
    // Still named for screen readers.
    const find = screen.getByRole('link', { name: 'Find' });
    expect(screen.getByRole('link', { name: 'APG Post-It' })).toBeTruthy();

    fireEvent.mouseEnter(find);
    expect(screen.getByRole('tooltip').textContent).toBe('Find');
    fireEvent.mouseLeave(find);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(screen.getByRole('link', { name: /My queue/ }));
    expect(screen.getByRole('tooltip').textContent).toBe('My queue · 6 to post');
    // Escape dismisses it.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows no tooltips for words that are already on show', () => {
    renderSidebar();
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Find' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('has no people list unless given one', () => {
    renderSidebar();
    expect(screen.queryByRole('heading', { name: 'Interns' })).toBeNull();
  });

  describe('people', () => {
    it('lists each person with their day, a pending dot said in words, and the open one selected', () => {
      const onOpenPerson = vi.fn();
      renderSidebar({
        onOpenPerson,
        people: {
          status: 'ready',
          empty: 'Nobody',
          people: [
            { name: 'Bea Lim', href: '#/assign?intern=Bea+Lim', progress: 'No queue today' },
            { name: 'Mika Reyes', href: '#/assign?intern=Mika+Reyes', progress: '2 of 5 posted', pending: 1, selected: true },
          ],
        },
      });
      const list = screen.getByRole('region', { name: 'Interns' });
      const mika = within(list).getByRole('link', { name: /Mika Reyes/ });
      expect(mika.textContent).toContain('2 of 5 posted');
      expect(mika.textContent).toContain('1 post waiting for a link');
      expect(mika.querySelector('.sidebar__dot')).not.toBeNull();
      expect(mika.getAttribute('aria-current')).toBe('true');
      const bea = within(list).getByRole('link', { name: /Bea Lim/ });
      expect(bea.querySelector('.sidebar__dot')).toBeNull();
      expect(bea.getAttribute('aria-current')).toBeNull();
      expect(bea.querySelector('.sidebar__avatar')?.textContent).toBe('BL');

      fireEvent.click(bea);
      expect(onOpenPerson).toHaveBeenCalledWith('Bea Lim');
    });

    it('says when it is reading, when it is empty, and offers to try again when it failed', () => {
      const { rerender } = renderSidebar({ people: { status: 'loading' } });
      expect(screen.getByRole('status').textContent).toContain('Reading the interns');

      rerender(
        <Sidebar nav={nav} user={me} collapsed={false} onToggleCollapsed={() => {}} people={{ status: 'ready', people: [], empty: 'No interns yet.' }} />,
      );
      expect(screen.getByText('No interns yet.')).toBeTruthy();

      const onRetry = vi.fn();
      rerender(
        <Sidebar
          nav={nav}
          user={me}
          collapsed={false}
          onToggleCollapsed={() => {}}
          people={{ status: 'error', message: "Couldn't reach the web app.", onRetry }}
        />,
      );
      expect(screen.getByRole('alert').textContent).toContain("Couldn't reach the web app.");
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(onRetry).toHaveBeenCalled();
    });
  });
});

describe('TitleBar', () => {
  it('draws nothing when it would hold nothing', () => {
    const { container } = render(<TitleBar />);
    expect(container.innerHTML).toBe('');
  });

  it('carries the brand before sign-in', () => {
    render(<TitleBar brandHref="#/" />);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'APG Post-It' })).toBeTruthy();
  });

  it('is the drag region and holds the window controls on the desktop', () => {
    const onClose = vi.fn();
    render(<TitleBar windowControls={{ maximized: false, onMinimize: () => {}, onToggleMaximize: () => {}, onClose }} />);
    expect(screen.getByRole('banner').hasAttribute('data-tauri-drag-region')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
