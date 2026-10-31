// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { UserFacingError, type PropertyDetail } from '@/core/types';
import { AppStateProvider, DIRECTORY_REFRESH_MS } from './AppState';
import { createRemote } from './remote';
import { createServices, forViewer } from './services';
import { parseSettings } from './settings';
import { CLEAN, EXEC, fakeServer, intern, manager, NOW } from './testing';

const detail: PropertyDetail = {
  id: CLEAN.id,
  name: CLEAN.name,
  category: CLEAN.category,
  listingType: CLEAN.listingType,
  subCategory: CLEAN.subCategory,
  photoCount: 0,
  hasIssues: false,
  publicText: CLEAN.publicText,
  internalText: 'Owner: Mrs. Navarro, 0918 555 0199',
  hasInternal: true,
  cutAt: '--- line',
  issues: '',
  live: true,
  photos: [],
  folder: '',
};

describe('forViewer', () => {
  it('drops the internal section for an intern: absent, not hidden', () => {
    const seen = forViewer(detail, intern);
    expect('internalText' in seen).toBe(false);
    expect(seen.publicText).toBe(CLEAN.publicText);
  });

  it('keeps none of an unseparated document for an intern', () => {
    const seen = forViewer({ ...detail, hasInternal: false, publicText: 'Everything, owner included' }, intern);
    expect(seen.publicText).toBe('');
    expect('internalText' in seen).toBe(false);
  });

  it('gives a manager the whole reply', () => {
    expect(forViewer(detail, manager)).toBe(detail);
  });
});

describe('the shared reads', () => {
  it('share one request, reuse what is fresh enough, and read again once stale', async () => {
    let now = 0;
    let reads = 0;
    const remote = createRemote(async () => ++reads, () => now);
    await Promise.all([remote.load(), remote.load()]);
    expect(reads).toBe(1);

    now = 10_000;
    expect(await remote.load(30_000)).toBe(1);
    expect(await remote.load(5_000)).toBe(2);

    remote.invalidate();
    expect(await remote.load(60_000)).toBe(3);
  });

  it('keep the last good read beside the sentence for a failure', async () => {
    let fail = false;
    const remote = createRemote(async () => {
      if (fail) throw new UserFacingError('Could not reach Google. Check your connection and try again.');
      return 'rows';
    }, () => 0);
    await remote.refresh();
    fail = true;
    await remote.refresh();
    expect(remote.store.get()).toMatchObject({ data: 'rows', error: 'Could not reach Google. Check your connection and try again.' });
  });

  it('read the queue again after every write, so the count in the nav follows', async () => {
    const platform = fakeServer({ logPost: { ok: true, status: 'Posted', date: '2026-10-31', postedBy: intern.name } });
    const services = createServices(platform, () => parseSettings(JSON.stringify({ scriptUrl: EXEC })), () => NOW);
    await services.tracker.logPost({ propertyId: CLEAN.id, propertyName: CLEAN.name, fbAccount: 'APG Main' });
    await waitFor(() => expect(platform.posts.map((p) => p.action)).toEqual(['logPost', 'assignments']));
  });
});

describe('the property list', () => {
  afterEach(() => vi.useRealTimers());

  it('is read on sign-in and again every 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = NOW;
    const platform = fakeServer();
    render(<AppStateProvider platform={platform} initialUser={intern} initialSettings={{ scriptUrl: EXEC }} now={() => now} />);
    const reads = () => platform.posts.filter((p) => p.action === 'properties').length;
    // vi.waitFor polls on real timers: these intervals are fake.
    await vi.waitFor(() => expect(reads()).toBe(1));

    now += 14 * 60_000;
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(reads()).toBe(1);

    now += DIRECTORY_REFRESH_MS;
    await act(async () => void vi.advanceTimersByTime(60_000));
    await vi.waitFor(() => expect(reads()).toBe(2));
  });
});

describe('settings', () => {
  it('fall back to the defaults for anything missing or damaged, and never hold a key', () => {
    expect(parseSettings('{"scriptUrl":" https://x/exec ","cooldownDays":"7","scriptKey":"secret"}')).toEqual({
      scriptUrl: 'https://x/exec',
      cooldownDays: 7,
      repostDueDays: 14,
    });
    expect(parseSettings('not json')).toEqual({ scriptUrl: '', cooldownDays: 7, repostDueDays: 14 });
  });
});
