import { useRef, useState, type FormEvent } from 'react';
import { Button, Notice, TextInput } from '../../components';
import { samePerson, type TeamMember } from '@/core/summary';
import type { AddPersonInput, UpdatePersonInput } from '@/core/tracker';
import { UserFacingError, type Role } from '@/core/types';
import { Dialog } from './Dialog';
import { cleanProfiles, FbAccountsField, profilesOf, profilesProblem, type ProfilesProblem } from './FbAccountsField';
import { Segmented } from './Segmented';
import { roleWord } from '@/core/types';

const ROLES: readonly Role[] = ['Intern', 'Admin'];
const FAILED = "That didn't work. Check your connection, then try again.";
const sentence = (err: unknown) => (err instanceof UserFacingError ? err.message : FAILED);

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
 * Add person, and Edit: the person's name, role, and their FB accounts: each
 * broker name they post as (picked when logging) with its own profile link.
 * Editing changes only the accounts. The key comes back from the web
 * app, once, after an add.
 */
export function PersonDialog(props: PersonDialogProps) {
  const editing = props.mode === 'edit';
  const member = editing ? props.member : null;

  const nameRef = useRef<HTMLInputElement>(null);
  const brokerRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'Intern');
  const [rows, setRows] = useState(() => profilesOf(member));
  const [nameError, setNameError] = useState<string | null>(null);
  const [rowsProblem, setRowsProblem] = useState<ProfilesProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const brokerRequired = role === 'Intern';
  const formId = editing ? 'edit-person' : 'add-person';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const clean = name.trim().replace(/\s+/g, ' ');
    let first: HTMLElement | null = null;

    if (!editing) {
      const existing = clean ? props.team.find((m) => samePerson(m.name, clean)) : undefined;
      const problem = !clean ? 'Type their name.' : existing ? `${existing.name} is already on the team.` : null;
      setNameError(problem);
      if (problem) first = nameRef.current;
    }
    const problem = profilesProblem(rows, brokerRequired);
    setRowsProblem(problem);
    if (problem) first ??= problemInput(problem);
    if (first) {
      first.focus();
      return;
    }

    const fbProfiles = cleanProfiles(rows);
    setBusy(true);
    setError(null);
    try {
      if (props.mode === 'edit') await props.onSave(props.member.name, { fbProfiles });
      else await props.onAdd({ name: clean, role, fbProfiles });
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
          label={role === 'Admin' ? 'Name' : 'Agent name'}
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
          <TextInput label="Role" value={roleWord(role)} readOnly />
        ) : (
          <Segmented label="Role" options={ROLES} labelOf={roleWord} value={role} onChange={setRole} disabled={busy} />
        )}
        <FbAccountsField
          rows={rows}
          onChange={(next) => {
            setRows(next);
            setRowsProblem(null);
          }}
          required={brokerRequired}
          readOnly={busy}
          problem={rowsProblem}
          firstRef={brokerRef}
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

/** The input a problem is about, to focus: the nth row's name or link. */
function problemInput(problem: ProfilesProblem): HTMLElement | null {
  const row = document.querySelectorAll('.fb-accounts__row')[problem.index];
  return row?.querySelectorAll('input')[problem.field === 'account' ? 0 : 1] ?? null;
}
