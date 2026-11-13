// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { FakePlatform } from '@/platform/fake';
import { AppShell, routerFuture } from '../../App';
import { AppStateProvider } from '../../state/AppState';
import { EXEC, fakeServer, intern, renderApp } from '../../state/testing';

/** 10:00 in Manila on a given day. */
const at = (day: string) => Date.parse(`${day}T02:00:00Z`);
const THURSDAY = at('2026-11-05');
const FRIDAY = at('2026-11-06');
/** The week of Mon 2 Nov: its key, as the Assignments tab writes it. */
const WEEK = '2026-11-02';

/** The window at /queue, signed in as Jan, on a given day. renderApp's day is Saturday 31 Oct. */
function renderOn(now: number, platform: FakePlatform, path = '/queue') {
  return render(
    <AppStateProvider platform={platform} initialUser={intern} initialSettings={{ scriptUrl: EXEC }} now={() => now}>
      <MemoryRouter initialEntries={[path]} future={routerFuture}>
        <AppShell />
      </MemoryRouter>
    </AppStateProvider>,
  );
}

const item = (property: string, propertyId: string, status: string, date = WEEK, assignedTo = intern.name) => ({
  date,
  assignedTo,
  property,
  propertyId,
  status,
});

const QUEUE = {
  ok: true,
  assignments: [
    // "Not Shared" is the interns' word; "To post", in older rows, is the same.
    item('Verdant Hills Lot 12, Tagaytay', '1VerdantHillsLot12', 'Not Shared'),
    item('Kapitolyo Ground Floor Retail, Pasig', '1Kapitolyo', 'Posted'),
    item('Seaside Residences 2BR, Pasay', '1Seaside', 'Pending'),
    item('Valenzuela Warehouse 1,200 sqm', '1Valenzuela', 'To post'),
    // Last week's: not this week's work.
    item('BGC Uptown Office 18F, 240 sqm', '1BgcUptown', 'To post', '2026-10-26'),
  ],
};

const POSTS = {
  ok: true,
  posts: [
    { date: '2026-11-03', time: '09:41', type: '', title: 'Kapitolyo Ground Floor Retail, Pasig', status: 'Posted', fbAccount: 'APG Main', postLink: 'https://www.facebook.com/groups/apgmain/posts/1/', postedBy: intern.name, propertyId: '1Kapitolyo' },
    { date: '2026-11-04', time: '11:02', type: '', title: 'Seaside Residences 2BR, Pasay', status: 'Pending', fbAccount: 'APG Main', postLink: '', postedBy: intern.name, propertyId: '1Seaside' },
  ],
};

const week = () => document.querySelector('.queue__week') as HTMLElement;

