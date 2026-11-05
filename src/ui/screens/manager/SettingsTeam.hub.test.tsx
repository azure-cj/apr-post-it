// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsTeam } from './SettingsTeam';

const TEAM = [
  { name: 'APG Admin', role: 'Admin' as const, email: 'thealphapremiergroup@gmail.com', fbAccounts: [], active: true },
  { name: 'CJ', role: 'Intern' as const, email: 'cj@aureo.com', fbAccounts: ['Cyrus', 'Kevs'], active: true },
];

describe('Settings → Team, with the team from Alpha Listing Hub', () => {
  it('says where people are managed, and offers no turn off or new key', async () => {
    render(<SettingsTeam team={TEAM} today="2026-11-04" managedInHub onUpdatePerson={async () => ({})} />);
    expect(screen.getByText(/come from Alpha Listing Hub's People screen/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'CJ' }));
    expect(screen.queryByRole('button', { name: /turn off/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New key' })).toBeNull();
  });
});
