/**
 * The transport, against a scripted `post`. Nothing here touches the network:
 * the point is that the key travels in the body, and that every way a call can
 * fail reaches the person as a sentence rather than an HTTP code.
 *
 * The C# acceptance tests (ScriptBackendTests.cs) that are about the transport
 * are ported here; the ones about mapping live beside directory, tracker and
 * session.
 */

import type { Platform } from '../platform';
import {
  BackendError,
  asList,
  asRecord,
  asText,
  createBackend,
  type BackendDeps,
  type BackendErrorCode,
} from './backend';
import { UserFacingError } from './types';

const EXEC = 'https://script.google.com/macros/s/AKfy/exec';

type Wire = Record<string, unknown>;
type Scripted = unknown | ((body: Wire) => unknown);

/** A post that answers from a script — the last reply repeats — and keeps what was sent, as JSON would carry it. */
function scripted(...replies: Scripted[]) {
  const sent: { url: string; body: Wire }[] = [];
  const queue = [...replies];
  const post = async (url: string, body: unknown): Promise<unknown> => {
    const wire = JSON.parse(JSON.stringify(body)) as Wire;
    sent.push({ url, body: wire });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const reply = typeof next === 'function' ? (next as (b: Wire) => unknown)(wire) : next;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { post, sent };
}

function backendOver(post: BackendDeps['post'], key = 'testkey', url = EXEC, timeoutMs?: number) {
  return createBackend({ post, getConfig: () => ({ url, key }), ...(timeoutMs ? { timeoutMs } : {}) });
}

async function failure(p: Promise<unknown>, code?: BackendErrorCode): Promise<BackendError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err).toBeInstanceOf(BackendError);
    const error = err as BackendError;
    if (code) expect(error.code).toBe(code);
    return error;
  }
  throw new Error('expected the call to fail');
}

// Compile-time: the platform's post is exactly what the backend takes.
const _platformFits: BackendDeps['post'] = ({} as Platform).post;
void _platformFits;

// ------------------------------------------------------------------ before any request

