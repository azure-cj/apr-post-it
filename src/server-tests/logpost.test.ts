/**
 * logPost under CONTRACT-v3: every post is logged with its Facebook link and
 * an explicit status, and an admin logging on someone's behalf is held to that
 * person's Team row, not their own.
 */

import { describe, expect, it } from 'vitest';
import { isFacebookPostLink, postLinkProblem } from '../core/links';
import { CASA, createWorld, TOWER } from './world';

describe('the post link is required, and must be Facebook\'s', () => {
  it.each([[''], ['   '], [undefined], [null]])('refuses a missing link (%j) as link-required, and writes nothing', (postLink) => {
    const w = createWorld();
    const reply = w.logPost('jan', CASA, { postLink });

    expect(reply).toMatchObject({ ok: false, error: 'link-required' });
    expect(reply['message']).toEqual(expect.any(String));
    expect(String(reply['message']).length).toBeLessThan(80);
    expect(w.posts.lastRow).toBe(1);
  });

  it.each([
    ['https://www.facebook.com/groups/apg/posts/1/'],
    ['https://facebook.com/groups/apg/posts/1/'],
    ['https://m.facebook.com/story.php?story_fbid=1&id=2'],
    ['https://web.facebook.com/groups/apg/permalink/3/'],
    ['https://fb.com/groups/apg/posts/1'],
    ['https://fb.me/abc123'],
    ['HTTPS://WWW.FACEBOOK.COM/groups/apg/posts/1/'],
    ['https://www.facebook.com'],
  ])('accepts %s', (postLink) => {
    const w = createWorld();

    expect(w.logPost('jan', CASA, { postLink })).toMatchObject({ ok: true, status: 'Posted' });
  });

  it('tolerates spaces around the link, and writes it trimmed', () => {
    const w = createWorld();

    expect(w.logPost('jan', CASA, { postLink: '  https://www.facebook.com/groups/apg/posts/9/ \n' })).toMatchObject({ ok: true });
    expect(w.posts.row(2)[6]).toBe('https://www.facebook.com/groups/apg/posts/9/');
  });

  it.each([
    ['http://www.facebook.com/groups/apg/posts/1/', 'not https'],
    ['www.facebook.com/groups/apg/posts/1/', 'no scheme'],
    ['https://facebook.com.evil.example/posts/1', 'a look-alike host'],
    ['https://evil.example/facebook.com/posts/1', 'facebook.com in the path'],
    ['https://www.facebook.com@evil.example/posts/1', 'facebook.com as the user name'],
    ['https://www.facebook.com:8443/posts/1', 'another port'],
    ['https://business.facebook.com/posts/1', 'another facebook.com host'],
    ['https://www.instagram.com/p/1/', 'another site'],
    ['+63 917 123 4567', 'a phone number'],
    ['https://www.facebook.com/groups/apg/posts/1/ and more', 'text after the link'],
    ['javascript:alert(1)', 'a script'],
  ])('refuses %s (%s) as bad-link, and writes nothing', (postLink) => {
    const w = createWorld();
    const reply = w.logPost('jan', CASA, { postLink });

    expect(reply).toMatchObject({ ok: false, error: 'bad-link', message: expect.any(String) });
    expect(w.posts.lastRow).toBe(1);
  });
});

describe('the server and the app (core/links.ts) agree on a link', () => {
  it.each([
    ['https://www.facebook.com/groups/apg/posts/1/'],
    ['https://m.facebook.com/story.php?story_fbid=1&id=2'],
    ['  https://fb.me/abc  '],
    ['https://FB.com/x'],
    ['http://www.facebook.com/groups/apg/posts/1/'],
    ['https://facebook.com.evil.example/posts/1'],
    ['https://www.facebook.com@evil.example/posts/1'],
    ['https://business.facebook.com/posts/1'],
    ['facebook.com/posts/1'],
    ['https://www.facebook.com/a b'],
    [''],
    ['https://www.facebook.com:8443/posts/1'],
    ['https://www.facebook.com:443/posts/1'],
    ['https://u@www.facebook.com/posts/1'],
    ['https://u:p@www.facebook.com/posts/1'],
    ['https://www.facebook.com\\evil.example/posts/1'],
    ['https://www.facebook.com./posts/1'],
    ['https://www.facebook.com?x=1'],
    ['https://www.facebook.com#top'],
    ['https://www.facebook.com'],
    ['https://WWW.Facebook.COM/x'],
    ['https:/www.facebook.com/x'],
  ])('%j', (postLink) => {
    const w = createWorld();
    const reply = w.logPost('jan', CASA, { postLink });

    expect(reply['ok'], 'accepted').toBe(isFacebookPostLink(postLink));
    if (reply['ok'] !== true) expect(reply['message']).toBe(postLinkProblem(postLink));
  });
});

