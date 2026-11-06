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

const RULES = { cooldownDays: 3, repostDueDays: 21, perWeek: 12, perIntern: 12, queueWeeks: 3 };
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

  it('stay the same object when a ping says nothing new, so nothing re-renders for it', async () => {
    const { services: s } = services();
    await s.refreshServer();
    const first = s.server.get();
    const heard = vi.fn();
    s.server.subscribe(heard);

    await s.refreshServer();

    expect(s.server.get()).toBe(first);
    expect(heard).not.toHaveBeenCalled();
  });

  it('are forgotten on sign-out', async () => {
    const { services: s } = services();
    await s.refreshServer();

    s.forget();

    expect(s.server.get().known).toBe(false);
  });

  it('follow a save from the app', async () => {
    const { services: s, platform } = services({ setRules: { ok: true, rules: { ...RULES, perWeek: 30, perIntern: 30 } } });
    await s.refreshServer();

    await s.tracker.setRules({ perWeek: 30 });

    expect(s.server.get().rules).toEqual({ ...RULES, perWeek: 30, perIntern: 30 });
    expect(platform.posts.find((p) => p.action === 'setRules')?.body).toMatchObject({ perWeek: 30 });
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

  it('puts perWeek and its old name, perIntern, over the settings\' own, always equal', () => {
    expect(withServerRules(defaultAppSettings, { ...DEFAULT_RULES, perWeek: 55, perIntern: 55 })).toMatchObject({ perWeek: 55, perIntern: 55 });
  });

  it('keeps perWeek with the settings, and perIntern as its alias', () => {
    const kept = parseSettings(serializeSettings({ ...defaultAppSettings, perWeek: 120, perIntern: 120 }));
    expect(kept).toMatchObject({ perWeek: 120, perIntern: 120 });
    expect(JSON.parse(serializeSettings(defaultAppSettings))).not.toHaveProperty('perIntern');
    expect(parseSettings('{"perWeek": 0}')).toMatchObject({ perWeek: 40, perIntern: 40 });
    expect(parseSettings('{"perWeek": 201}').perWeek).toBe(40);
  });

  it('reads a file kept before v6, which has only perIntern, as perWeek', () => {
    expect(parseSettings('{"perIntern": 20}')).toMatchObject({ perWeek: 20, perIntern: 20 });
    expect(parseSettings('{"perIntern": 0}')).toMatchObject({ perWeek: 40, perIntern: 40 });
    expect(parseSettings('{"perWeek": 45, "perIntern": 20}')).toMatchObject({ perWeek: 45, perIntern: 45 });
    expect(parseSettings('{"perWeek": "x", "perIntern": 20}').perWeek).toBe(20);
  });
});