describe('before any request', () => {
  it('without a url and key it says so before calling anything', async () => {
    const { post, sent } = scripted({ ok: true });
    const error = await failure(createBackend({ post, getConfig: () => ({ url: '', key: '' }) }).call('posts'), 'not-configured');

    expect(error.message).toContain('Settings');
    expect(sent).toHaveLength(0);
  });

  it('names which one is missing, and counts blanks and nulls as missing', async () => {
    const { post, sent } = scripted({ ok: true });
    const noKey = await failure(createBackend({ post, getConfig: () => ({ url: EXEC, key: '   ' }) }).call('ping'));
    const noUrl = await failure(createBackend({ post, getConfig: () => ({ url: null, key: 'k' }) }).call('ping'));
    const neither = await failure(createBackend({ post, getConfig: () => ({}) }).call('ping'));

    expect(noKey.message).toBe('Post-It does not have your key yet. Add the key your admin gave you in Settings.');
    expect(noUrl.message).toBe('Post-It does not have the web app link yet. Add it in Settings.');
    expect(neither.message).toBe('Post-It is not connected yet. Add the web app link and your key in Settings.');
    expect(sent).toHaveLength(0);
  });

  it('refuses a link that is not a web address, without sending', async () => {
    const { post, sent } = scripted({ ok: true });
    const error = await failure(backendOver(post, 'k', 'script.google.com/macros/s/AKfy/exec').call('ping'), 'bad-url');

    expect(error.message).toContain('not a complete web address');
    expect(sent).toHaveLength(0);
  });

  it('a settings store that cannot be read is a sentence, not a crash', async () => {
    const { post, sent } = scripted({ ok: true });
    const backend = createBackend({
      post,
      getConfig: () => Promise.reject(new Error('keychain locked')),
    });
    const error = await failure(backend.call('ping'), 'not-configured');

    expect(error.message).toContain('could not read');
    expect(error.cause).toBeInstanceOf(Error);
    expect(sent).toHaveLength(0);
  });

  it('reads the link and key on every call, so a change in Settings applies at once', async () => {
    const { post, sent } = scripted({ ok: true });
    let key = 'first';
    const backend = createBackend({ post, getConfig: async () => ({ url: ` ${EXEC} `, key }) });

    await backend.call('ping');
    key = 'second';
    await backend.call('ping');

    expect(sent.map((s) => s.body['key'])).toEqual(['first', 'second']);
    expect(sent[0]!.url).toBe(EXEC); // trimmed
  });

  it('says whether it is configured without making a request', async () => {
    const { post, sent } = scripted({ ok: true });

    expect(await backendOver(post).isConfigured()).toBe(true);
    expect(await createBackend({ post, getConfig: () => ({ url: EXEC, key: ' ' }) }).isConfigured()).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the key travels safely

describe('the key', () => {
  it('goes in the body, never in a header or the address', async () => {
    // .NET dropped custom headers across the redirect Apps Script performs, and
    // the post function has no headers to put it in at all. The address would
    // end up in logs.
    const { post, sent } = scripted({ ok: true, posts: [] });
    await backendOver(post, 's3cret').call('posts');

    expect(sent[0]!.body['key']).toBe('s3cret');
    expect(sent[0]!.body['action']).toBe('posts');
    expect(sent[0]!.url).toBe(EXEC);
    expect(sent[0]!.url).not.toContain('s3cret');
  });

  it('cannot be replaced by the payload, and neither can the action', async () => {
    const { post, sent } = scripted({ ok: true });
    await backendOver(post, 'mine').call('logPost', { key: 'someone-elses', action: 'saveQueue', property: 'Casa Amara' });

    expect(sent[0]!.body).toEqual({ property: 'Casa Amara', action: 'logPost', key: 'mine' });
  });

  it('leaves undefined fields out of the body', async () => {
    const { post, sent } = scripted({ ok: true });
    await backendOver(post).call('property', { id: '1AbC', extra: undefined });

    expect(Object.keys(sent[0]!.body).sort()).toEqual(['action', 'id', 'key']);
  });

  it('has a fingerprint that tells people apart without holding the key', async () => {
    const { post, sent } = scripted({ ok: true });
    const jan = await backendOver(post, 'jan-key-0123456789').identity();
    const janAgain = await backendOver(post, 'jan-key-0123456789').identity();
    const maria = await backendOver(post, 'maria-key-0123456789').identity();
    const otherDeployment = await backendOver(post, 'jan-key-0123456789', `${EXEC}2`).identity();
    const nobody = await createBackend({ post, getConfig: () => ({ url: EXEC, key: '' }) }).identity();

    expect(jan).toBe(janAgain);
    expect(jan).not.toBe(maria);
    expect(jan).not.toBe(otherDeployment);
    expect(jan).not.toContain('jan-key');
    expect(jan).toMatch(/^[0-9a-f]{16}-\d+$/);
    expect(nobody).toBe('');
    expect(sent).toHaveLength(0);
  });

  it('has an identity that stays put for one person and moves if anyone else was seen meanwhile', async () => {
    // A manager's key used for one call in between must not look like
    // "the intern throughout": what that call fetched was the manager's.
    const { post } = scripted({ ok: true });
    let key = 'intern-key';
    const backend = createBackend({ post, getConfig: () => ({ url: EXEC, key }) });

    const before = await backend.identity();
    await backend.call('ping');
    expect(await backend.identity()).toBe(before);

    key = 'manager-key';
    await backend.call('ping');
    key = 'intern-key';
    expect(await backend.identity()).not.toBe(before);
  });
});

// ------------------------------------------------------------------ refusals reach the person

describe('a refusal from the server', () => {
  it('arrives, for a cooldown, as the server\'s own sentence, with its dates', async () => {
    const { post } = scripted({
      ok: false,
      error: 'cooldown',
      lastPosted: '2026-01-01',
      nextAllowed: '2026-01-08',
      message: 'Posted 2 day(s) ago. Next allowed Jan 8.',
    });
    const error = await failure(backendOver(post).call('logPost', { property: 'Casa Amara' }), 'cooldown');

    expect(error.message).toBe('Posted 2 day(s) ago. Next allowed Jan 8.');
    expect(error.lastPosted).toBe('2026-01-01');
    expect(error.nextAllowed).toBe('2026-01-08');
    expect(error.action).toBe('logPost');
  });

  it('for a cooldown without a message, still names the next allowed date', async () => {
    const { post } = scripted({ ok: false, error: 'cooldown', nextAllowed: '2026-01-08' });
    const error = await failure(backendOver(post).call('logPost'), 'cooldown');

    expect(error.message).toBe('This property was posted too recently. It can be posted again on 2026-01-08.');
  });

  it('for a held listing, names the first and who has it, and carries every item', async () => {
    const { post } = scripted({
      ok: false,
      error: 'held',
      message: 'Casa Amara is already with Ana Reyes (queue for 2026-03-08). Remove it from their queue first.',
      held: [
        { propertyName: 'Casa Amara', propertyId: 'F1', heldBy: 'Ana Reyes', date: '2026-03-08' },
        { propertyName: '1201', propertyId: '', heldBy: 'Jan Dela Cruz', date: '2026-03-10' },
        { propertyName: 'No holder' },
        'junk',
      ],
    });
    const error = await failure(backendOver(post).call('saveQueues', { date: '2026-03-09' }), 'held');

    expect(error.message).toBe('Casa Amara is already with Ana Reyes. Remove it from their queue first.');
    // A server before v6 sends no week: the date's (Sunday 8 Mar belongs to the week of 9 Mar).
    expect(error.held).toEqual([
      { propertyName: 'Casa Amara', propertyId: 'F1', heldBy: 'Ana Reyes', date: '2026-03-08', week: '2026-03-09' },
      { propertyName: '1201', propertyId: '', heldBy: 'Jan Dela Cruz', date: '2026-03-10', week: '2026-03-09' },
    ]);
  });

  it('for a held listing, takes the server\'s week (v6)', async () => {
    const { post } = scripted({
      ok: false,
      error: 'held',
      held: [{ propertyName: 'Casa Amara', propertyId: 'F1', heldBy: 'Ana Reyes', date: '2026-03-16', week: '2026-03-16' }],
    });
    const error = await failure(backendOver(post).call('saveQueues', { week: '2026-03-09' }), 'held');
    expect(error.held).toEqual([
      { propertyName: 'Casa Amara', propertyId: 'F1', heldBy: 'Ana Reyes', date: '2026-03-16', week: '2026-03-16' },
    ]);
  });

  it('for a bad week, says to pick a Monday', async () => {
    const error = await failure(backendOver(scripted({ ok: false, error: 'bad-week', message: 'x' }).post).call('saveQueue'), 'bad-week');
    expect(error.message).toBe('Pick a week: its Monday, written yyyy-MM-dd.');
  });

  it('for a held listing with no list, keeps a sentence; other refusals carry no held items', async () => {
    const error = await failure(backendOver(scripted({ ok: false, error: 'held' }).post).call('saveQueue'), 'held');
    expect(error.message).toMatch(/already in another intern's queue/);
    expect(error.held).toEqual([]);

    const other = await failure(backendOver(scripted({ ok: false, error: 'busy' }).post).call('saveQueue'), 'busy');
    expect(other.held).toEqual([]);
  });

  it('for an unknown key, says what to do about it', async () => {
    const { post } = scripted({ ok: false, error: 'unauthorized' });
    const error = await failure(backendOver(post).call('posts'), 'unauthorized');

    expect(error.message).toContain('key');
    expect(error.message).toBe('Your key was not recognised. Ask your admin for a new one.');
  });

  it('for an unknown key, keeps the server\'s wording when it has some', async () => {
    const { post } = scripted({
      ok: false,
      error: 'unauthorized',
      message: 'This copy of Post-It is not registered. Ask your admin for a key.',
    });
    const error = await failure(backendOver(post).call('ping'), 'unauthorized');

    expect(error.message).toBe('This copy of Post-It is not registered. Ask your admin for a key.');
  });

  it('for a forbidden action, keeps the server\'s wording', async () => {
    const { post } = scripted({ ok: false, error: 'forbidden', message: 'You are not assigned to APG Rentals.' });
    const error = await failure(backendOver(post).call('logPost'), 'forbidden');

    expect(error.message).toBe('You are not assigned to APG Rentals.');
  });

  it('for a forbidden action without wording, says so plainly', async () => {
    const { post } = scripted({ ok: false, error: 'forbidden', message: '  ' });
    const error = await failure(backendOver(post).call('saveQueue'), 'forbidden');

    expect(error.message).toBe('Your account is not allowed to do that.');
  });

  it('for a busy lock, says to try again — whether or not the server explained', async () => {
    // logPost's busy reply has a message; addLink, saveQueue and setStatus send none.
    const { post } = scripted(
      { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' },
      { ok: false, error: 'busy' },
    );
    const backend = backendOver(post);
    const first = await failure(backend.call('logPost'), 'busy');
    const second = await failure(backend.call('saveQueue'), 'busy');

    expect(first.message).toBe('Someone else is saving right now. Try again in a moment.');
    expect(second.message).toBe(first.message);
  });

  it('for a pending post that is not there, keeps the server\'s wording', async () => {
    const { post } = scripted({ ok: false, error: 'notfound', message: 'No pending post for that property.' });
    const error = await failure(backendOver(post).call('addLink'), 'notfound');

    expect(error.message).toBe('No pending post for that property.');
  });

  it('for a property gone from the directory, says to refresh', async () => {
    const { post } = scripted({ ok: false, error: 'property not found: 1AbC' });
    const error = await failure(backendOver(post).call('property', { id: '1AbC' }), 'notfound');

    expect(error.message).toBe('That property is no longer in the directory. Refresh the list and look for it again.');
  });

  it('for an action the web app does not know, says the web app is out of date', async () => {
    const { post } = scripted({ ok: false, error: 'unknown action: setStatus' });
    const error = await failure(backendOver(post).call('setStatus'), 'outdated');

    expect(error.message).toBe(
      'The web app is out of date and cannot update the queue. Ask your admin to deploy the latest version.',
    );
  });

  it('for a field the app left out, calls it a bug and says who to tell', async () => {
    const { post } = scripted({ ok: false, error: 'missing: propertyId' });
    const error = await failure(backendOver(post).call('logPost'), 'incomplete');

    expect(error.message).toBe(
      'Post-It sent an incomplete request (propertyId missing) and could not log the post. ' +
        'This is a bug in Post-It: tell your admin.',
    );
  });

  it('for a setup problem, passes on the server\'s own words', async () => {
    const { post } = scripted({ ok: false, error: 'No "Directory" tab. Run BuildDirectory.gs first.' });
    const error = await failure(backendOver(post).call('properties'), 'server');

    expect(error.message).toBe(
      'Google could not load the property list: No "Directory" tab. Run BuildDirectory.gs first. ' +
        'If it keeps happening, show this to your admin.',
    );
  });

  it('for an Apps Script exception, drops the "Exception:" and adds a full stop', async () => {
    const { post } = scripted({ ok: false, error: 'Exception: Too many simultaneous invocations: Spreadsheets' });
    const error = await failure(backendOver(post).call('posts'), 'server');

    expect(error.message).toBe(
      'Google could not load the posts: Too many simultaneous invocations: Spreadsheets. ' +
        'If it keeps happening, show this to your admin.',
    );
  });

  it('for an unknown refusal with a message, shows the message', async () => {
    const { post } = scripted({ ok: false, error: 'something-new', message: 'The tracker is locked for the audit.' });
    const error = await failure(backendOver(post).call('logPost'), 'server');

    expect(error.message).toBe('The tracker is locked for the audit.');
  });

  it.each([
    ['bad-date', 'saveQueues', 'The date must be a day written yyyy-MM-dd.', 'Pick a valid date.'],
    ['bad-role', 'addPerson', 'The role must be Admin or Intern.', 'Choose Intern or Admin.'],
    ['bad-active', 'setActive', 'Say whether the person is active: true or false.', 'Choose active or not.'],
    ['name-required', 'addPerson', "Type the person's name.", "Type the person's name."],
    ['checker-off', 'indexCheck', "The checker's index is switched off (CONFIG.CHECKER_INDEX_CSV_URL).", 'The listings check is turned off.'],
    ['checker-unavailable', 'indexCheck', "The checker's index could not be read. Try again later.", "The listing checker can't be reached right now. Try again later."],
  ] as const)('for %s, says a short sentence of its own', async (code, action, theirs, ours) => {
    const { post } = scripted({ ok: false, error: code, message: theirs });
    const error = await failure(backendOver(post).call(action), code);

    expect(error.message).toBe(ours);
  });

  it.each([
    ['unknown-person', 'logPost', 'There is nobody active called Bea on the team.', "That person isn't active on the team."],
    ['bad-intern', 'saveQueues', 'Bea is not an active intern on the Team tab.', "That person isn't an active intern."],
    ['bad-queues', 'saveQueues', "Item 2 of Jan's queue has no property.", "The queues couldn't be read. Check them and save again."],
    ['bad-accounts', 'addPerson', 'FB accounts must be a list of names.', "The FB accounts couldn't be read. Check them and try again."],
    ['notfound', 'newKey', 'There is nobody called Bea on the team.', 'Google could not find what it needed to make a new key. Reload and try again.'],
  ] as const)('for %s, keeps the server\'s sentence, which names who or what, with a fallback', async (code, action, theirs, fallback) => {
    const said = await failure(backendOver(scripted({ ok: false, error: code, message: theirs }).post).call(action), code);
    expect(said.message).toBe(theirs);

    const bare = await failure(backendOver(scripted({ ok: false, error: code }).post).call(action), code);
    expect(bare.message).toBe(fallback);
  });

  it('for a refusal with no reason at all, still names what failed', async () => {
    const { post } = scripted({ ok: false });
    const error = await failure(backendOver(post).call('assignments'), 'server');

    expect(error.message).toBe('Google refused to load the queues. Try again, and tell your admin if it keeps happening.');
  });
});

// ------------------------------------------------------------------ what came back

describe('a reply', () => {
  it('that says ok is handed back as it came', async () => {
    const { post } = scripted({ ok: true, posts: [{ title: 'Casa Amara' }] });
    const reply = await backendOver(post).call('posts');

    expect(reply).toEqual({ ok: true, posts: [{ title: 'Casa Amara' }] });
  });

  it('as raw JSON text is read, byte-order mark and all', async () => {
    const { post } = scripted('﻿  {"ok":true,"name":"Jan Dela Cruz"}\n');
    const reply = await backendOver(post).call('ping');

    expect(reply['name']).toBe('Jan Dela Cruz');
  });

  it('as the fetch Response itself is read, not mistaken for an ok reply', async () => {
    // Response.ok is true for any 200: taken as the reply, it would pass for one.
    const { post } = scripted(
      () => new Response('{"ok":true,"name":"Jan Dela Cruz"}', { status: 200 }),
      () => new Response('<html><body>Sign in</body></html>', { status: 200 }),
      () => new Response('Not Found', { status: 404 }),
    );
    const backend = backendOver(post);

    expect((await backend.call('ping'))['name']).toBe('Jan Dela Cruz');
    await failure(backend.call('ping'), 'sign-in-page');
    const missing = await failure(backend.call('ping'), 'http');
    expect(missing.message).toContain('error 404');
  });

  it('that is a sign-in page instead of JSON names the real mistake', async () => {
    // The commonest setup error: the web app was deployed without "Anyone" access.
    const { post } = scripted('<!DOCTYPE html><html><body>Sign in</body></html>');
    const error = await failure(backendOver(post).call('posts'), 'sign-in-page');

    expect(error.message).toMatch(/redeploy/i);
    expect(error.message).toContain('"Anyone"');
  });

  it.each([
    ['old-deployment', '<html><title>Error</title><body>Script function not found: doPost</body></html>', /New version/],
    ['needs-authorization', '<html><body>Authorization is required to perform that action.</body></html>', /click Allow/],
    ['google-page', '<html><head><title>Page Not Found</title></head><body>Sorry</body></html>', /"Page Not Found"/],
  ] as const)('that is a Google page (%s) says how to fix that one', async (kind, html, says) => {
    const { post } = scripted(html);
    const error = await failure(backendOver(post).call('ping'), kind);
    expect(error.message).toMatch(says);
  });

  it('that is not JSON at all says to check the link', async () => {
    const { post } = scripted('Service unavailable, try later');
    const error = await failure(backendOver(post).call('posts'), 'unexpected');

    expect(error.message).toBe('Google sent something Post-It does not understand. Check the web app link in Settings.');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    ['an array', [1, 2]],
    ['a number', 42],
    ['an object without ok', { name: 'Jan' }],
    ['ok as text', { ok: 'true' }],
  ])('that is %s is not mistaken for data', async (_, body) => {
    const { post } = scripted(body);
    await failure(backendOver(post).call('posts'), 'unexpected');
  });

  it.each([
    ['empty text', ''],
    ['whitespace', '  \n'],
    ['null', null],
    ['nothing', undefined],
  ])('that is %s says the reply was empty', async (_, body) => {
    const { post } = scripted(body);
    const error = await failure(backendOver(post).call('posts'), 'empty');

    expect(error.message).toBe('Google sent an empty reply. Try again in a moment.');
  });
});

// ------------------------------------------------------------------ the trip

describe('a trip that fails', () => {
  it('on a dead connection does not leak the transport\'s exception', async () => {
    const cause = new TypeError('error sending request: dns error: no such host');
    const { post } = scripted(cause);
    const error = await failure(backendOver(post).call('posts'), 'unreachable');

    expect(error.message).toContain('connection');
    expect(error.message).toBe('Could not reach Google. Check your connection and try again.');
    expect(error.cause).toBe(cause);
  });

  it('when post throws before it even returns a promise, is still a sentence', async () => {
    const post = (): Promise<unknown> => {
      throw new Error('socket closed');
    };
    await failure(backendOver(post).call('posts'), 'unreachable');
  });

  it('on a read that takes too long, says so', async () => {
    const { post } = scripted(() => new Promise(() => {})); // never answers
    const error = await failure(backendOver(post, 'k', EXEC, 20).call('posts'), 'timeout');

    expect(error.message).toBe('Google did not answer in time. Check your connection and try again.');
  });

  it('on a write that takes too long, warns that it may have been saved', async () => {
    // Retrying blind could log the same post twice.
    const { post } = scripted(() => new Promise(() => {}));
    const error = await failure(backendOver(post, 'k', EXEC, 20).call('logPost'), 'timeout');

    expect(error.message).toBe(
      'Google did not answer in time, so Post-It cannot tell whether that was saved. Reload and check before trying again.',
    );
  });

  it('when the platform itself times out, reads it as a timeout', async () => {
    const timedOut = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { post } = scripted(timedOut);
    const error = await failure(backendOver(post).call('posts'), 'timeout');

    expect(error.cause).toBe(timedOut);
  });

  it('a reply that arrives in time is not held up by the timer', async () => {
    const { post } = scripted(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 5)));
    await expect(backendOver(post, 'k', EXEC, 1_000).call('ping')).resolves.toEqual({ ok: true });
  });

  it.each([
    [404, 'Google could not find the web app (error 404). Check the web app link in Settings.'],
    [403, 'Google would not let Post-It in (error 403). Ask your admin to check the web app is deployed with access set to "Anyone".'],
    [503, 'Google is having trouble right now (error 503). Try again in a minute.'],
    [429, 'Google is having trouble right now (error 429). Try again in a minute.'],
    [400, 'Google answered with error 400. Check the web app link in Settings.'],
  ])('with HTTP %i gives a sentence, not a code', async (status, message) => {
    const { post } = scripted(Object.assign(new Error(`HTTP ${status}`), { status }));
    const error = await failure(backendOver(post).call('posts'), 'http');

    expect(error.message).toBe(message);
  });

  it('when the platform could not parse the body, reads it as an unexpected reply', async () => {
    const { post } = scripted(new SyntaxError('Unexpected token < in JSON at position 0'));
    await failure(backendOver(post).call('posts'), 'unexpected');
  });

  it('as a plain string from Tauri is still read for what it says', async () => {
    const slow = scripted(() => Promise.reject('error sending request for url: operation timed out'));
    const dead = scripted(() => Promise.reject('error sending request for url: dns error'));

    await failure(backendOver(slow.post).call('posts'), 'timeout');
    await failure(backendOver(dead.post).call('posts'), 'unreachable');
  });

  it('on a redirect that was not followed, calls it the bug it is', async () => {
    const { post } = scripted(new Response('', { status: 302 }));
    const error = await failure(backendOver(post).call('posts'), 'http');

    expect(error.message).toBe('Google redirected Post-It and it did not follow (error 302). This is a bug in Post-It: tell your admin.');
  });

  it('with a sentence the platform already wrote, passes it on untouched', async () => {
    const own = new UserFacingError('Post-It is offline in this demo.');
    const { post } = scripted(own);

    await expect(backendOver(post).call('posts')).rejects.toBe(own);
  });
});

// ------------------------------------------------------------------ reading fields

describe('reading reply fields', () => {
  it('turns anything into text without inventing any', () => {
    expect(asText('Lot 7')).toBe('Lot 7');
    expect(asText(12)).toBe('12');
    expect(asText(true)).toBe('true');
    expect(asText(null)).toBe('');
    expect(asText(undefined)).toBe('');
    expect(asText(Number.NaN)).toBe('');
    expect(asText({ a: 1 })).toBe('');
  });

  it('accepts only real lists and real objects', () => {
    expect(asList([1])).toEqual([1]);
    expect(asList('[1]')).toBeNull();
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([])).toBeNull();
    expect(asRecord(null)).toBeNull();
  });
});
