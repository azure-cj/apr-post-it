import { inMemoryPersistence } from 'firebase/auth';
import { describe, expect, it } from 'vitest';
import { createFakePlatform } from './fake';
import { createFirebase, EMULATOR, firebaseTarget, LIVE } from './firebase';

describe('which Firebase project', () => {
  it('is the emulator in development and live in an installed app', () => {
    expect(firebaseTarget(true)).toBe(EMULATOR);
    expect(firebaseTarget(false)).toBe(LIVE);
  });

  it('is live in development only when asked for by name', () => {
    expect(firebaseTarget(true, 'live')).toBe(LIVE);
    expect(firebaseTarget(true, 'yes')).toBe(EMULATOR);
  });

  it('never points development at a real project', () => {
    expect(EMULATOR.config.projectId).toMatch(/^demo-/);
    expect(LIVE.emulator).toBeNull();
  });

  it('is none in the fake platform unless a test gives one', async () => {
    expect(await createFakePlatform().firebase()).toBeNull();
  });
});

// Against the emulator on this PC, with the hub's test accounts: in the hub's firebase/ folder run
// `npm run emulators`, then `FIREBASE_EMULATOR=1 npx vitest run src/platform/firebase.test.ts`.
describe.runIf(process.env['FIREBASE_EMULATOR'] === '1')('on the emulator', () => {
  const firebase = () => createFirebase(EMULATOR, [inMemoryPersistence]);

  it('signs an agent in, reads their role, and calls a posting function', async () => {
    const f = firebase();
    await f.signIn('agent@test', 'test-password');
    expect(await f.role(true)).toBe('agent');
    const start = await f.call<{ me: { role: string }; rules: { cooldownDays: number } }>('postingStart');
    expect(start.me.role).toBe('agent');
    expect(start.rules.cooldownDays).toBeGreaterThan(0);
    await f.signOut();
    expect(await f.role(false)).toBeNull();
  });

  it('gives an account with no role nothing', async () => {
    const f = firebase();
    await f.signIn('nobody@test', 'test-password');
    expect(await f.role(true)).toBeNull();
    await expect(f.call('postingStart')).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('refuses a wrong password', async () => {
    await expect(firebase().signIn('agent@test', 'wrong-password')).rejects.toMatchObject({ code: 'auth/wrong-password' });
  });
});
