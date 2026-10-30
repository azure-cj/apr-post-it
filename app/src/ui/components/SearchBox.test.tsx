// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SearchBox } from './SearchBox';

function Search({ initial = '', onValue = (_: string) => {} }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchBox
      label="Search listings"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

describe('SearchBox', () => {
  it('is a search field named for screen readers', () => {
    render(<Search />);
    expect(screen.getByRole('searchbox', { name: 'Search listings' })).toBeTruthy();
  });

  it('reports every change', async () => {
    const onValue = vi.fn();
    render(<Search onValue={onValue} />);
    await userEvent.type(screen.getByRole('searchbox'), 'Lot');
    expect(onValue).toHaveBeenLastCalledWith('Lot');
  });

  it('offers a clear button only once there is something to clear', async () => {
    render(<Search />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), 'Verdant');
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
  });

  it('clears, and puts focus back in the field', async () => {
    render(<Search initial="Verdant Hills" />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    const box = screen.getByRole('searchbox') as HTMLInputElement;
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
  });

  it('clears on Escape', () => {
    const onValue = vi.fn();
    render(<Search initial="Verdant Hills" onValue={onValue} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(onValue).toHaveBeenCalledWith('');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });

  it('leaves Escape alone when already empty, so it can close what is around it', () => {
    const onValue = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Search onValue={onValue} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(onValue).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalled();
  });
});
