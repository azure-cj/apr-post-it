// @vitest-environment jsdom
/** The sidebar's foot: this app's version, and Check for updates, which runs the update banner's check now. */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { version } from '../../package.json';
import { fakeServer, renderApp } from './state/testing';

describe('Check for updates', () => {
  it("shows this app's version at the foot of the sidebar", async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    expect(await screen.findByText(`Version ${version}`)).toBeTruthy();
  });

  it('says so when this is the newest', async () => {
    renderApp({ platform: fakeServer(), path: '/find' });
    await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText(`You're on the latest version (${version}).`)).toBeTruthy();
  });

  it('offers a newer version at once, with Restart and update', async () => {
    renderApp({ platform: fakeServer({}, 'test-key', { update: { version: '9.9.9' } }), path: '/find' });
    await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Version 9.9.9 is ready')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restart and update' })).toBeTruthy();
  });
});