describe('My queue: this week', () => {
  it('heads the week with how far along it is and when it is due', async () => {
    renderOn(THURSDAY, fakeServer({ assignments: QUEUE, posts: POSTS }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My queue');
    await screen.findByRole('region', { name: 'Next up' });
    // Posted and pending both count toward the week.
    expect(week().querySelector('.queue__week-title')!.textContent).toBe('This queue · 2 of 4');
    expect(week().querySelector('.queue__due')!.textContent).toBe('Due Fri 6 Nov');
    expect(week().querySelector('.queue__due--today')).toBeNull();
    expect((week().querySelector('.queue__bar-posted') as HTMLElement).style.width).toBe('25%');
    expect((week().querySelector('.queue__bar-pending') as HTMLElement).style.width).toBe('25%');
    const counts = screen.getByRole('list', { name: "This queue's counts" }).textContent;
    expect(counts).toContain('1 posted');
    expect(counts).toContain('1 pending');
    expect(counts).toContain('2 not shared');
  });

  it('says "Due today" on Friday, in amber', async () => {
    renderOn(FRIDAY, fakeServer({ assignments: QUEUE, posts: POSTS }));
    await screen.findByRole('region', { name: 'Next up' });
    const due = week().querySelector('.queue__due')!;
    expect(due.textContent).toBe('Due today');
    expect(due.classList.contains('queue__due--today')).toBe(true);
  });

  it("shows next week's queue at the weekend, with when it starts", async () => {
    // Saturday 31 Oct: the week of 26–30 Oct is over, and Mon 2 Nov's is assigned.
    const fresh = { ok: true, assignments: QUEUE.assignments.map((a) => ({ ...a, status: 'Not Shared' })) };
    renderApp({ platform: fakeServer({ assignments: fresh, posts: { ok: true, posts: [] } }), path: '/queue' });
    await screen.findByRole('region', { name: 'Next up' });
    expect(week().querySelector('.queue__week-title')!.textContent).toBe('Next queue · 0 of 4');
    expect(week().querySelector('.queue__due')!.textContent).toBe('Starts Mon 2 Nov · due Fri 6 Nov');
    // Last week's leftover isn't shown.
    expect(screen.queryByText('BGC Uptown Office 18F, 240 sqm')).toBeNull();
  });

  it("says so at the weekend when next week isn't assigned yet", async () => {
    const lastWeekOnly = { ok: true, assignments: QUEUE.assignments.map((a) => ({ ...a, date: '2026-10-26' })) };
    renderApp({ platform: fakeServer({ assignments: lastWeekOnly }), path: '/queue' });
    expect(await screen.findByText('Nothing in your queue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find a property' })).toBeTruthy();
    expect(document.querySelector('.queue__week')).toBeNull();
  });

  it('counts a post the queue has not caught up with yet', async () => {
    const lagging = { ok: true, assignments: QUEUE.assignments.map((a) => (a.propertyId === '1Kapitolyo' ? { ...a, status: 'Not Shared' } : a)) };
    renderOn(THURSDAY, fakeServer({ assignments: lagging, posts: POSTS }));
    await screen.findByRole('region', { name: 'Next up' });
    expect(week().querySelector('.queue__week-title')!.textContent).toBe('This queue · 2 of 4');
    const kapitolyo = screen.getByRole('link', { name: 'Kapitolyo Ground Floor Retail, Pasig' }).closest('li')!;
    expect(kapitolyo.querySelector('.pill')!.textContent).toBe('Posted');
  });
});

describe('My queue: a queue of 2 weeks (v14)', () => {
  // Saved on Friday 6 Nov for 2 weeks: due Thursday 19 Nov. The weekends don't count.
  const twoWeeks = {
    ok: true,
    assignments: QUEUE.assignments.slice(0, 4).map((a) => ({ ...a, date: '2026-11-06', due: '2026-11-19' })),
  };

  it('runs past Friday: the week after, it is still this queue, due on its own deadline', async () => {
    renderOn(at('2026-11-10'), fakeServer({ assignments: twoWeeks, posts: { ok: true, posts: [] } }));
    await screen.findByRole('region', { name: 'Next up' });
    expect(week().querySelector('.queue__week-title')!.textContent).toBe('This queue · 2 of 4');
    expect(week().querySelector('.queue__due')!.textContent).toBe('Due Thu 19 Nov');
  });

  it('says "Due today" on its deadline, and is gone the day after', async () => {
    const { unmount } = renderOn(at('2026-11-19'), fakeServer({ assignments: twoWeeks, posts: { ok: true, posts: [] } }));
    await screen.findByRole('region', { name: 'Next up' });
    expect(week().querySelector('.queue__due')!.textContent).toBe('Due today');
    unmount();
    renderOn(at('2026-11-20'), fakeServer({ assignments: twoWeeks, posts: { ok: true, posts: [] } }));
    expect(await screen.findByText('Nothing in your queue')).toBeTruthy();
  });
});

describe('My queue', () => {
  it('puts the next one up on top, then each row with its name, category and status', async () => {
    renderOn(THURSDAY, fakeServer({ assignments: QUEUE, posts: POSTS }));

    const nextUp = await screen.findByRole('region', { name: 'Next up' });
    expect(nextUp.textContent).toContain('Verdant Hills Lot 12, Tagaytay');
    expect(nextUp.textContent).toContain('Condo / house and lot');
    // The next one is the one gold button; it opens from the queue.
    const open = within(nextUp).getByRole('link', { name: /Verdant Hills Lot 12, Tagaytay.*next to post/ });
    expect(open.querySelector('.button--primary')).toBeTruthy();
    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);

    // The rest: pending first, then what is left, then what is done. Last week's item isn't this week's work.
    const rows = Array.from(document.querySelectorAll('.queue__list > li'));
    expect(rows.map((r) => r.querySelector('.queue-item__name')?.textContent)).toEqual([
      'Seaside Residences 2BR, Pasay',
      'Valenzuela Warehouse 1,200 sqm',
      'Kapitolyo Ground Floor Retail, Pasig',
    ]);
    expect(rows.map((r) => r.querySelector('.pill')?.textContent)).toEqual(['Pending', 'Not shared', 'Posted']);
    expect(rows[1]!.textContent).toContain('Warehouse');
    expect(screen.queryByText('BGC Uptown Office 18F, 240 sqm')).toBeNull();

    // The count in the nav: what is left this week.
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /My queue/ }).textContent).toContain(
      '3 left in your queue this week',
    );
  });

  it('opens any row in one click', async () => {
    renderOn(THURSDAY, fakeServer({ assignments: QUEUE, posts: POSTS }));
    await userEvent.click(await screen.findByRole('link', { name: 'Valenzuela Warehouse 1,200 sqm' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
    expect(document.querySelector('.back-link')?.textContent).toBe('My queue');
  });

  it('marks a pending post posted in one click, its link already logged', async () => {
    const withLink = {
      ok: true,
      posts: POSTS.posts.map((p) => (p.status === 'Pending' ? { ...p, postLink: 'https://www.facebook.com/groups/apgmain/posts/2/' } : p)),
    };
    const platform = fakeServer({ assignments: QUEUE, posts: withLink, setStatus: { ok: true } });
    renderOn(THURSDAY, platform);

    await userEvent.click(await screen.findByRole('button', { name: 'Mark Seaside Residences 2BR, Pasay posted' }));
    await waitFor(() => expect(platform.posts.some((p) => p.action === 'setStatus')).toBe(true));
    expect(platform.posts.find((p) => p.action === 'setStatus')?.body).toMatchObject({
      propertyId: '1Seaside',
      property: 'Seaside Residences 2BR, Pasay',
      assignedTo: intern.name,
      status: 'Posted',
    });
    expect(await screen.findByText('Marked posted: Seaside Residences 2BR, Pasay.')).toBeTruthy();
    // The server marks the post itself Posted too: the posts are read again, not only the queue.
    const after = (action: string) =>
      platform.posts.slice(platform.posts.findIndex((p) => p.action === 'setStatus')).some((p) => p.action === action);
    await waitFor(() => expect(after('posts')).toBe(true));
    expect(after('assignments')).toBe(true);
  });

  it('asks an old pending post, logged without a link, for its link first', async () => {
    const platform = fakeServer({ assignments: QUEUE, posts: POSTS, addLink: { ok: true, row: 3 } });
    renderOn(THURSDAY, platform);

    const field = await screen.findByLabelText('Post link');
    await userEvent.type(field, 'https://www.example.com/1');
    await userEvent.click(screen.getByRole('button', { name: 'Mark posted' }));
    expect(await screen.findByText("That isn't a Facebook link.")).toBeTruthy();
    expect(platform.posts.some((p) => p.action === 'addLink')).toBe(false);

    await userEvent.clear(field);
    await userEvent.type(field, 'https://www.facebook.com/groups/apgmain/posts/2/');
    await userEvent.click(screen.getByRole('button', { name: 'Mark posted' }));
    await waitFor(() =>
      expect(platform.posts.find((p) => p.action === 'addLink')?.body).toMatchObject({
        propertyId: '1Seaside',
        postLink: 'https://www.facebook.com/groups/apgmain/posts/2/',
      }),
    );
  });

  it('opens a listing from the queue, and the listing knows it came from there', async () => {
    renderOn(THURSDAY, fakeServer({ assignments: QUEUE, posts: POSTS }));
    await userEvent.click(await screen.findByRole('link', { name: /Verdant Hills Lot 12, Tagaytay/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verdant Hills Lot 12, Tagaytay' })).toBeTruthy();
    expect(document.querySelector('.back-link')?.textContent).toBe('My queue');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /My queue/ }).getAttribute('aria-current')).toBe('page');
  });

  it('shows a long week ten at a time', async () => {
    const forty = Array.from({ length: 40 }, (_, i) => item(`Queue listing ${String(i + 1).padStart(2, '0')}`, `q${i}`, 'Not Shared'));
    renderOn(THURSDAY, fakeServer({ assignments: { ok: true, assignments: forty }, posts: { ok: true, posts: [] } }));
    // None of these is in the property list, so none is "next up": all forty are listed.
    const list = await screen.findByRole('list', { name: 'This queue' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(nav.closest('.pagination')!.textContent).toContain('1–10 of 40');
    await userEvent.click(within(nav).getByRole('button', { name: 'Page 4' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('.queue-item__name')!.textContent)).toEqual([
      'Queue listing 31',
      'Queue listing 32',
      'Queue listing 33',
      'Queue listing 34',
      'Queue listing 35',
      'Queue listing 36',
      'Queue listing 37',
      'Queue listing 38',
      'Queue listing 39',
      'Queue listing 40',
    ]);
    // Numbered as the week is, not from 1 on every page.
    expect(list.getAttribute('start')).toBe('31');
  });

  it('says plainly when nothing is assigned this week', async () => {
    renderOn(THURSDAY, fakeServer());
    expect(await screen.findByText('Nothing in your queue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find a property' })).toBeTruthy();
  });

  it("shows the server's sentence when the queue can't be read", async () => {
    renderOn(
      THURSDAY,
      fakeServer({ assignments: { ok: false, error: 'forbidden', message: 'Your account cannot do that.' } }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Your account cannot do that.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('My queue: highlighted listings (1.1.6)', () => {
  it("tops the page with what the admins highlighted, each with its note and a link to it", async () => {
    const platform = fakeServer({
      assignments: QUEUE,
      posts: POSTS,
      highlights: { ok: true, highlights: [{ propertyId: '1Casa', property: 'Casa Amara House & Lot', note: 'Owner wants it out this week', by: 'Maria Santos', at: '2026-11-04 09:00' }] },
    });
    renderOn(THURSDAY, platform);
    const list = await screen.findByRole('region', { name: 'Highlighted listing' });
    expect(within(list).getByRole('link', { name: 'Casa Amara House & Lot' }).getAttribute('href')).toBe('/property/1Casa');
    expect(within(list).getByText('Owner wants it out this week')).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('shows nothing when none are highlighted, or the list fails', async () => {
    renderOn(THURSDAY, fakeServer({ assignments: QUEUE, posts: POSTS, highlights: { ok: false, error: 'boom' } }));
    await screen.findByText('Verdant Hills Lot 12, Tagaytay');
    expect(screen.queryByRole('region', { name: /highlighted/i })).toBeNull();
  });
});
