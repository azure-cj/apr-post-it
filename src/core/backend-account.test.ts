import { describe, expect, it } from 'vitest';
import { createBackend, type BackendConfig } from './backend';

// v10: signed in with a Firebase account, each call carries its sign-in token instead of a key.

const URL = 'https://script.google.com/macros/s/test/exec';

function backendWith(config: () => BackendConfig) {
  const sent: Record<string, unknown>[] = [];
  const backend = createBackend({
    post: async (_url, body) => {
      sent.push(body as Record<string, unknown>);
      return { ok: true };
    },
    getConfig: config,
  });
  return { backend, sent };
}

describe('a call made with an account', () => {
  it('sends the token, never a key, and nothing in the payload stands in for them', async () => {
    const { backend, sent } = backendWith(() => ({ url: URL, key: 'old-key', idToken: 'tok', who: 'uid-1' }));
    await backend.call('posts', { idToken: 'forged', key: 'forged' });
    expect(sent[0]).toEqual({ action: 'posts', idToken: 'tok' });
  });

  it('counts as set up with a token and no key', async () => {
    const { backend } = backendWith(() => ({ url: URL, idToken: 'tok', who: 'uid-1' }));
    expect(await backend.isConfigured()).toBe(true);
  });

  it('is the same person while the token renews, and someone else for another account', async () => {
    let config: BackendConfig = { url: URL, idToken: 'tok-1', who: 'uid-1' };
    const { backend } = backendWith(() => config);
    const first = await backend.identity();
    config = { url: URL, idToken: 'tok-2', who: 'uid-1' };
    expect(await backend.identity()).toBe(first);
    config = { url: URL, idToken: 'tok-3', who: 'uid-2' };
    expect(await backend.identity()).not.toBe(first);
  });
});
