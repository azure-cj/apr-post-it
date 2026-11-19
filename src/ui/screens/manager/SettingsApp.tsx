import { Card } from '../../components';
import { version as PACKAGE_VERSION } from '../../../../package.json';
import { Segmented } from './Segmented';

/** This copy's version and build day, unless the caller says otherwise. */
const BUILT: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';

export type ThemeChoice = 'dark' | 'light' | 'system';

/**
 * The App tab, the same for everyone: an admin's fourth tab, and all of an
 * agent's Settings (D32). It has no web app card: nobody sees the link.
 */
export interface SettingsAppProps {
  /** The web app's version, as `ping` said it. */
  readonly serverVersion?: string | undefined;
  readonly theme?: ThemeChoice | undefined;
  /** Without it, no Appearance. */
  readonly onThemeChange?: ((choice: ThemeChoice) => void) | undefined;
  /** This app's version. Default package.json's. */
  readonly appVersion?: string | undefined;
  /** When this copy was built, yyyy-MM-dd; '' when unknown. */
  readonly buildDate?: string | undefined;
  /** Days a post waits for approval before a Windows reminder; 0: never. */
  readonly reminderDays?: number | undefined;
  /** Without it, no Reminders. */
  readonly onReminderDaysChange?: ((days: number) => void) | undefined;
}

/** The reminder ages offered: off, or after this many days. */
const REMINDERS = ['Off', '1 day', '2 days', '3 days', '7 days'] as const;
type ReminderLabel = (typeof REMINDERS)[number];
const REMINDER_DAYS: Record<ReminderLabel, number> = { Off: 0, '1 day': 1, '2 days': 2, '3 days': 3, '7 days': 7 };
const reminderLabelOf = (days: number): ReminderLabel => REMINDERS.find((l) => REMINDER_DAYS[l] === days) ?? '2 days';

const THEMES = ['Dark', 'Light', 'System'] as const;
type ThemeLabel = (typeof THEMES)[number];
const labelOf = (c: ThemeChoice): ThemeLabel => (c === 'light' ? 'Light' : c === 'system' ? 'System' : 'Dark');
const choiceOf = (l: ThemeLabel): ThemeChoice => (l === 'Light' ? 'light' : l === 'System' ? 'system' : 'dark');

/** "2026-10-31" -> "31 Oct 2026". */
function dayWords(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
}

export function SettingsApp({
  serverVersion,
  theme = 'dark',
  onThemeChange,
  appVersion = PACKAGE_VERSION,
  buildDate = BUILT,
  reminderDays = 2,
  onReminderDaysChange,
}: SettingsAppProps) {
  return (
    <div className="settings__column">
      {onThemeChange ? (
        <Card title="Appearance">
          <Segmented
            className="app-theme"
            label="Theme"
            options={THEMES}
            value={labelOf(theme)}
            onChange={(label) => onThemeChange(choiceOf(label))}
          />
        </Card>
      ) : null}

      {onReminderDaysChange ? (
        <Card title="Reminders" description="A Windows notification when a post waits this long for approval. Once a day.">
          <Segmented
            label="Remind me after"
            options={REMINDERS}
            value={reminderLabelOf(reminderDays)}
            onChange={(label) => onReminderDaysChange(REMINDER_DAYS[label])}
          />
        </Card>
      ) : null}

      <Card title="About">
        <dl className="app-about">
          <div>
            <dt>Version</dt>
            <dd className="tabular">{appVersion}</dd>
          </div>
          {buildDate ? (
            <div>
              <dt>Built</dt>
              <dd className="tabular">{dayWords(buildDate)}</dd>
            </div>
          ) : null}
          {serverVersion ? (
            <div>
              <dt>Web app version</dt>
              <dd className="tabular">{serverVersion}</dd>
            </div>
          ) : null}
        </dl>
      </Card>
    </div>
  );
}
