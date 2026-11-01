// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternRow } from '@/core/records';
import { RecordsBreakdown } from './RecordsBreakdown';

const intern = (i: number): InternRow => ({
  name: `Intern ${String(i).padStart(2, '0')}`,
  posts: 30 - i,
  posted: 30 - i,
  pending: 0,
  missed: 0,
  target: 40,
  done: 30 - i,
  completion: (30 - i) / 40,
  trend: [1, 2, 3],
});

const names = () => Array.from(document.querySelectorAll('.breakdown-row__name')).map((n) => n.textContent);

describe('Records, by intern', () => {
  it('pages a long team ten at a time, and shows a short one whole', async () => {
    const { rerender } = render(
      <RecordsBreakdown tab="intern" onTabChange={() => undefined} interns={Array.from({ length: 12 }, (_, i) => intern(i + 1))} categories={[]} />,
    );
    expect(names()).toHaveLength(10);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    await userEvent.click(within(nav).getByRole('button', { name: 'Page 2' }));
    expect(names()).toEqual(['Intern 11', 'Intern 12']);

    rerender(<RecordsBreakdown tab="intern" onTabChange={() => undefined} interns={[intern(1), intern(2)]} categories={[]} />);
    expect(names()).toEqual(['Intern 01', 'Intern 02']);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
