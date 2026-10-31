import { Button, Card, Pill, TextInput } from '../../components';
import { version as PACKAGE_VERSION } from '../../../../package.json';
import { Segmented } from './Segmented';

/** This copy's version and build day, unless the caller says otherwise. */
const BUILT: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type VersionStatus = 'current' | 'behind' | 'unknown';

export interface SettingsAppProps {
  /** The web app's /exec link. */
  readonly scriptUrl: string;
  /** The link is built into this version of the app (src/config.ts), so nobody types it. */
  readonly builtInLink?: boolean | undefined;
  readonly onCopy?: ((text: string) => void) | undefined;
  /** The web app's version against the one this app expects. */
  readonly versionStatus?: VersionStatus | undefined;
  /** The web app's version, as `ping` said it. */
  readonly serverVersion?: string | undefined;
  readonly theme?: ThemeChoice | undefined;
  /** Without it, no Appearance. */
  readonly onThemeChange?: ((choice: ThemeChoice) => void) | undefined;
  /** This app's version. Default package.json's. */
  readonly appVersion?: string | undefined;
  /** When this copy was built, yyyy-MM-dd; '' when unknown. */
  readonly buildDate?: string | undefined;
}

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
  scriptUrl,
  builtInLink = false,
  onCopy,
  versionStatus,
  serverVersion,
  theme = 'dark',
  onThemeChange,
  appVersion = PACKAGE_VERSION,
  buildDate = BUILT,
}: SettingsAppProps) {
  const url = scriptUrl.trim();
  return (
    <div className="settings__column">
      <Card title="Web app">
        <div className="app-web">
          <TextInput
            label="Web app link"
            value={url}
            placeholder="Not set"
            readOnly
            spellCheck={false}
            end={
              onCopy && url ? (
                <Button variant="quiet" size="small" onClick={() => onCopy(url)} aria-label="Copy the web app link">
                  Copy
                </Button>
              ) : undefined
            }
            hint={builtInLink ? 'Built into this version of the app.' : undefined}
          />
          {versionStatus ? <ServerVersion status={versionStatus} version={serverVersion} /> : null}
        </div>
      </Card>

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

function ServerVersion({ status, version }: { readonly status: VersionStatus; readonly version?: string | undefined }) {
  return (
    <div className="app-version">
      <div className="app-version__line" role="status">
        <span className="app-version__label">Web app version</span>
        {status === 'current' ? (
          <Pill tone="ok" dot>
            Up to date
          </Pill>
        ) : status === 'behind' ? (
          <Pill tone="warn" dot>
            Behind: deploy a New version in Apps Script
          </Pill>
        ) : (
          <Pill tone="neutral">{version ? 'Unknown' : 'Not reported'}</Pill>
        )}
      </div>
      {status === 'behind' ? (
        <details className="app-version__how">
          <summary>How to deploy</summary>
          <ol>
            <li>In Apps Script, open Deploy → Manage deployments.</li>
            <li>Click the pencil on the web app.</li>
            <li>Under Version, pick New version.</li>
            <li>Click Deploy. The link stays the same.</li>
          </ol>
        </details>
      ) : null}
    </div>
  );
}
