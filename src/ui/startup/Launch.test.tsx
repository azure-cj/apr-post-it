// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPECTED_SERVER_VERSION } from '@/config';
import { CACHE_KEY } from '@/core/directory';
import { createFakePlatform, type FakeReply } from '@/platform/fake';
import { AppShell, routerFuture } from '../App';
import { AppStateProvider, useApp } from '../state';
import { EXEC, NOW } from '../state/testing';
import { FADE_MS, Launch, MAX_MS, MIN_MS } from './Launch';
import { drawMap } from './StartupMap';

const KEPT_SETTINGS = JSON.stringify({ scriptUrl: EXEC });
const PING_ADMIN = { ok: true, name: 'Maria Santos', role: 'Admin', fbAccounts: [], version: EXPECTED_SERVER_VERSION };
const PING_INTERN = { ok: true, name: 'Jan Dela Cruz', role: 'Intern', fbAccounts: ['APG Main'], version: EXPECTED_SERVER_VERSION };

const LISTINGS = [
  { id: 'A', name: 'Office, Makati', category: 'OFFICE SPACE', listingType: '', subCategory: '', photoCount: 1, hasIssues: false, lat: 14.55, lng: 121.02 },
  { id: 'B', name: 'Warehouse, Valenzuela', category: 'WAREHOUSE', listingType: '', subCategory: '', photoCount: 1, hasIssues: false, lat: 14.7, lng: 120.98 },
  { id: 'C', name: 'Condo, Cebu', category: 'CONDO / HOUSE AND LOT', listingType: '', subCategory: '', photoCount: 1, hasIssues: false, lat: 10.31, lng: 123.88 },
];
const PROPERTIES = { ok: true, properties: LISTINGS };
const SAVED_LIST = JSON.stringify({ v: 1, fetchedAt: NOW - 86_400_000, properties: LISTINGS });

const post = (date: string, status: 'Posted' | 'Pending', postedBy: string) => ({
  date, status, postedBy, time: '10:00', type: 'Warehouse', title: 'x', fbAccount: 'APG Main', postLink: 'https://www.facebook.com/x', propertyId: 'A',
});
// NOW is Sat 31 Oct 2026, 10:00 in Manila: yesterday is the 30th.
const POSTS = {
  ok: true,
  posts: [
    post('2026-10-30', 'Posted', 'Jan Dela Cruz'),
    post('2026-10-30', 'Posted', 'Paolo Reyes'),
    post('2026-10-30', 'Posted', 'Paolo Reyes'),
    post('2026-10-31', 'Pending', 'Jan Dela Cruz'),
  ],
};
const QUEUE = {
  ok: true,
  assignments: [
    { date: '2026-10-31', assignedTo: 'Jan Dela Cruz', propertyName: 'Office, Makati', propertyId: 'A', status: 'Not Shared' },
    { date: '2026-10-31', assignedTo: 'Jan Dela Cruz', propertyName: 'Condo, Cebu', propertyId: 'C', status: 'Not Shared' },
    { date: '2026-10-31', assignedTo: 'Jan Dela Cruz', propertyName: 'Warehouse, Valenzuela', propertyId: 'B', status: 'Posted' },
  ],
};

interface LaunchOptions {
  readonly key?: string | null;
  readonly replies?: Readonly<Record<string, FakeReply>>;
  readonly savedList?: boolean;
  readonly now?: number;
}

/** The window as it opens, startup screen and all. */
function launch({ key = 'test-key', replies = {}, savedList = false, now = NOW }: LaunchOptions = {}) {
  const platform = createFakePlatform({
    key,
    hasFileSystem: true,
    local: { 'postit.settings': KEPT_SETTINGS, ...(savedList ? { [CACHE_KEY]: SAVED_LIST } : {}) },
    replies: { ping: PING_ADMIN, properties: PROPERTIES, posts: POSTS, assignments: QUEUE, team: { ok: true, team: [] }, ...replies },
  });
  let app: ReturnType<typeof useApp> | null = null;
  function Spy() {
    app = useApp();
    return null;
  }
  render(
    <AppStateProvider platform={platform} now={() => now}>
      <Spy />
      <MemoryRouter initialEntries={['/']} future={routerFuture}>
        <Launch>
          <AppShell />
        </Launch>
      </MemoryRouter>
    </AppStateProvider>,
  );
  return { platform, app: () => app! };
}

const startup = () => screen.queryByRole('dialog', { name: 'APG Post-It' });
const lines = () => within(within(startup()!).getByRole('status')).getAllByRole('listitem').map((li) => li.textContent?.replace(/^[✓●✗]/, ''));
const cards = () =>
  within(startup()!)
    .queryAllByRole('listitem')
    .filter((li) => li.classList.contains('startup__stat'))
    .map((li) => li.textContent);

