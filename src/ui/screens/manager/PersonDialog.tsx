import { useRef, useState, type FormEvent } from 'react';
import { Button, Notice, TextInput } from '../../components';
import { facebookProfileProblem, normalizeProfileLink } from '@/core/links';
import { samePerson, type TeamMember } from '@/core/summary';
import type { AddPersonInput, UpdatePersonInput } from '@/core/tracker';
import { UserFacingError, type Role } from '@/core/types';
import { Dialog } from './Dialog';
import { Segmented } from './Segmented';

const ROLES: readonly Role[] = ['Intern', 'Admin'];
const FAILED = "That didn't work. Check your connection, then try again.";
const sentence = (err: unknown) => (err instanceof UserFacingError ? err.message : FAILED);

/** "CYRUS ORBANO, APG Main" -> ['CYRUS ORBANO', 'APG Main']. */
const brokerNames = (text: string) =>
  text
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

export type PersonDialogProps =
  | {
      readonly mode: 'add';
      /** Who is on the team already: a name taken is said before asking. */
      readonly team: readonly TeamMember[];
      readonly onAdd: (input: AddPersonInput) => Promise<void>;
      readonly onClose: () => void;
    }
  | {
      readonly mode: 'edit';
      /** The person changed. Their name and role are shown, not changed. */
      readonly member: TeamMember;
      readonly onSave: (name: string, changes: UpdatePersonInput) => Promise<void>;
      readonly onClose: () => void;
    };

/**
 * Add person, and Edit: the person's name, role, FB broker name (the Facebook
 * account name they post as, which they pick when logging) and FB profile
 * link. Editing changes only the last two. The key comes back from the web
 * app, once, after an add.
 */
export function PersonDialog(props: PersonDialogProps) {
  const editing = props.mode === 'edit';
  const member = editing ? props.member : null;

  const nameRef = useRef<HTMLInputElement>(null);
  const brokerRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'Intern');
  const [broker, setBroker] = useState((member?.fbAccounts ?? []).join(', '));
  const [link, setLink] = useState(member?.fbProfileLink ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [brokerError, setBrokerError] = useState<string | null>(null);
  /** The link is checked as it is typed once it has been left, or Add pressed. */
  const [linkChecked, setLinkChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linkProblem = facebookProfileProblem(link);
  const brokerRequired = role === 'Intern';
  const formId = editing ? 'edit-person' : 'add-person';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const clean = name.trim().replace(/\s+/g, ' ');
    const fbAccounts = brokerNames(broker);
    let first: HTMLInputElement | null = null;

    if (!editing) {
      const existing = clean ? props.team.find((m) => samePerson(m.name, clean)) : undefined;
      const problem = !clean ? 'Type their name.' : existing ? `${existing.name} is already on the team.` : null;
      setNameError(problem);
      if (problem) first = nameRef.current;
    }
    const brokerProblem = brokerRequired && fbAccounts.length === 0 ? 'Type their FB broker name.' : null;
    setBrokerError(brokerProblem);
    if (brokerProblem) first ??= brokerRef.current;
    setLinkChecked(true);
    if (linkProblem) first ??= linkRef.current;
    if (first) {
      first.focus();
      return;
    }

    const fbProfileLink = normalizeProfileLink(link);
    setBusy(true);
    setError(null);
    try {
      if (props.mode === 'edit') await props.onSave(props.member.name, { fbAccounts, fbProfileLink });
      else await props.onAdd({ name: clean, role, fbAccounts, fbProfileLink });
    } catch (err) {
      setError(sentence(err));
      setBusy(false);
    }
  };

  const verb = editing ? 'Save' : 'Add person';
  return (
    <Dialog
      title={editing ? `Edit ${props.member.name}` : 'Add person'}
      onClose={props.onClose}
      busy={busy}
      initialFocus={editing ? brokerRef : nameRef}
      actions={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            {busy ? (editing ? 'Saving…' : 'Adding…') : verb}
          </Button>
        </>
      }
    >
      <form id={formId} className="settings__form" onSubmit={(e) => void submit(e)} noValidate>
        <TextInput
          ref={nameRef}
          label={role === 'Admin' ? 'Name' : 'Intern name'}
          autoComplete="off"
          value={name}
          readOnly={busy || editing}
          error={nameError ?? undefined}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        {editing ? (
          <TextInput label="Role" value={role} readOnly />
        ) : (
          <Segmented label="Role" options={ROLES} value={role} onChange={setRole} disabled={busy} />
        )}
        <TextInput
          ref={brokerRef}
          label={
            <>
              FB broker name{brokerRequired ? null : <span className="settings__optional"> (optional)</span>}
            </>
          }
          autoComplete="off"
          spellCheck={false}
          value={broker}
          readOnly={busy}
          placeholder="CYRUS ORBANO"
          hint="The name shown on Facebook."
          error={brokerError ?? undefined}
          onChange={(e) => {
            setBroker(e.target.value);
            setBrokerError(null);
          }}
        />
        <TextInput
          ref={linkRef}
          label={
            <>
              FB profile link<span className="settings__optional"> (optional)</span>
            </>
          }
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={link}
          readOnly={busy}
          placeholder="https://www.facebook.com/…"
          error={linkChecked && linkProblem ? linkProblem : undefined}
          onBlur={() => setLinkChecked(link.trim() !== '')}
          onChange={(e) => setLink(e.target.value)}
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