describe('the status is required: Posted or Pending', () => {
  it.each([['Posted'], ['Pending']])('writes %s as sent, with the link', (status) => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);

    expect(w.logPost('jan', CASA, { status })).toMatchObject({ ok: true, status });
    expect(w.posts.row(2).slice(4, 7)).toEqual([status, 'APG Main', 'https://www.facebook.com/groups/apg/posts/1/']);
    // The queue item follows, as before.
    expect(w.assignments.row(2)[3]).toBe(status);
  });

  it.each([[undefined], [''], ['posted'], ['PENDING'], ['Done'], ['To post'], [true]])(
    'refuses %j as bad-status, and writes nothing',
    (status) => {
      const w = createWorld();
      const reply = w.logPost('jan', CASA, { status });

      expect(reply).toMatchObject({ ok: false, error: 'bad-status', message: expect.any(String) });
      expect(w.posts.lastRow).toBe(1);
    },
  );

  it('checks the link before the status, and both before the cooldown', () => {
    const w = createWorld();
    w.logPost('ana', CASA);

    expect(w.logPost('jan', CASA, { postLink: '', status: 'Nope' })).toMatchObject({ error: 'link-required' });
    expect(w.logPost('jan', CASA, { status: 'Nope' })).toMatchObject({ error: 'bad-status' });
    expect(w.logPost('jan', CASA)).toMatchObject({ error: 'cooldown' });
  });
});

describe('posting on behalf of someone', () => {
  it('credits the named person, as the Team tab spells the name', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);

    expect(w.logPost('maria', CASA, { postedBy: '  jan dela cruz ' })).toMatchObject({ ok: true, postedBy: 'Jan Dela Cruz' });
    expect(w.posts.row(2)[7]).toBe('Jan Dela Cruz');
    expect(w.assignments.row(2)[3]).toBe('Posted');
  });

  it('refuses a name not on the Team tab', () => {
    const w = createWorld();
    const reply = w.logPost('maria', CASA, { postedBy: 'Nobody Here' });

    expect(reply).toMatchObject({ ok: false, error: 'unknown-person' });
    expect(reply['message']).toContain('Nobody Here');
    expect(w.posts.lastRow).toBe(1);
  });

  it('refuses a person who has been deactivated', () => {
    const w = createWorld();

    expect(w.logPost('maria', CASA, { postedBy: 'Former Intern' })).toMatchObject({ ok: false, error: 'unknown-person' });
    expect(w.posts.lastRow).toBe(1);
  });

  it('holds the account to THAT person\'s list, not the admin\'s', () => {
    const w = createWorld();
    // Maria has no list (any account); Jan has APG Main and APG Rentals.
    const reply = w.logPost('maria', CASA, { postedBy: 'Jan Dela Cruz', fbAccount: 'Maria\'s Page' });

    expect(reply).toMatchObject({ ok: false, error: 'forbidden', message: 'Jan Dela Cruz is not assigned to Maria\'s Page.' });
    expect(w.posts.lastRow).toBe(1);
    expect(w.logPost('maria', TOWER, { postedBy: 'Jan Dela Cruz', fbAccount: 'APG Rentals' })).toMatchObject({ ok: true });
  });

  it('allows any account for a person with no list', () => {
    const w = createWorld();

    expect(w.logPost('maria', CASA, { postedBy: 'Ana Reyes', fbAccount: 'Anything At All' })).toMatchObject({
      ok: true,
      postedBy: 'Ana Reyes',
    });
  });

  it('is ignored from an intern, who is still held to their own list', () => {
    const w = createWorld();

    expect(w.logPost('jan', CASA, { postedBy: 'Nobody Here' })).toMatchObject({ ok: true, postedBy: 'Jan Dela Cruz' });
    expect(w.logPost('ana', TOWER, { postedBy: 'Jan Dela Cruz', fbAccount: 'Ana\'s Page' })).toMatchObject({
      ok: true,
      postedBy: 'Ana Reyes',
    });
  });

  it('stops working for a person the moment the app deactivates them', () => {
    const w = createWorld();
    expect(w.call('maria', 'team')).toMatchObject({ ok: true }); // the Team tab is now cached
    expect(w.call('maria', 'setActive', { name: 'Ana Reyes', active: false })).toMatchObject({ ok: true });

    expect(w.logPost('maria', CASA, { postedBy: 'Ana Reyes' })).toMatchObject({ ok: false, error: 'unknown-person' });
  });
});
