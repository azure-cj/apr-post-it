// @vitest-environment jsdom
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Pagination, pageSlots, rangeLabel, usePaged } from './Pagination';

const show = (page: number, count: number, siblings = 1) =>
  pageSlots(page, count, siblings)
    .map((s) => (typeof s === 'number' ? String(s) : '…'))
    .join(' ');

describe('pageSlots', () => {
  it('shows the first, the last and the pages around the current one, with gaps between', () => {
    expect(show(5, 148)).toBe('1 … 4 5 6 … 148');
    expect(show(74, 148)).toBe('1 … 73 74 75 … 148');
    expect(show(144, 148)).toBe('1 … 143 144 145 … 148');
  });

  it('keeps the same number of slots at either edge, so the buttons stay put', () => {
    expect(show(1, 148)).toBe('1 2 3 4 5 … 148');
    expect(show(4, 148)).toBe('1 2 3 4 5 … 148');
    expect(show(145, 148)).toBe('1 … 144 145 146 147 148');
    expect(show(148, 148)).toBe('1 … 144 145 146 147 148');
  });

  it('never hides a single page behind a gap, and needs no gap for seven pages or fewer', () => {
    expect(show(4, 7)).toBe('1 2 3 4 5 6 7');
    expect(show(1, 7)).toBe('1 2 3 4 5 6 7');
    expect(show(3, 3)).toBe('1 2 3');
    expect(show(1, 2)).toBe('1 2');
    expect(show(1, 1)).toBe('1');
    expect(show(1, 0)).toBe('');
  });

  it('shows fewer pages around the current one in a compact bar', () => {
    expect(show(10, 20, 0)).toBe('1 … 10 … 20');
    expect(show(1, 20, 0)).toBe('1 2 3 … 20');
    expect(show(20, 20, 0)).toBe('1 … 18 19 20');
  });
});

describe('rangeLabel', () => {
  it('says which rows are shown, of how many', () => {
    expect(rangeLabel(1, 10, 1474)).toBe('1–10 of 1,474');
    expect(rangeLabel(148, 10, 1474)).toBe('1,471–1,474 of 1,474');
    expect(rangeLabel(2, 10, 14)).toBe('11–14 of 14');
  });
});

function Harness({ total, start = 1, compact = false }: { readonly total: number; readonly start?: number; readonly compact?: boolean }) {
  const [page, setPage] = useState(start);
  return <Pagination page={page} total={total} onPageChange={setPage} compact={compact} />;
}

describe('Pagination', () => {
  it('is hidden when everything fits on one page', () => {
    const { container, rerender } = render(<Pagination page={1} total={10} onPageChange={() => undefined} />);
    expect(container.innerHTML).toBe('');
    rerender(<Pagination page={1} total={0} onPageChange={() => undefined} />);
    expect(container.innerHTML).toBe('');
    rerender(<Pagination page={1} total={11} onPageChange={() => undefined} />);
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy();
  });

  it('says the range, marks the current page, and gives each button a name', () => {
    render(<Harness total={1474} start={5} />);
    expect(screen.getByText('41–50 of 1,474')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Previous page',
      'Page 1',
      'Page 4',
      'Page 5',
      'Page 6',
      'Page 148',
      'Next page',
    ]);
    expect(nav.textContent).toBe('Prev1…456…148Next');
    expect(within(nav).getByRole('button', { name: 'Page 5' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('button', { name: 'Page 4' }).getAttribute('aria-current')).toBeNull();
    // The gaps are for the eye only.
    expect(nav.querySelectorAll('[aria-hidden="true"].pagination__gap')).toHaveLength(2);
  });

  it('goes to a page, and to the one before and after; Prev and Next stop at the edges', async () => {
    render(<Harness total={35} />);
    const prev = screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    await userEvent.click(next);
    expect(screen.getByText('11–20 of 35')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(screen.getByText('31–35 of 35')).toBeTruthy();
    expect(next.disabled).toBe(true);
    await userEvent.click(prev);
    expect(screen.getByRole('button', { name: 'Page 3' }).getAttribute('aria-current')).toBe('page');
  });

  it('works from the keyboard: Tab to it, arrows, Home and End between buttons, Enter to go', async () => {
    render(<Harness total={60} start={3} />);
    await userEvent.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Previous page');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 2');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('11–20 of 60')).toBeTruthy();
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Next page');
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 6');
    await userEvent.keyboard(' ');
    expect(screen.getByText('51–60 of 60')).toBeTruthy();
    await userEvent.keyboard('{Home}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Previous page');
  });

  it('shows Prev and Next as arrows only when compact, still named', () => {
    render(<Harness total={200} start={10} compact />);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(nav.textContent).toBe('1…10…20');
    expect(within(nav).getByRole('button', { name: 'Previous page' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Next page' })).toBeTruthy();
  });
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => `row ${i + 1}`);

describe('usePaged', () => {
  it('gives ten rows a page by default', () => {
    const { result } = renderHook(() => usePaged(rows(25)));
    expect(result.current.items).toEqual(rows(10));
    expect(result.current.pageCount).toBe(3);
    act(() => result.current.setPage(3));
    expect(result.current.items).toEqual(['row 21', 'row 22', 'row 23', 'row 24', 'row 25']);
    expect(result.current.pagination).toMatchObject({ page: 3, pageSize: 10, total: 25 });
  });

  it('goes back to page 1 when the search or the filters change, and only then', () => {
    const { result, rerender } = renderHook(({ items, key }) => usePaged(items, 10, key), {
      initialProps: { items: rows(40), key: 'warehouse|' },
    });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    // The same filters with new rows (a refresh): the page stays.
    rerender({ items: rows(41), key: 'warehouse|' });
    expect(result.current.page).toBe(3);
    // A new search: back to the top.
    rerender({ items: rows(30), key: 'warehouse|makati' });
    expect(result.current.page).toBe(1);
    expect(result.current.items[0]).toBe('row 1');
  });

  it('steps back to the last page there is when the rows shrink under it', () => {
    const { result, rerender } = renderHook(({ items }) => usePaged(items), { initialProps: { items: rows(35) } });
    act(() => result.current.setPage(4));
    rerender({ items: rows(22) });
    expect(result.current.page).toBe(3);
    expect(result.current.items).toEqual(['row 21', 'row 22']);
  });

  it('can keep the page somewhere else, and tells it to go back to page 1 on a new search', () => {
    const onPageChange = vi.fn();
    const { result, rerender } = renderHook(({ key, page }) => usePaged(rows(50), 10, key, { page, onPageChange }), {
      initialProps: { key: 'a', page: 4 },
    });
    // Arriving on a kept page keeps it.
    expect(result.current.page).toBe(4);
    expect(onPageChange).not.toHaveBeenCalled();
    act(() => result.current.setPage(5));
    expect(onPageChange).toHaveBeenLastCalledWith(5);
    rerender({ key: 'b', page: 5 });
    expect(result.current.page).toBe(1);
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('brings the list into view and puts focus on it after a page change, not before', async () => {
    function List() {
      const paged = usePaged(rows(30));
      return (
        <>
          <ul ref={paged.topRef} aria-label="Rows">
            {paged.items.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <Pagination {...paged.pagination} />
        </>
      );
    }
    render(<List />);
    const list = screen.getByRole('list', { name: 'Rows' });
    expect(list.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).not.toBe(list);
    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(document.activeElement).toBe(list);
    expect(within(list).getAllByRole('listitem')[0]!.textContent).toBe('row 11');
    // Next Tab: back to the pages, the first stop after the list.
    await userEvent.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Previous page');
  });
});
