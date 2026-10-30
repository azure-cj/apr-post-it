// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import type { CheckResult } from '@/core/types';
import { CheckList } from './CheckList';

const checks: CheckResult[] = [
  { name: 'Price present', status: 'pass', detail: '₱4.2M' },
  { name: 'Contact numbers present', status: 'warn', detail: 'No contact number found' },
  { name: 'Internal section hidden', status: 'fail', detail: 'No separator in the document.' },
];

describe('CheckList', () => {
  it('is a named list with a line per check, in the order given', () => {
    render(<CheckList checks={checks} label="Pre-post checks" />);
    const list = screen.getByRole('list', { name: 'Pre-post checks' });
    const lines = within(list).getAllByRole('listitem');
    expect(lines.map((l) => l.querySelector('.checklist__name')?.firstChild?.textContent)).toEqual([
      'Price present',
      'Contact numbers present',
      'Internal section hidden',
    ]);
  });

  it('says each status in words, not only with an icon', () => {
    render(<CheckList checks={checks} />);
    const lines = screen.getAllByRole('listitem');
    expect(lines[0]!.textContent).toContain('passed');
    expect(lines[1]!.textContent).toContain('look again');
    expect(lines[2]!.textContent).toContain('failed');
  });

  it('shows the detail of each check', () => {
    render(<CheckList checks={checks} />);
    expect(screen.getByText('₱4.2M')).toBeTruthy();
    expect(screen.getByText('No separator in the document.')).toBeTruthy();
  });

  it('marks a failing line so it can be found first', () => {
    render(<CheckList checks={checks} />);
    expect(screen.getAllByRole('listitem')[2]!.className).toContain('checklist__line--fail');
  });

  it('says so when there is nothing to check', () => {
    render(<CheckList checks={[]} emptyText="No checks yet." />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('No checks yet.')).toBeTruthy();
  });
});
