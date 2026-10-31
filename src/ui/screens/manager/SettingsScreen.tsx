import { Button, Card, EmptyState, Notice, Pill, Spinner, TextInput } from '../../components';
import { plural, type TeamMember } from '@/core/summary';
import type { Settings } from '@/core/types';
import './SettingsScreen.css';

export interface SettingsScreenProps {
  /** The web app link and the two rules. AppSettings fits. The key is never passed, so it can't be shown. */
  readonly settings: Pick<Settings, 'scriptUrl' | 'cooldownDays' | 'repostDueDays'>;
  /** The Team tab without its keys, in its own order. Null: the web app doesn't send it. */
  readonly team: readonly TeamMember[] | null;
  /** Puts text on the clipboard. Without it, there is no Copy button. */
  readonly onCopy?: ((text: string) => void) | undefined;
  /** The team is being read and hasn't arrived yet. */
  readonly loading?: boolean | undefined;
  /** Why the team couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
}

const MONO = 'settings__code';

/**
 * How Post-It is set up for everyone, for an admin to check. Nothing is
 * changed here: the rules live in the web app, and people and their keys in
 * the private admin sheet, which only the admin can open (DECISIONS D3).
 */
export function SettingsScreen({ settings, team, onCopy, loading = false, error }: SettingsScreenProps) {
  const { scriptUrl, cooldownDays, repostDueDays } = settings;
  const url = scriptUrl.trim();

  return (
    <div className="page settings">
      <header className="page-header">
        <h1 className="page-header__title" tabIndex={-1}>
          Settings
        </h1>
        <p className="page-header__description">
          How Post-It is set up for everyone. This screen only shows it: the rules live in the web app, and the team
          and their keys in the private admin sheet.
        </p>
      </header>

      <div className="settings__panes">
        <div className="settings__main">
          <Card
            title="Team"
            description="Read-only. People and their keys are kept on the Team tab of the private admin sheet, which only the admin can open. Keys never reach this app."
          >
            {error ? (
              <Notice tone="danger" live>
                {error}
              </Notice>
            ) : loading && !team ? (
              <div className="settings__waiting">
                <Spinner label="Reading the team" />
                <span>Reading the team…</span>
              </div>
            ) : team === null ? (
              <EmptyState headingLevel={3} title="The team isn't shown here yet">
                The web app doesn&rsquo;t send the team list to this app yet. It is on the Team tab of the private admin
                sheet.
              </EmptyState>
            ) : team.length === 0 ? (
              <EmptyState headingLevel={3} title="Nobody is on the team yet">
                Add the first people as described below. Until then, the setup key in the web app&rsquo;s script acts as
                a temporary admin key.
              </EmptyState>
            ) : (
              <TeamTable team={team} />
            )}
          </Card>

          <Card title="Adding someone">
            <ol className="settings__steps">
              <li>
                Open the Post-It script at script.google.com, signed in as the account that owns it.
              </li>
              <li>
                In <code className={MONO}>ADD_PERSON</code>, set their full name, their role (Intern, Manager or Admin)
                and the Facebook accounts they may post from, separated by commas. Leave the accounts blank to allow any.
              </li>
              <li>
                Press Run. Their key is printed in the execution log, and kept on the Team tab of the private admin
                sheet.
              </li>
              <li>
                Send them the web app link and their key, privately. The key is their identity: anyone who has it can log
                posts as them.
              </li>
              <li>They paste both into Post-It&rsquo;s sign-in screen, and the web app tells it who they are.</li>
            </ol>
            <p className="settings__note">
              Spell the name the way the tracker already does: queues and posts are matched to people by name. If the
              script is bound to a spreadsheet, its Post-It menu has <span className="settings__menu">Add a team member…</span>{' '}
              instead.
            </p>
            <h3 className="settings__subhead">Taking someone off</h3>
            <p className="settings__text">
              Set <code className={MONO}>Active</code> to FALSE on their row of the Team tab. Their key stops working
              within a minute, and nothing else needs undoing.
            </p>
          </Card>
        </div>
        <div className="settings__side">
          <Card title="Web app" description="Everyone signs in with this link and their own key.">
            <TextInput
              label="Web app link"
              value={url}
              placeholder="Not set yet"
              readOnly
              spellCheck={false}
              end={
                onCopy && url ? (
                  <Button variant="quiet" size="small" onClick={() => onCopy(url)} aria-label="Copy the web app link">
                    Copy
                  </Button>
                ) : undefined
              }
              hint="A new intern needs this link and the key made for them. Send the two separately."
            />
          </Card>

          <Card title="Rules" description="The same for everyone.">
            <dl className="settings__rules">
              <div className="settings__rule">
                <dt>Cooldown</dt>
                <dd className="settings__value tabular">{plural(cooldownDays, 'day', 'days')}</dd>
                <dd className="settings__explain">
                  A listing posted fewer than {plural(cooldownDays, 'day', 'days')} ago can&rsquo;t be posted again or put
                  in a queue. The web app checks it, under a lock, before it saves a post.
                </dd>
              </div>
              <div className="settings__rule">
                <dt>Due for repost</dt>
                <dd className="settings__value tabular">{plural(repostDueDays, 'day', 'days')}</dd>
                <dd className="settings__explain">
                  A listing not posted for {plural(repostDueDays, 'day', 'days')} or more shows as due on the tracker.
                </dd>
              </div>
            </dl>
            <p className="settings__note">
              The web app enforces its own cooldown, set in its script. If the two ever differ, the web app&rsquo;s is
              the one that counts.
            </p>
          </Card>

        </div>
      </div>
    </div>
  );
}

function TeamTable({ team }: { team: readonly TeamMember[] }) {
  return (
    <div className="settings__table-wrap">
      <table className="settings__table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">FB accounts</th>
            <th scope="col">Key</th>
          </tr>
        </thead>
        <tbody>
          {team.map((member, index) => {
            const accounts = member.fbAccounts ?? [];
            return (
              <tr key={`${index}-${member.name}`}>
                <td className="settings__name">{member.name}</td>
                <td>
                  <Pill>{member.role}</Pill>
                </td>
                <td>{accounts.length === 0 ? <span className="settings__muted">Any</span> : accounts.join(', ')}</td>
                <td>
                  {member.active === false ? (
                    <Pill tone="neutral">Revoked</Pill>
                  ) : (
                    <Pill tone="ok" dot>
                      Active
                    </Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
