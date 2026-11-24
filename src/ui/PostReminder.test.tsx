// @vitest-environment jsdom
/**
 * The reminder to post: a Windows notification, once a day, to someone whose
 * queue is running with listings left and no post today, from the hour set
 * in Settings → App.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell, routerFuture } from './App';
import { POST_REMINDED_KEY } from './PostReminder';
import { AppStateProvider } from './state/AppState';
import { EXEC, fakeServer, intern, renderApp } from './state/testing';

// Wed 4 Nov 2026, 10:30 in Manila.
const WED = '2026-11-04';
const AT_1030 = Date.parse('2026-11-04T02:30:00Z');
const AT_0900 = Date.parse('2026-11-04T01:00:00Z');

const queued = (property: string, status = 'Not Shared') => ({
  date: '2026-11-02',
  due: '2026-11-13',
  assignedTo: intern.name,
  property,
  propertyId: `id-${property}`,
  status,
});
const QUEUE = { ok: true, assignments: [queued('Lot A'), queued('Lot B'), queued('Lot C', 'Posted')] };

function renderAt(now: number, platform: ReturnType<typeof fakeServer>) {
  return render(
    <AppStateProvider platform={platform} initialUser={intern} initialSettings={{ scriptUrl: EXEC }} now={() => now}>
      <MemoryRouter initialEntries={['/queue']} future={routerFuture}>
        <AppShell />
      </MemoryRouter>
    </AppStateProvider>,
  );
}

afterEach(cleanup);

describe('the reminder to post', () => {
  it('says so once a day, from 10, when the queue has listings left and nothing was posted today', async () => {
    const platform = fakeServer({ assignments: QUEUE, posts: { ok: true, posts: [] } });
    renderAt(AT_1030, platform);
    await waitFor(() => expect(platform.notified).toHaveLength(1));
    expect(platform.notified[0]).toEqual({
      title: "You haven't posted today",
      body: '2 listings left in your queue, due Fri 13 Nov. Open My queue for the next one.',
    });
    expect(await platform.readLocal(POST_REMINDED_KEY)).toBe(`${WED}|${intern.name}`);
  });

  it('waits for the hour, and does not say it twice in a day', async () => {
    const early = fakeServer({ assignments: QUEUE, posts: { ok: true, posts: [] } });
    renderAt(AT_0900, early);
    await screen.findByRole('heading', { name: 'My queue' });
    await new Promise((r) => setTimeout(r, 50));
    expect(early.notified).toHaveLength(0);
    cleanup();

    const again = fakeServer({ assignments: QUEUE, posts: { ok: true, posts: [] } });
    await again.writeLocal(POST_REMINDED_KEY, `${WED}|${intern.name}`);
    renderAt(AT_1030, again);
    await screen.findByRole('heading', { name: 'My queue' });
    await new Promise((r) => setTimeout(r, 50));
    expect(again.notified).toHaveLength(0);
  });

  it('is set in Settings → App, and kept on this PC', async () => {
    const platform = fakeServer();
    renderApp({ platform, path: '/settings' });
    const group = await screen.findByRole('group', { name: 'Remind me to post from' });
    expect(within(group).getByRole('radio', { name: '10 am' })).toHaveProperty('checked', true);
    await userEvent.click(within(group).getByRole('radio', { name: 'Off' }));
    await waitFor(async () => expect(JSON.parse((await platform.readLocal('postit.settings'))!)).toMatchObject({ postReminderHour: 0 }));
  });
});
