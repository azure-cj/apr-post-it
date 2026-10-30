// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Chip } from './Chip';

describe('Chip', () => {
  it('is a toggle that says whether it is on', () => {
    const { rerender } = render(<Chip selected={false}>Warehouse</Chip>);
    expect(screen.getByRole('button', { name: 'Warehouse' }).getAttribute('aria-pressed')).toBe('false');
    rerender(<Chip selected>Warehouse</Chip>);
    expect(screen.getByRole('button', { name: 'Warehouse' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('asks to flip its state when pressed', () => {
    const onSelectedChange = vi.fn();
    const { rerender } = render(
      <Chip selected={false} onSelectedChange={onSelectedChange}>
        Pending
      </Chip>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelectedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <Chip selected onSelectedChange={onSelectedChange}>
        Pending
      </Chip>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelectedChange).toHaveBeenLastCalledWith(false);
  });

  it('shows a tick when selected, so selection is not colour alone', () => {
    const { container, rerender } = render(<Chip selected={false}>Posted</Chip>);
    expect(container.querySelector('.chip__check')).toBeNull();
    rerender(<Chip selected>Posted</Chip>);
    expect(container.querySelector('.chip__check')).not.toBeNull();
  });

  it('shows a count', () => {
    render(
      <Chip selected={false} count={1474}>
        All
      </Chip>,
    );
    expect(screen.getByRole('button').textContent).toContain('1,474');
  });

  it('can be vetoed by its own onClick', () => {
    const onSelectedChange = vi.fn();
    render(
      <Chip selected={false} onSelectedChange={onSelectedChange} onClick={(e) => e.preventDefault()}>
        Posted
      </Chip>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelectedChange).not.toHaveBeenCalled();
  });
});
