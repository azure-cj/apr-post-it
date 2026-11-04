// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdate } from '@/platform';
import { CHECK_EVERY_MS, FIRST_CHECK_MS, UpdateBanner } from './UpdateBanner';

// A newer version is offered, never forced: on start and every few hours, with Later and Restart and update.

function update(version: string, install: AppUpdate['install'] = async () => {}): AppUpdate {
  return { version, notes: '', install };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('the update banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says nothing when there is no newer version', async () => {
    const checkUpdate = vi.fn(async () => null);
    render(<UpdateBanner platform={{ checkUpdate }} requestLeave={(go) => go()} />);
    await tick(FIRST_CHECK_MS);
    expect(checkUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/is ready/)).toBeNull();
  });

  it('offers a newer version shortly after start, and installs it on Restart and update', async () => {
    const install = vi.fn<AppUpdate['install']>(async (progress) => progress(0.5));
    render(<UpdateBanner platform={{ checkUpdate: async () => update('1.1.0', install) }} requestLeave={(go) => go()} />);
    expect(screen.queryByText('Version 1.1.0 is ready')).toBeNull();
    await tick(FIRST_CHECK_MS);

    expect(screen.getByText('Version 1.1.0 is ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }));
    await tick(0);
    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Updating to 1.1.0…')).toBeTruthy();
  });

  it('asks first when there are unsaved changes: nothing installs until the person agrees', async () => {
    const install = vi.fn<AppUpdate['install']>(async () => {});
    let asked: (() => void) | null = null;
    render(<UpdateBanner platform={{ checkUpdate: async () => update('1.1.0', install) }} requestLeave={(go) => (asked = go)} />);
    await tick(FIRST_CHECK_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }));
    expect(install).not.toHaveBeenCalled();
    act(() => asked!());
    await tick(0);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('Later hides that version, but a newer one is offered at the next check', async () => {
    let offered = '1.1.0';
    render(<UpdateBanner platform={{ checkUpdate: async () => update(offered) }} requestLeave={(go) => go()} />);
    await tick(FIRST_CHECK_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/is ready/)).toBeNull();

    await tick(CHECK_EVERY_MS + 60_000);
    expect(screen.queryByText(/is ready/)).toBeNull();

    offered = '1.2.0';
    await tick(CHECK_EVERY_MS + 60_000);
    expect(screen.getByText('Version 1.2.0 is ready')).toBeTruthy();
  });

  it('a failed install offers Try again; a failed check says nothing', async () => {
    let failCheck = true;
    const checkUpdate = vi.fn(async () => {
      if (failCheck) throw new Error('offline');
      return update('1.1.0', async () => {
        throw new Error('download failed');
      });
    });
    render(<UpdateBanner platform={{ checkUpdate }} requestLeave={(go) => go()} />);
    await tick(FIRST_CHECK_MS);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    failCheck = false;
    await tick(CHECK_EVERY_MS + 60_000);
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }));
    await tick(0);
    expect(screen.getByText("The update didn't install")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
