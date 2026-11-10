import { describe, expect, it } from 'vitest';
import { BackendError } from './backend';
import { refusedWords } from './outbox';
import { openRefused, readReportedPost, type ReportedPost } from './refused';

const ROW = {
  postKey: 'Groups/APG/posts/900',
  link: 'https://www.facebook.com/groups/apg/posts/900/',
  agent: 'Jan Dela Cruz',
  loggedAt: '2026-03-10T14:10:00+08:00',
  property: 'Casa Amara',
  propertyId: '1Casa',
  fbAccount: 'APG Main',
  lastPosted: '2026-03-10',
  lastPostedBy: 'Ana Reyes',
  nextAllowed: '2026-03-17',
  handledBy: '',
  handledAt: '',
};

describe('readReportedPost', () => {
  it('reads a row, its key in lower case', () => {
    expect(readReportedPost(ROW)).toEqual({ ...ROW, postKey: 'groups/apg/posts/900' });
  });

  it('drops a row without a post or a link, and anything not a row', () => {
    expect(readReportedPost({ ...ROW, postKey: ' ' })).toBeNull();
    expect(readReportedPost({ ...ROW, link: '' })).toBeNull();
    expect(readReportedPost('row')).toBeNull();
  });

  it('reads a missing field as blank', () => {
    expect(readReportedPost({ postKey: 'story/1', link: ROW.link })).toMatchObject({ agent: '', handledBy: '', nextAllowed: '' });
  });
});

describe('openRefused', () => {
  it('leaves out the handled ones, newest first', () => {
    const at = (loggedAt: string, handledBy = ''): ReportedPost => ({ ...ROW, postKey: loggedAt, loggedAt, handledBy });
    const list = [at('2026-03-09T10:00:00+08:00'), at('2026-03-10T10:00:00+08:00', 'Maria Santos'), at('2026-03-11T10:00:00+08:00')];
    expect(openRefused(list).map((p) => p.loggedAt)).toEqual(['2026-03-11T10:00:00+08:00', '2026-03-09T10:00:00+08:00']);
  });
});

describe('refusedWords', () => {
  const cooldown = (reported: boolean) =>
    new BackendError('cooldown', 'logPost', 'Posted today (10 Mar).', { nextAllowed: '2026-03-17', reported });

  it("asks the agent to tell the admin when the web app didn't", () => {
    expect(refusedWords(cooldown(false), 'Posted today (10 Mar).')).toBe(
      'Posted today (10 Mar). This post is on Facebook but not on the tracker: tell your admin.',
    );
  });

  it("keeps the web app's words when it told the admin, and any other refusal's", () => {
    expect(refusedWords(cooldown(true), 'Your admin has been told.')).toBe('Your admin has been told.');
    expect(refusedWords(new BackendError('forbidden', 'logPost', 'Not yours.'), 'Not yours.')).toBe('Not yours.');
  });
});
