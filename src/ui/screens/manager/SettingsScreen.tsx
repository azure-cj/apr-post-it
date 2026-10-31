import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components';
import { SettingsApp, type SettingsAppProps } from './SettingsApp';
import { SettingsListings, type SettingsListingsProps } from './SettingsListings';
import { SettingsRules, type SettingsRulesProps } from './SettingsRules';
import { SettingsTeam, type SettingsTeamProps } from './SettingsTeam';
import './SettingsScreen.css';

export type SettingsTab = 'team' | 'listings' | 'rules' | 'app';

export const SETTINGS_TABS: readonly { readonly key: SettingsTab; readonly label: string }[] = [
  { key: 'team', label: 'Team' },
  { key: 'listings', label: 'Listings' },
  { key: 'rules', label: 'Rules' },
  { key: 'app', label: 'App' },
];

/** The tab a `?tab=` value names, or Team. */
export function settingsTab(value: string | null | undefined): SettingsTab {
  return SETTINGS_TABS.find((t) => t.key === value)?.key ?? 'team';
}

export interface SettingsScreenProps {
  readonly tab: SettingsTab;
  readonly onTabChange: (tab: SettingsTab) => void;
  readonly team: SettingsTeamProps;
  readonly listings: SettingsListingsProps;
  readonly rules: SettingsRulesProps;
  readonly app: SettingsAppProps;
}

/**
 * The admin's page, in four tabs: Team (people, keys), Listings (the
 * Directory build and the listings check), Rules, and App (the web app, the
 * theme, the version).
 */
export function SettingsScreen({ tab, onTabChange, team, listings, rules, app }: SettingsScreenProps) {
  const base = useId();
  const tabs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const tabId = (key: SettingsTab) => `${base}-tab-${key}`;
  const panelId = (key: SettingsTab) => `${base}-panel-${key}`;
  const [adding, setAdding] = useState(false);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = SETTINGS_TABS.findIndex((t) => t.key === tab);
    const last = SETTINGS_TABS.length - 1;
    const to =
      event.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
      : event.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1;
    const next = SETTINGS_TABS[to];
    if (!next) return;
    event.preventDefault();
    onTabChange(next.key);
    tabs.current.get(next.key)?.focus();
  };

  return (
    <div className="page settings">
      <header className="page-header settings__header">
        <div className="settings__title-row">
          <h1 className="page-header__title" tabIndex={-1}>
            Settings
          </h1>
          {tab === 'team' && team.onAddPerson ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add person
            </Button>
          ) : null}
        </div>
        <div className="settings__tabs" role="tablist" aria-label="Settings" onKeyDown={onKeyDown}>
          {SETTINGS_TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  if (el) tabs.current.set(t.key, el);
                  else tabs.current.delete(t.key);
                }}
                type="button"
                role="tab"
                id={tabId(t.key)}
                aria-selected={on}
                aria-controls={on ? panelId(t.key) : undefined}
                tabIndex={on ? 0 : -1}
                className={['settings__tab', on ? 'settings__tab--on' : null].filter(Boolean).join(' ')}
                onClick={() => onTabChange(t.key)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="settings__panel" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === 'team' ? (
          <SettingsTeam {...team} adding={adding} onAddingChange={setAdding} />
        ) : tab === 'listings' ? (
          <SettingsListings {...listings} />
        ) : tab === 'rules' ? (
          <SettingsRules {...rules} />
        ) : (
          <SettingsApp {...app} />
        )}
      </div>
    </div>
  );
}
