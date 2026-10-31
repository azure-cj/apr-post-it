// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Badge, CategoryTag, Pill, categoryKind, categoryLabel } from './Pill';

describe('categoryKind', () => {
  it('knows the four categories by their Drive folder names', () => {
    expect(categoryKind('COMMERCIAL SPACE')).toBe('commercial');
    expect(categoryKind('CONDO / HOUSE AND LOT')).toBe('condo');
    expect(categoryKind('OFFICE SPACE')).toBe('office');
    expect(categoryKind('WAREHOUSE')).toBe('warehouse');
  });

  it('forgives case, spacing, slashes and ampersands', () => {
    expect(categoryKind('Condo/House & Lot')).toBe('condo');
    expect(categoryKind('  commercial   space ')).toBe('commercial');
  });

  it('matches whole names only, like the exclusion list (D11)', () => {
    expect(categoryKind('Virtual Office for posting')).toBe('unsorted');
    expect(categoryKind('WAREHOUSE FOR LEASE')).toBe('unsorted');
    expect(categoryKind('')).toBe('unsorted');
  });
});

describe('categoryLabel', () => {
  it('says the four in sentence case', () => {
    expect(categoryLabel('CONDO / HOUSE AND LOT')).toBe('Condo / house and lot');
    expect(categoryLabel('COMMERCIAL SPACE')).toBe('Commercial space');
  });

  it('turns other shouting into sentence case, and leaves the rest alone', () => {
    expect(categoryLabel('LOTS FOR SALE')).toBe('Lots for sale');
    expect(categoryLabel('Virtual Office for posting')).toBe('Virtual Office for posting');
    expect(categoryLabel('BGC')).toBe('BGC');
    expect(categoryLabel(' ')).toBe('Unsorted');
  });
});

describe('CategoryTag', () => {
  it('shows the name with a decorative dot', () => {
    const { container } = render(<CategoryTag category="WAREHOUSE" />);
    expect(container.textContent).toBe('Warehouse');
    const dot = container.querySelector('.category-dot');
    expect(dot?.className).toContain('category-dot--warehouse');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Pill and Badge', () => {
  it('carries its tone as a class and its meaning as words', () => {
    render(
      <Pill tone="danger" dot>
        In cooldown
      </Pill>,
    );
    expect(screen.getByText('In cooldown').className).toContain('pill--danger');
  });

  it('reads a count with what it counts', () => {
    const { container } = render(<Badge count={6} label="6 to post" />);
    expect(container.querySelector('.visually-hidden')?.textContent).toBe('6 to post');
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('6');
  });
});
