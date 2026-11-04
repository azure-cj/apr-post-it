// @vitest-environment jsdom
/**
 * Warnings before Friday (from Wednesday, when behind: what is left and how
 * many a day), and What's new (once after an update, and from the sidebar).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fridayWarning, fridayWarningWords, type WeekProgress } from '@/core/summary';
import { version } from '../../package.json';
import { notesFor, SEEN_VERSION_KEY } from './releaseNotes';
import { fakeServer, renderApp } from './state/testing';

// The week of Mon 2 Nov 2026.
const WEEK = '2026-11-02';
const progress = (posted: number, pace: WeekProgress['pace'] = 'behind'): WeekProgress => ({
  target: 20,
  posted,
  pending: 0,
  notShared: 20 - posted,
  missed: 0,
  daysLeft: 0,
  expectedByToday: 0,
  pace,
});

describe('fridayWarning', () => {
  it('is quiet on Monday and Tuesday', () => {
    expect(fridayWarning(progress(2), WEEK, '2026-11-02')).toBeNull();
    expect(fridayWarning(progress(2), WEEK, '2026-11-03')).toBeNull();
  });

  it('from Wednesday, says what is left and how many a day, today counted', () => {
    const wed = fridayWarning(progress(8), WEEK, '2026-11-04')!;
    expect(wed).toEqual({ left: 12, daysLeft: 3, perDay: 4 });
    expect(fridayWarningWords(wed)).toBe('12 left, 3 days to go: about 4 a day.');
    expect(fridayWarningWords(fridayWarning(progress(17), WEEK, '2026-11-06')!)).toBe('3 left: due today.');
  });

  it('is quiet when on track or done, and once the week is over', () => {
    expect(fridayWarning(progress(15, 'on-track'), WEEK, '2026-11-04')).toBeNull();
    expect(fridayWarning(progress(20, 'done'), WEEK, '2026-11-05')).toBeNull();
    expect(fridayWarning(progress(2), WEEK, '2026-11-07')).toBeNull();
  });
});

describe("What's new", () => {
  it('is not shown on a fresh install, only noted', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: '/find' });
    await waitFor(async () => expect(await platform.readLocal(SEEN_VERSION_KEY)).toBe(version));
    expect(screen.queryByRole('dialog', { name: `What's new in ${version}` })).toBeNull();
  });

  it('is shown once after an update, and not again', async () => {
    const platform = fakeServer();
    await platform.writeLocal(SEEN_VERSION_KEY, '1.0.0');
    renderApp({ platform, path: '/find' });

    const dialog = await screen.findByRole('dialog', { name: `What's new in ${version}` });
    expect(within(dialog).getByText(notesFor(version)!.items[0]!)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog', { name: `What's new in ${version}` })).toBeNull();
    expect(await platform.readLocal(SEEN_VERSION_KEY)).toBe(version);
  });

  it('opens from the version at the foot of the sidebar', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await userEvent.click(await screen.findByRole('button', { name: `Version ${version}: what's new` }));
    expect(await screen.findByRole('dialog', { name: `What's new in ${version}` })).toBeTruthy();
  });
});