/**
 * Lets the fake server answer and the timers run, `ms` of them. In steps, so
 * React commits between them and a timer an effect sets on the way is run too.
 */
async function wait(ms: number) {
  let left = ms;
  do {
    const step = Math.min(left, 50);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    left -= step;
  } while (left > 0);
}

let reduced = false;
const arcs: number[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  reduced = false;
  arcs.length = 0;
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('reduced-motion') ? reduced : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  // jsdom draws nothing: a canvas whose context counts the dots, at the size of the map at 1366×768.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function fake() {
    return fakeContext() as unknown as RenderingContext;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 683, height: 745 } as DOMRect);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fakeContext() {
  let drawn = 0;
  return {
    clearRect: () => {
      if (drawn) arcs.push(drawn);
      drawn = 0;
    },
    setTransform: () => undefined,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    fillRect: () => undefined,
    beginPath: () => undefined,
    arc: () => {
      drawn++;
    },
    fill: () => undefined,
    set fillStyle(_v: unknown) {},
    set globalAlpha(_v: unknown) {},
    get drawn() {
      return drawn;
    },
  };
}

describe('the startup screen', () => {
  it('shows on launch, then crossfades to sign-in when nobody is signed in', async () => {
    launch({ key: null });
    expect(startup()).toBeTruthy();
    await wait(0);
    expect(lines()).toEqual(['Not signed in']);
    // No greeting without a name.
    expect(screen.queryByText(/^Good (morning|afternoon|evening)/)).toBeNull();

    await wait(MIN_MS);
    expect(startup()?.hasAttribute('data-leaving')).toBe(true);
    await wait(FADE_MS);
    expect(startup()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    // Focus lands where sign-in would have put it: the first field to type in.
    expect(document.activeElement).toBe(screen.getByLabelText('Web app link'));
  });

  it('goes to the home screen when the kept key signs someone in', async () => {
    launch();
    await wait(0);
    expect(lines()).toEqual(['Signed in as Maria Santos', 'Web app up to date', '3 listings ready']);

    await wait(MIN_MS + FADE_MS);
    expect(startup()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Tracker' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Tracker' }));
  });

  it('keeps the app beneath it out of reach until it has gone', async () => {
    const { container } = { container: document.body };
    launch({ key: null });
    await wait(0);
    expect(container.querySelector('.startup-host')?.hasAttribute('inert')).toBe(true);
    await wait(MIN_MS + FADE_MS);
    expect(container.querySelector('.startup-host')?.hasAttribute('inert')).toBe(false);
  });

  it('stays at least 1.2 s, even when everything is ready at once', async () => {
    launch();
    await wait(MIN_MS - 1);
    expect(startup()?.hasAttribute('data-leaving')).toBe(false);
    await wait(1);
    expect(startup()?.hasAttribute('data-leaving')).toBe(true);
  });

  it('leaves at 8 s whatever is still loading, and the app carries on', async () => {
    launch({ replies: { properties: () => new Promise(() => undefined) } });
    await wait(0);
    expect(lines()).toContain('Loading listings…');

    await wait(MAX_MS - 1);
    expect(startup()?.hasAttribute('data-leaving')).toBe(false);
    await wait(1);
    expect(startup()?.hasAttribute('data-leaving')).toBe(true);
    await wait(FADE_MS);
    expect(startup()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Tracker' })).toBeTruthy();
  });

  it('waits for sign-in past the minimum, up to the maximum', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    launch({ replies: { ping: () => new Promise((resolve) => (answer = resolve)) } });
    await wait(0);
    expect(lines()).toEqual(['Signing in…']);
    await wait(3000);
    expect(startup()?.hasAttribute('data-leaving')).toBe(false);

    answer(PING_ADMIN);
    await wait(0);
    expect(startup()?.hasAttribute('data-leaving')).toBe(true);
  });

  it.each([
    ['Escape', { key: 'Escape' }],
    ['Enter', { key: 'Enter' }],
    ['a letter', { key: 'k' }],
  ])('skips on %s, and the key goes no further', async (_label, key) => {
    launch({ replies: { ping: () => new Promise(() => undefined) } });
    await wait(0);
    const event = new KeyboardEvent('keydown', { ...key, bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    await wait(FADE_MS);
    expect(startup()).toBeNull();
  });

  it('skips on a click', async () => {
    launch({ replies: { ping: () => new Promise(() => undefined) } });
    await wait(0);
    fireEvent.click(startup()!);
    await wait(FADE_MS);
    expect(startup()).toBeNull();
  });

  it('does not show again after signing out and in', async () => {
    const { app } = launch();
    await wait(MIN_MS + FADE_MS);
    expect(startup()).toBeNull();

    await act(async () => {
      await app().signOut();
    });
    await act(async () => {
      await app().signIn(EXEC, 'test-key');
    });
    await wait(MAX_MS);
    expect(startup()).toBeNull();
  });
});

describe('what it says when something goes wrong', () => {
  it('says an older web app is behind, to an admin with where to fix it, and goes on', async () => {
    launch({ replies: { ping: { ...PING_ADMIN, version: '2020-01-01.1' } } });
    await wait(0);
    expect(lines()).toContain('Web app is behind: update it in Settings → App');
    expect(screen.getByText('Web app is behind: update it in Settings → App').closest('li')?.dataset['tone']).toBe('fail');
    await wait(MIN_MS + FADE_MS);
    expect(startup()).toBeNull();
  });

  it('tells an intern to ask their admin instead', async () => {
    launch({ replies: { ping: { ...PING_INTERN, version: '' } } });
    await wait(0);
    expect(lines()).toContain('Web app is behind: tell your admin');
  });

  it("uses the saved listings when Google can't be reached", async () => {
    launch({ savedList: true, replies: { properties: new TypeError('Failed to fetch') } });
    await wait(0);
    expect(lines()).toContain("Couldn't reach Google, using saved listings");
    await wait(MIN_MS + FADE_MS);
    expect(startup()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Tracker' })).toBeTruthy();
  });

  it("says when the kept key couldn't be checked, and goes on to say why", async () => {
    launch({ replies: { ping: new TypeError('Failed to fetch') } });
    await wait(0);
    expect(lines()[0]).toBe("Couldn't sign you in");
    await wait(MIN_MS + FADE_MS);
    expect(screen.getByRole('heading', { level: 1, name: "Couldn't sign you in" })).toBeTruthy();
  });
});

describe('the numbers and the greeting', () => {
  it("gives an admin the listings, everyone's posts yesterday, and pending", async () => {
    launch();
    await wait(0);
    expect(cards()).toEqual(['3listings', '3posted yesterday', '1pending']);
    expect(screen.getByText('Good morning, Maria')).toBeTruthy();
    expect(screen.getByText('Saturday, 31 October')).toBeTruthy();
  });

  it("gives an intern their queue today, and their own posts yesterday and pending", async () => {
    launch({ replies: { ping: PING_INTERN, posts: { ok: true, posts: POSTS.posts.filter((p) => p.postedBy === 'Jan Dela Cruz') } } });
    await wait(0);
    expect(cards()).toEqual(['2in your queue today', '1posted yesterday', '1pending']);
    expect(screen.getByText('Good morning, Jan')).toBeTruthy();
  });

  it('greets by the time of day in Manila', async () => {
    launch({ now: Date.parse('2026-11-01T19:30:00+08:00') });
    await wait(0);
    expect(screen.getByText('Good evening, Maria')).toBeTruthy();
    expect(screen.getByText('Sunday, 1 November')).toBeTruthy();
  });

  it('shows nobody signed in only the saved listings: no greeting, no web app line', async () => {
    launch({ key: null, savedList: true });
    await wait(0);
    expect(lines()).toEqual(['Not signed in', '3 listings ready']);
    expect(cards()).toEqual(['3listings']);
    expect(screen.queryByText(/^Good /)).toBeNull();
    expect(screen.getByText('3 listings on the map')).toBeTruthy();
  });

  it('shows no cards and no map with nobody signed in and nothing saved', async () => {
    launch({ key: null });
    await wait(0);
    expect(cards()).toEqual([]);
    expect(document.querySelector('canvas')).toBeNull();
  });
});

describe('the map', () => {
  it('cascades the dots in rather than drawing them all at once', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    launch({ savedList: true, key: null });
    await wait(0);
    expect(document.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(frames.length).toBeGreaterThan(0); // more frames to come
  });

  it('with reduced motion, draws every dot at once', async () => {
    reduced = true;
    const frames = vi.spyOn(window, 'requestAnimationFrame');
    launch({ savedList: true, key: null });
    await wait(0);
    const ctx = (HTMLCanvasElement.prototype.getContext as unknown as { mock: { results: { value: { drawn: number } }[] } }).mock
      .results.at(-1)!.value;
    expect(ctx.drawn).toBe(3);
    expect(frames).not.toHaveBeenCalled();
  });

  it('draws only the dots that have started arriving, partway through the cascade', () => {
    const ctx = fakeContext();
    const points = [0, 0.5, 0.99].map((delay, i) => ({ id: String(i), lat: 14.5, lng: 121, size: 0.5, opacity: 0.8, delay }));
    expect(drawMap(ctx as unknown as CanvasRenderingContext2D, points, 683, 745, 0, { dot: '#e0b84a' })).toBe(0);
    expect(drawMap(ctx as unknown as CanvasRenderingContext2D, points, 683, 745, 400, { dot: '#e0b84a' })).toBe(2);
    expect(drawMap(ctx as unknown as CanvasRenderingContext2D, points, 683, 745, Infinity, { dot: '#e0b84a' })).toBe(3);
  });
});
