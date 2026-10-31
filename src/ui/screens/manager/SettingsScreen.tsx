import { useRef, useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, Icon, Notice, Pill, Spinner, TextInput } from '../../components';
import { BackendError } from '@/core/backend';
import { firstName, plural, samePerson, type TeamMember } from '@/core/summary';
import type { AddPersonInput } from '@/core/tracker';
import { UserFacingError, type IndexCheck, type Role, type Settings } from '@/core/types';
import { Dialog } from './Dialog';
import { Segmented } from './Segmented';
import './SettingsScreen.css';

export interface SettingsScreenProps {
  /** The web app link and the two rules. AppSettings fits. The key is never passed, so it can't be shown. */
  readonly settings: Pick<Settings, 'scriptUrl' | 'cooldownDays' | 'repostDueDays'>;
  /** The link is built into this version of the app (src/config.ts), so nobody types it. */
  readonly builtInLink?: boolean | undefined;
  /** The Team tab without its keys, in its own order. Null: not read yet, or the web app doesn't send it. */
  readonly team: readonly TeamMember[] | null;
  /** Who is signed in: they can't turn themselves off. */
  readonly me?: string | undefined;
  /** Puts text on the clipboard. Without it, there is no Copy button. */
  readonly onCopy?: ((text: string) => void) | undefined;
  /** The team is being read and hasn't arrived yet. */
  readonly loading?: boolean | undefined;
  /** Why the team couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
  /** Adds someone. Resolves with their key, shown once. Without it, no Add person. */
  readonly onAddPerson?: ((input: AddPersonInput) => Promise<{ readonly key: string }>) | undefined;
  /** Turns someone off or on. Without it, no row actions. */
  readonly onSetActive?: ((name: string, active: boolean) => Promise<unknown>) | undefined;
  /** Makes someone a new key; the old one stops working. Resolves with the new key, shown once. */
  readonly onNewKey?: ((name: string) => Promise<string>) | undefined;
  /** Compares the Directory with the listing checker's index. Without it, no Listings check. */
  readonly onIndexCheck?: (() => Promise<IndexCheck>) | undefined;
}

const ROLES: readonly Role[] = ['Intern', 'Admin'];
const FAILED = "That didn't work. Check your connection, then try again.";

const sentence = (err: unknown) => (err instanceof UserFacingError ? err.message : FAILED);

/** What a dialog on this screen is doing. */
type Open =
  | { readonly kind: 'add' }
  | { readonly kind: 'newKey'; readonly name: string }
  | { readonly kind: 'active'; readonly name: string; readonly active: boolean }
  | { readonly kind: 'key'; readonly name: string; readonly key: string; readonly added: boolean };

/**
 * The team and how Post-It is set up. The admin adds people, makes new keys
 * and turns people off here; the web app keeps the keys and shows each new
 * one once.
 */
export function SettingsScreen({
  settings,
  builtInLink = false,
  team,
  me,
  onCopy,
  loading = false,
  error,
  onAddPerson,
  onSetActive,
  onNewKey,
  onIndexCheck,
}: SettingsScreenProps) {
  const { scriptUrl, cooldownDays, repostDueDays } = settings;
  const url = scriptUrl.trim();
  const [open, setOpen] = useState<Open | null>(null);
  const close = () => setOpen(null);

  return (
    <div className="page settings">
      <header className="page-header">
        <h1 className="page-header__title" tabIndex={-1}>
          Settings
        </h1>
      </header>

      <div className="settings__panes">
        <div className="settings__main">
          <Card
            title="Team"
            actions={
              onAddPerson ? (
                <Button size="small" onClick={() => setOpen({ kind: 'add' })}>
                  Add person
                </Button>
              ) : undefined
            }
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
              <EmptyState headingLevel={3} title="Team not loaded">
                The web app didn&rsquo;t send it.
              </EmptyState>
            ) : team.length === 0 ? (
              <EmptyState headingLevel={3} title="Nobody on the team yet" />
            ) : (
              <TeamTable
                team={team}
                me={me}
                onNewKey={onNewKey ? (name) => setOpen({ kind: 'newKey', name }) : undefined}
                onSetActive={onSetActive ? (name, active) => setOpen({ kind: 'active', name, active }) : undefined}
              />
            )}
          </Card>
        </div>

        <div className="settings__side">
          {onIndexCheck ? <ListingsCheck onRun={onIndexCheck} /> : null}

          <Card title="Rules">
            <dl className="settings__rules">
              <div className="settings__rule">
                <dt>Cooldown</dt>
                <dd className="settings__value tabular">{plural(cooldownDays, 'day', 'days')}</dd>
              </div>
              <div className="settings__rule">
                <dt>Due for repost</dt>
                <dd className="settings__value tabular">{plural(repostDueDays, 'day', 'days')}</dd>
              </div>
            </dl>
            <p className="settings__note">Set in the web app. Its cooldown is the one that counts.</p>
          </Card>

          <Card title="Web app">
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
          </Card>
        </div>
      </div>

      {open?.kind === 'add' && onAddPerson ? (
        <AddPersonDialog
          team={team ?? []}
          onClose={close}
          onAdd={async (input) => {
            const { key } = await onAddPerson(input);
            setOpen({ kind: 'key', name: input.name, key, added: true });
          }}
        />
      ) : null}

      {open?.kind === 'newKey' && onNewKey ? (
        <ConfirmAction
          title={`New key for ${open.name}?`}
          body="Their current key stops working at once."
          confirmLabel="Make new key"
          busyLabel="Making…"
          onClose={close}
          onConfirm={async () => {
            const key = await onNewKey(open.name);
            setOpen({ kind: 'key', name: open.name, key, added: false });
          }}
        />
      ) : null}

      {open?.kind === 'active' && onSetActive ? (
        <ConfirmAction
          title={open.active ? `Turn on ${open.name}?` : `Turn off ${open.name}?`}
          body={open.active ? 'Their key works again.' : 'Their key stops working. Their posts stay.'}
          confirmLabel={open.active ? 'Turn on' : 'Turn off'}
          busyLabel={open.active ? 'Turning on…' : 'Turning off…'}
          onClose={close}
          onConfirm={async () => {
            await onSetActive(open.name, open.active);
            close();
          }}
        />
      ) : null}

      {open?.kind === 'key' ? (
        <KeyOnce name={open.name} keyText={open.key} added={open.added} onCopy={onCopy} onClose={close} />
      ) : null}
    </div>
  );
}

