/**
 * The rules come from the server: every ping through the services' backend
 * records its version and rules, sign-in asks when nothing has, and the
 * settings take them over their own (withServerRules).
 */

import { EXPECTED_SERVER_VERSION } from '@/config';
import { DEFAULT_RULES } from '@/core/types';
import { createServices } from './services';
import { defaultAppSettings, parseSettings, serializeSettings, withServerRules } from './settings';
import { EXEC, fakeServer, NOW } from './testing';

const RULES = { cooldownDays: 3, repostDueDays: 21, perIntern: 12 };
const PING = { ok: true, name: 'Maria Santos', role: 'Admin', fbAccounts: [], version: EXPECTED_SERVER_VERSION, rules: RULES };

function services(replies: Readonly<Record<string, unknown>> = {}) {
  const platform = fakeServer({ ping: PING, ...replies } as never);
  return { platform, services: createServices(platform, () => parseSettings(JSON.stringify({ scriptUrl: EXEC })), () => NOW) };
}

describe('the server\'s version and rules', () => {
  it('are unknown until a ping is answered', () => {
    expect(services().services.server.get()).toEqual({ known: false, version: '', versionStatus: 'unknown', rules: null });
  });

  it('are taken from every ping made through the services\' backend', async () => {
    const { services: s } = services();

    await s.backend.call('ping');

    expect(s.server.get()).toEqual({ known: true, version: EXPECTED_SERVER_VERSION, versionStatus: 'current', rules: RULES });
  });

  it('say behind for an older server, and no rules for one that sends none', async () => {
    const { services: s } = services({ ping: { ok: true, name: 'Jan', role: 'Intern', fbAccounts: [], version: '2020-01-01.1' } });

    await s.refreshServer();

    expect(s.server.get()).toEqual({ known: true, version: '2020-01-01.1', versionStatus: 'behind', rules: null });
  });

  it('are asked for on sign-in when no ping has told them, once', async () => {
    const { services: s, platform } = services();
    const pings = () => platform.posts.filter((p) => p.action === 'ping').length;

    await s.startDirectory();
    await vi.waitFor(() => expect(s.server.get().known).toBe(true));
    await s.startDirectory();

    expect(pings()).toBe(1);
    expect(s.server.get().rules).toEqual(RULES);
  });

  it('are forgotten on sign-out', async () => {
    const { services: s } = services();
    await s.refreshServer();

    s.forget();

    expect(s.server.get().known).toBe(false);
  });

  it('follow a save from the app', async () => {
    const { services: s } = services({ setRules: { ok: true, rules: { ...RULES, perIntern: 30 } } });
    await s.refreshServer();

    await s.tracker.setRules({ perIntern: 30 });

    expect(s.server.get().rules).toEqual({ ...RULES, perIntern: 30 });
  });

  it('never fail a ping because the server is unreachable: refreshServer resolves', async () => {
    const { services: s } = services({ ping: new Error('offline') });

    await expect(s.refreshServer()).resolves.toBeUndefined();
    expect(s.server.get().known).toBe(false);
  });
});

describe('withServerRules', () => {
  it('puts the server\'s rules over the settings\' own', () => {
    expect(withServerRules(defaultAppSettings, RULES)).toEqual({ ...defaultAppSettings, ...RULES });
  });

  it('leaves the settings as they are without rules, or when they agree', () => {
    expect(withServerRules(defaultAppSettings, null)).toBe(defaultAppSettings);
    expect(withServerRules(defaultAppSettings, DEFAULT_RULES)).toBe(defaultAppSettings);
  });

  it('keeps perIntern with the settings', () => {
    expect(parseSettings(serializeSettings({ ...defaultAppSettings, perIntern: 9 })).perIntern).toBe(9);
    expect(parseSettings('{"perIntern": 0}').perIntern).toBe(20);
  });
});
