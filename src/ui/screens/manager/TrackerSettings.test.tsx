// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assignment, PostLogEntry } from '@/core/types';
import type { DirectoryRow } from '@/core/summary';
import { TrackerScreen } from './index';

const TODAY = '2026-10-29';

function listing(id: string, name: string, issues = ''): DirectoryRow {
  return {
    id,
    name,
    category: 'WAREHOUSE',
    listingType: 'FOR LEASE/ FOR RENT',
    subCategory: '',
    photoCount: 4,
    hasIssues: issues !== '',
    ...(issues ? { issues } : {}),
  };
}

const LIBRARY = [
  listing('a', 'Calamba Warehouse 3'),
  listing('b', 'Pampanga Logistics Hub 9', 'No separator line — the whole document is treated as postable. Check it.'),
  listing('c', 'Taguig FTI Warehouse 12', 'No photos'),
];

const post = (title: string, id: string, date: string, status: 'Posted' | 'Pending'): PostLogEntry => ({
  date,
  time: '10:00',
  type: 'Group post',
  title,
  status,
  fbAccount: 'APG Main',
  postLink: status === 'Posted' ? 'https://www.facebook.com/groups/x/posts/1/' : '',
  postedBy: 'Jan Dela Cruz',
  propertyId: id,
});

afterEach(cleanup);

describe('TrackerScreen', () => {
  it('shows every number, zero included, and doc health worst first', () => {
    const posts = [post('Calamba Warehouse 3', 'a', '2026-09-01', 'Posted')];
    const assignments: Assignment[] = [];
    render(
      <TrackerScreen
        date={TODAY}
        today={TODAY}
        posts={posts}
        assignments={assignments}
        properties={LIBRARY}
        settings={{ cooldownDays: 7, repostDueDays: 14 }}
        onDateChange={vi.fn()}
      />,
    );
    const stats = document.querySelector('.tracker-stats')!;
    expect(within(stats as HTMLElement).getByText('Posted today').nextElementSibling?.textContent).toBe('0');
    expect(stats.textContent).toContain('Pending0');
    expect(stats.textContent).toContain('Due for repost1');
    expect(stats.textContent).toContain('Never posted2');
    expect(screen.getByText('No posts today yet.')).toBeTruthy();
    const groups = Array.from(document.querySelectorAll('.health-group__title')).map((h) => h.textContent);
    expect(groups).toEqual(['No separator', 'No photos']);
  });
});