function TeamTable({
  team,
  me,
  onNewKey,
  onSetActive,
}: {
  readonly team: readonly TeamMember[];
  readonly me?: string | undefined;
  readonly onNewKey?: ((name: string) => void) | undefined;
  readonly onSetActive?: ((name: string, active: boolean) => void) | undefined;
}) {
  const withActions = Boolean(onNewKey || onSetActive);
  return (
    <div className="settings__table-wrap">
      <table className="settings__table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">FB accounts</th>
            <th scope="col">Active</th>
            {withActions ? (
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {team.map((member, index) => {
            const accounts = member.fbAccounts ?? [];
            const active = member.active !== false;
            const self = me !== undefined && samePerson(member.name, me);
            return (
              <tr key={`${index}-${member.name}`} className={active ? undefined : 'settings__row--off'}>
                <td className="settings__name">
                  {member.name}
                  {self ? <span className="settings__you">You</span> : null}
                </td>
                <td>{member.role}</td>
                <td>{accounts.length === 0 ? <span className="settings__muted">Any</span> : accounts.join(', ')}</td>
                <td>
                  {active ? (
                    <Pill tone="ok" dot>
                      Active
                    </Pill>
                  ) : (
                    <Pill tone="neutral">Off</Pill>
                  )}
                </td>
                {withActions ? (
                  <td className="settings__row-actions">
                    {self ? null : (
                      <>
                        {onNewKey && active ? (
                          <Button size="small" variant="quiet" onClick={() => onNewKey(member.name)} aria-label={`New key for ${member.name}`}>
                            New key
                          </Button>
                        ) : null}
                        {onSetActive ? (
                          <Button
                            size="small"
                            variant="quiet"
                            onClick={() => onSetActive(member.name, !active)}
                            aria-label={`${active ? 'Turn off' : 'Turn on'} ${member.name}`}
                          >
                            {active ? 'Turn off' : 'Turn on'}
                          </Button>
                        ) : null}
                      </>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Name, role and FB accounts. The key comes back from the web app, once. */
function AddPersonDialog({
  team,
  onAdd,
  onClose,
}: {
  readonly team: readonly TeamMember[];
  readonly onAdd: (input: AddPersonInput) => Promise<void>;
  readonly onClose: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('Intern');
  const [accounts, setAccounts] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setNameError('Type their name.');
      nameRef.current?.focus();
      return;
    }
    const existing = team.find((m) => samePerson(m.name, clean));
    if (existing) {
      setNameError(`${existing.name} is already on the team.`);
      nameRef.current?.focus();
      return;
    }
    const fbAccounts = accounts
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      await onAdd({ name: clean, role, fbAccounts });
    } catch (err) {
      setError(sentence(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add person"
      onClose={onClose}
      busy={busy}
      initialFocus={nameRef}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-person" variant="primary" busy={busy}>
            {busy ? 'Adding…' : 'Add person'}
          </Button>
        </>
      }
    >
      <form id="add-person" className="settings__form" onSubmit={(e) => void submit(e)} noValidate>
        <TextInput
          ref={nameRef}
          label="Name"
          autoComplete="off"
          value={name}
          readOnly={busy}
          error={nameError ?? undefined}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        <Segmented label="Role" options={ROLES} value={role} onChange={setRole} disabled={busy} />
        <TextInput
          label="FB accounts"
          autoComplete="off"
          value={accounts}
          readOnly={busy}
          placeholder="APG Main, APG Rentals South"
          hint="Separate with commas. Blank allows any."
          onChange={(e) => setAccounts(e.target.value)}
        />
        {error ? (
          <Notice tone="danger" live>
            {error}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Asked first. Focus starts on Cancel, so Enter or Escape changes nothing. */
function ConfirmAction({
  title,
  body,
  confirmLabel,
  busyLabel,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly busyLabel: string;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(sentence(err));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={busy}
      initialFocus={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void confirm()}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}

/** A key, shown this once. Closing forgets it. */
function KeyOnce({
  name,
  keyText,
  added,
  onCopy,
  onClose,
}: {
  readonly name: string;
  readonly keyText: string;
  readonly added: boolean;
  readonly onCopy?: ((text: string) => void) | undefined;
  readonly onClose: () => void;
}) {
  const doneRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={added ? `${name} added` : `New key for ${name}`}
      onClose={onClose}
      initialFocus={doneRef}
      actions={
        <Button ref={doneRef} variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="m-key">
        <span className="m-key__value" aria-label={`${firstName(name)}'s key`}>
          {keyText}
        </span>
        {onCopy ? (
          <Button size="small" variant="quiet" onClick={() => onCopy(keyText)} aria-label="Copy the key">
            Copy
          </Button>
        ) : null}
      </div>
      <p className="settings__once">
        <Icon name="warn" size={18} />
        You won&rsquo;t see this again. Send it to {firstName(name)} privately.
      </p>
    </Dialog>
  );
}

/** The Directory against the listing checker's index: counts, and the three lists folded. */
function ListingsCheck({ onRun }: { readonly onRun: () => Promise<IndexCheck> }) {
  const [result, setResult] = useState<IndexCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The checker is switched off or out of reach: nothing is wrong here, so one quiet line. */
  const [quiet, setQuiet] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setQuiet(null);
    try {
      setResult(await onRun());
    } catch (err) {
      if (err instanceof BackendError && (err.code === 'checker-off' || err.code === 'checker-unavailable')) {
        setResult(null);
        setQuiet(err.message);
      } else {
        setError(sentence(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Listings check"
      padding="tight"
      actions={
        <Button size="small" busy={busy} onClick={() => void run()}>
          {busy ? 'Checking…' : result ? 'Check again' : 'Check'}
        </Button>
      }
    >
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
      {result ? (
        <div className="check">
          <dl className="check__counts">
            <div>
              <dt>Directory</dt>
              <dd className="tabular">{result.directoryCount.toLocaleString('en-PH')}</dd>
            </div>
            <div>
              <dt>Checker</dt>
              <dd className="tabular">{result.checkerCount.toLocaleString('en-PH')}</dd>
            </div>
          </dl>
          <CheckList label="Only in Directory" items={result.directoryOnly.map((i) => ({ id: i.id, text: i.name }))} />
          <CheckList
            label="Only in checker"
            items={result.checkerOnly.map((i) => ({ id: i.id, text: i.name, sub: i.path }))}
          />
          <CheckList label="Sold" items={result.sold.map((i) => ({ id: i.id, text: i.name }))} />
          {result.checkedAt ? <p className="check__when">Checked {result.checkedAt}</p> : null}
        </div>
      ) : quiet ? (
        <p className="settings__muted" role="status">
          {quiet}
        </p>
      ) : !error ? (
        <p className="settings__muted">Directory against the checker&rsquo;s index.</p>
      ) : null}
    </Card>
  );
}

function CheckList({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly { readonly id: string; readonly text: string; readonly sub?: string }[];
}) {
  if (items.length === 0) {
    return (
      <p className="check__row check__row--none">
        <span>{label}</span>
        <span className="tabular">0</span>
      </p>
    );
  }
  return (
    <details className="check__group">
      <summary className="check__row">
        <span>{label}</span>
        <span className="tabular">{items.length.toLocaleString('en-PH')}</span>
      </summary>
      <ul className="check__list">
        {items.map((item) => (
          <li key={item.id || item.text}>
            {item.text}
            {item.sub ? <span className="check__sub">{item.sub}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
