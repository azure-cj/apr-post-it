// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakePlatform, type FakePlatform } from '@/platform/fake';

/** A matchMedia whose answer the test changes, as Windows' mode switch would. */
function mockSystem(prefersLight: boolean) {
  const handlers = new Set<() => void>();
  const query = {
    get matches() {
      return prefersLight;
    },
    media: '(prefers-color-scheme: light)',
    addEventListener: (_: string, handler: () => void) => handlers.add(handler),
    removeEventListener: (_: string, handler: () => void) => handlers.delete(handler),
  };
  window.matchMedia = vi.fn(() => query as unknown as MediaQueryList);
  return {
    set(light: boolean) {
      prefersLight = light;
      handlers.forEach((handler) => handler());
    },
  };
}

/** A fresh module each time: the theme lives in one module-level store. */
async function load(local: Record<string, string> = {}) {
  vi.resetModules();
  const { setPlatform } = await import('@/platform');
  const fake: FakePlatform = createFakePlatform({ local });
  setPlatform(fake);
  const theme = await import('./theme');
  return { fake, ...theme };
}

const dataTheme = () => document.documentElement.dataset['theme'];

beforeEach(() => {
  delete document.documentElement.dataset['theme'];
  mockSystem(false);
});

describe('theme', () => {
  it('is dark by default', async () => {
    const { applySavedTheme, fake } = await load();
    await expect(applySavedTheme(fake)).resolves.toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('is dark when the kept value is damaged', async () => {
    const { applySavedTheme, fake } = await load({ theme: 'sepia' });
    await expect(applySavedTheme(fake)).resolves.toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('applies a kept choice before anything renders', async () => {
    const { applySavedTheme, fake } = await load({ theme: 'light' });
    await applySavedTheme(fake);
    expect(dataTheme()).toBe('light');
  });

  it('keeps the choice and applies it as data-theme', async () => {
    const { applySavedTheme, useTheme, fake } = await load();
    await applySavedTheme(fake);
    const { result } = renderHook(() => useTheme());
    expect(result.current).toMatchObject({ choice: 'dark', resolved: 'dark' });

    act(() => result.current.setChoice('light'));

    expect(result.current).toMatchObject({ choice: 'light', resolved: 'light' });
    expect(dataTheme()).toBe('light');
    await waitFor(() => expect(fake.readLocal('theme')).resolves.toBe('light'));
  });

  it('survives a restart', async () => {
    const first = await load();
    await first.applySavedTheme(first.fake);
    first.setThemeChoice('light');
    const kept = await first.fake.readLocal('theme');

    const second = await load({ theme: kept ?? '' });
    await second.applySavedTheme(second.fake);
    expect(dataTheme()).toBe('light');
  });

  it('follows the system, live, when the choice is system', async () => {
    const system = mockSystem(true);
    const { applySavedTheme, useTheme, fake } = await load({ theme: 'system' });
    await applySavedTheme(fake);
    expect(dataTheme()).toBe('light');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toMatchObject({ choice: 'system', resolved: 'light' });

    act(() => system.set(false));

    expect(result.current).toMatchObject({ choice: 'system', resolved: 'dark' });
    expect(dataTheme()).toBe('dark');
  });

  it('ignores the system when a theme is chosen', async () => {
    const system = mockSystem(true);
    const { applySavedTheme, useTheme, fake } = await load({ theme: 'dark' });
    await applySavedTheme(fake);
    const { result } = renderHook(() => useTheme());

    act(() => system.set(true));

    expect(result.current.resolved).toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('starts dark when the kept value cannot be read', async () => {
    vi.resetModules();
    const { setPlatform } = await import('@/platform');
    const fake = createFakePlatform({ failures: { readLocal: 'Disk unreadable.' } });
    setPlatform(fake);
    const { applySavedTheme } = await import('./theme');
    await expect(applySavedTheme(fake)).resolves.toBe('dark');
    expect(dataTheme()).toBe('dark');
  });
});
