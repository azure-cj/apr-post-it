import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Chip, EmptyState, Icon, Notice, PAGE_SIZE, Pagination, Pill, SearchBox, Spinner, TextInput, usePaged } from '../../components';
import { facebookProfileProblem, normalizeProfileLink } from '@/core/links';
import { addDays, samePerson, shortDate, type TeamMember } from '@/core/summary';
import type { AddPersonInput, UpdatePersonInput } from '@/core/tracker';
import type { PostLogEntry } from '@/core/types';
import { lastPostWords } from './InternsScreen';
import { PersonDialog } from './PersonDialog';
import { ConfirmAction, KeyOnce, sentence } from './SettingsShared';

export interface SettingsTeamProps {
  /** The Team tab without its keys, in its own order. Null: not read yet, or the web app doesn't send it. */
  readonly team: readonly TeamMember[] | null;
  /** Who is signed in: they can't turn themselves off or make themselves a new key. */
  readonly me?: string | undefined;
  /** Every Posts row, for "This week". Null while they are read. */
  readonly posts?: readonly PostLogEntry[] | null | undefined;
  /** Today, yyyy-MM-dd (Manila). */
  readonly today: string;
  readonly loading?: boolean | undefined;
  /** Why the team couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
  readonly onAddPerson?: ((input: AddPersonInput) => Promise<{ readonly key: string; readonly warning?: string }>) | undefined;
  readonly onSetActive?: ((name: string, active: boolean) => Promise<unknown>) | undefined;
  readonly onUpdatePerson?: ((name: string, changes: UpdatePersonInput) => Promise<unknown>) | undefined;
  readonly onNewKey?: ((name: string) => Promise<string>) | undefined;
  readonly onOpenLink?: ((url: string) => void) | undefined;
  readonly onCopy?: ((text: string) => void) | undefined;
  /** Opens the Interns screen, where an intern's queue and posts are. */
  readonly onOpenInterns?: (() => void) | undefined;
}

/** Add person lives in the page header (the screen's one gold button); this tab runs its dialogs. */
interface AddingProps {
  readonly adding?: boolean | undefined;
  readonly onAddingChange?: ((adding: boolean) => void) | undefined;
}

type Filter = 'interns' | 'admins' | 'off';

/** What a dialog on this tab is doing. */
type Open =
  | { readonly kind: 'newKey'; readonly name: string }
  | { readonly kind: 'active'; readonly name: string; readonly active: boolean }
  | { readonly kind: 'key'; readonly name: string; readonly key: string; readonly added: boolean; readonly warning?: string };

const isOn = (m: TeamMember) => m.active !== false;

/** Monday of today's week. */
function weekStart(today: string): string {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((day + 6) % 7));
}

/**
 * The team as a slim table with a search and filters. A row opens the person
 * in a side panel: their details (edited in place), this week's posts, and
 * their access.
 */
export function SettingsTeam({
  team,
  me,
  posts,
  today,
  loading = false,
  error,
  onAddPerson,
  onSetActive,
  onUpdatePerson,
  onNewKey,
  onOpenLink,
  onCopy,
  onOpenInterns,
  adding = false,
  onAddingChange,
}: SettingsTeamProps & AddingProps) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReadonlySet<Filter>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const close = () => setOpen(null);

  const people = team ?? [];
  const counts = useMemo(
    () => ({
      interns: people.filter((m) => m.role === 'Intern').length,
      admins: people.filter((m) => m.role === 'Admin').length,
      off: people.filter((m) => !isOn(m)).length,
    }),
    [people],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const roles = filters.has('interns') || filters.has('admins');
    return people.filter((m) => {
      if (roles && !((filters.has('interns') && m.role === 'Intern') || (filters.has('admins') && m.role === 'Admin'))) return false;
      if (filters.has('off') && isOn(m)) return false;
      if (!q) return true;
      return [m.name, ...(m.fbAccounts ?? [])].some((text) => text.toLowerCase().includes(q));
    });
  }, [people, query, filters]);

  const member = picked ? people.find((m) => samePerson(m.name, picked)) ?? null : null;
  const paged = usePaged(shown, PAGE_SIZE, [query.trim().toLowerCase(), ...[...filters].sort()].join('|'));

  const toggle = (filter: Filter, on: boolean) =>
    setFilters((now) => {
      const next = new Set(now);
      if (on) next.add(filter);
      else next.delete(filter);
      return next;
    });

  const closePanel = () => {
    const name = picked;
    setPicked(null);
    if (name) rows.current.get(name)?.focus();
  };

  const body = error ? (
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
    <EmptyState headingLevel={3} title="No one yet">
      Add your first intern.
    </EmptyState>
  ) : shown.length === 0 ? (
    <EmptyState
      headingLevel={3}
      title="No one matches"
      action={
        <Button
          size="small"
          onClick={() => {
            setQuery('');
            setFilters(new Set());
          }}
        >
          Clear filters
        </Button>
      }
    />
  ) : (
    <>
      <table className="team-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">FB broker name</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody ref={paged.topRef}>
          {paged.items.map((m, index) => {
            const self = me !== undefined && samePerson(m.name, me);
            const selected = member !== null && samePerson(m.name, member.name);
            const accounts = m.fbAccounts ?? [];
            return (
              <tr
                key={`${index}-${m.name}`}
                className={['team-table__row', selected ? 'team-table__row--on' : null, isOn(m) ? null : 'team-table__row--off']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setPicked(m.name)}
              >
                <td className="team-table__name">
                  <button
                    type="button"
                    className="team-table__open"
                    aria-expanded={selected}
                    ref={(el) => {
                      if (el) rows.current.set(m.name, el);
                      else rows.current.delete(m.name);
                    }}
                  >
                    {m.name}
                  </button>
                  {self ? <span className="settings__you">You</span> : null}
                  {m.role === 'Admin' ? <span className="team-table__role">Admin</span> : null}
                </td>
                <td>{accounts.length === 0 ? <span className="settings__muted">—</span> : accounts.join(', ')}</td>
                <td>
                  {isOn(m) ? (
                    <Pill tone="ok" dot>
                      Active
                    </Pill>
                  ) : (
                    <Pill tone="neutral">Turned off</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pagination {...paged.pagination} className="team__pages" />
    </>
  );

  return (
    <div className={['team', member ? 'team--panel' : null].filter(Boolean).join(' ')}>
      <div className="team__main">
        <div className="team__bar">
          <SearchBox
            className="team__search"
            label="Search the team"
            placeholder="Search the team"
            value={query}
            onValueChange={setQuery}
          />
          <div className="team__chips" role="group" aria-label="Show only">
            <Chip selected={filters.has('interns')} onSelectedChange={(on) => toggle('interns', on)} count={counts.interns}>
              Interns
            </Chip>
            <Chip selected={filters.has('admins')} onSelectedChange={(on) => toggle('admins', on)} count={counts.admins}>
              Admins
            </Chip>
            <Chip selected={filters.has('off')} onSelectedChange={(on) => toggle('off', on)} count={counts.off}>
              Turned off
            </Chip>
          </div>
        </div>
        <div className="card team__card">{body}</div>
      </div>

      {member ? (
        <PersonPanel
          key={member.name}
          member={member}
          self={me !== undefined && samePerson(member.name, me)}
          posts={posts ?? null}
          today={today}
          onClose={closePanel}
          onUpdatePerson={onUpdatePerson}
          onOpenLink={onOpenLink}
          onOpenInterns={onOpenInterns}
          onNewKey={onNewKey && isOn(member) ? () => setOpen({ kind: 'newKey', name: member.name }) : undefined}
          onSetActive={onSetActive ? (active) => setOpen({ kind: 'active', name: member.name, active }) : undefined}
        />
      ) : null}

      {adding && onAddPerson ? (
        <PersonDialog
          mode="add"
          team={people}
          onClose={() => onAddingChange?.(false)}
          onAdd={async (input) => {
            const { key, warning } = await onAddPerson(input);
            onAddingChange?.(false);
            setOpen({ kind: 'key', name: input.name, key, added: true, ...(warning ? { warning } : {}) });
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
        <KeyOnce name={open.name} keyText={open.key} added={open.added} warning={open.warning} onCopy={onCopy} onClose={close} />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ side panel

function PersonPanel({
  member,
  self,
  posts,
  today,
  onClose,
  onUpdatePerson,
  onOpenLink,
  onOpenInterns,
  onNewKey,
  onSetActive,
}: {
  readonly member: TeamMember;
  readonly self: boolean;
  readonly posts: readonly PostLogEntry[] | null;
  readonly today: string;
  readonly onClose: () => void;
  readonly onUpdatePerson?: ((name: string, changes: UpdatePersonInput) => Promise<unknown>) | undefined;
  readonly onOpenLink?: ((url: string) => void) | undefined;
  readonly onOpenInterns?: (() => void) | undefined;
  readonly onNewKey?: (() => void) | undefined;
  readonly onSetActive?: ((active: boolean) => void) | undefined;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const active = isOn(member);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <aside className="person-panel" aria-labelledby={headingId} onKeyDown={onKeyDown}>
      <header className="person-panel__head">
        <div className="person-panel__who">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="person-panel__name">
            {member.name}
            {self ? <span className="settings__you">You</span> : null}
          </h2>
          <p className="person-panel__role">
            {member.role}
            {active ? '' : ' · Turned off'}
          </p>
        </div>
        <Button variant="quiet" size="small" className="person-panel__close" onClick={onClose} aria-label="Close" icon={<Icon name="close" />} />
      </header>

      <section className="person-panel__section" aria-label="Details">
        <h3 className="person-panel__title">Details</h3>
        <Details member={member} onUpdatePerson={onUpdatePerson} onOpenLink={onOpenLink} />
      </section>

      <section className="person-panel__section" aria-label="This week">
        <h3 className="person-panel__title">
          This week <span className="person-panel__since">since {shortDate(weekStart(today))}</span>
        </h3>
        <Week name={member.name} posts={posts} today={today} />
        {onOpenInterns && member.role === 'Intern' ? (
          <Button variant="link" onClick={onOpenInterns}>
            See their queue in Interns
          </Button>
        ) : null}
      </section>

      <section className="person-panel__section person-panel__access" aria-label="Access">
        <h3 className="person-panel__title">Access</h3>
        {self ? (
          <p className="settings__muted">This is you. Another admin can change your access.</p>
        ) : (
          <>
            {active ? null : <p className="settings__muted">Their key doesn&rsquo;t work.</p>}
            <div className="person-panel__actions">
              {onNewKey ? (
                <Button size="small" onClick={onNewKey}>
                  New key
                </Button>
              ) : null}
              {onSetActive ? (
                <Button size="small" onClick={() => onSetActive(!active)}>
                  {active ? 'Turn off' : 'Turn on'}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </aside>
  );
}

/** Role, FB broker name and FB profile link; the last two edited in place. */
function Details({
  member,
  onUpdatePerson,
  onOpenLink,
}: {
  readonly member: TeamMember;
  readonly onUpdatePerson?: ((name: string, changes: UpdatePersonInput) => Promise<unknown>) | undefined;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}) {
  const fromTeam = { broker: (member.fbAccounts ?? []).join(', '), link: member.fbProfileLink?.trim() ?? '' };
  /** What the web app holds: the team's row, then what each Save sent. */
  const [base, setBase] = useState(fromTeam);
  const [broker, setBroker] = useState(fromTeam.broker);
  const [link, setLink] = useState(fromTeam.link);
  // The team read again with different values (changed elsewhere): show them, unless edits are under way.
  useEffect(() => {
    setBase((b) => (b.broker === fromTeam.broker && b.link === fromTeam.link ? b : fromTeam));
  }, [fromTeam.broker, fromTeam.link]);
  const savedBroker = base.broker;
  const savedLink = base.link;
  const [brokerError, setBrokerError] = useState<string | null>(null);
  const [linkChecked, setLinkChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const brokerRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  const editable = Boolean(onUpdatePerson);
  const dirty = broker.trim() !== savedBroker || link.trim() !== savedLink;
  const linkProblem = facebookProfileProblem(link);
  const openable = savedLink !== '' && !facebookProfileProblem(savedLink);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !onUpdatePerson || !dirty) return;
    const fbAccounts = broker
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const brokerProblem = member.role === 'Intern' && fbAccounts.length === 0 ? 'Type their FB broker name.' : null;
    setBrokerError(brokerProblem);
    setLinkChecked(true);
    if (brokerProblem) {
      brokerRef.current?.focus();
      return;
    }
    if (linkProblem) {
      linkRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const fbProfileLink = normalizeProfileLink(link);
      await onUpdatePerson(member.name, { fbAccounts, fbProfileLink });
      // As the team will read once it is fetched again.
      const kept = { broker: fbAccounts.join(', '), link: fbProfileLink };
      setBase(kept);
      setBroker(kept.broker);
      setLink(kept.link);
      setSaved(true);
    } catch (err) {
      setError(sentence(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id={formId} className="person-details" onSubmit={(e) => void submit(e)} noValidate>
      <TextInput
        ref={brokerRef}
        label={
          <>
            FB broker name{member.role === 'Intern' ? null : <span className="settings__optional"> (optional)</span>}
          </>
        }
        autoComplete="off"
        spellCheck={false}
        value={broker}
        readOnly={!editable || busy}
        error={brokerError ?? undefined}
        onChange={(e) => {
          setBroker(e.target.value);
          setBrokerError(null);
          setSaved(false);
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
        readOnly={!editable || busy}
        placeholder="https://www.facebook.com/…"
        error={linkChecked && linkProblem ? linkProblem : undefined}
        onBlur={() => setLinkChecked(link.trim() !== '')}
        onChange={(e) => {
          setLink(e.target.value);
          setSaved(false);
        }}
        end={
          openable && onOpenLink && !dirty ? (
            <Button variant="quiet" size="small" onClick={() => onOpenLink(savedLink)} aria-label={`Open ${member.name}'s Facebook profile`}>
              Open
            </Button>
          ) : undefined
        }
      />
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
      {editable ? (
        <div className="person-details__save">
          <Button type="submit" size="small" busy={busy} disabled={!dirty && !busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {dirty && !busy ? (
            <Button
              size="small"
              variant="quiet"
              onClick={() => {
                setBroker(savedBroker);
                setLink(savedLink);
                setBrokerError(null);
                setLinkChecked(false);
              }}
            >
              Undo
            </Button>
          ) : null}
          <span className="person-details__saved" role="status">
            {saved && !dirty ? 'Saved' : ''}
          </span>
        </div>
      ) : null}
    </form>
  );
}

/** Posted and pending since Monday, and the last post ever. */
function Week({ name, posts, today }: { readonly name: string; readonly posts: readonly PostLogEntry[] | null; readonly today: string }) {
  const from = weekStart(today);
  const stats = useMemo(() => {
    if (!posts) return null;
    let posted = 0;
    let pending = 0;
    let last: PostLogEntry | null = null;
    for (const p of posts) {
      if (!samePerson(p.postedBy, name)) continue;
      if (p.date >= from && p.date <= today) {
        if (p.status === 'Pending') pending += 1;
        else posted += 1;
      }
      if (!last || `${p.date} ${p.time}` > `${last.date} ${last.time}`) last = p;
    }
    return { posted, pending, last };
  }, [posts, name, from, today]);

  if (!stats) {
    return (
      <div className="settings__waiting">
        <Spinner size="small" label="Reading posts" />
        <span>Reading posts…</span>
      </div>
    );
  }
  return (
    <dl className="person-week">
        <div>
          <dt>Posted</dt>
          <dd className="tabular">{stats.posted.toLocaleString('en-PH')}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd className="tabular">{stats.pending.toLocaleString('en-PH')}</dd>
        </div>
        <div className="person-week__last">
          <dt>Last post</dt>
          <dd>{stats.last ? lastPostWords(stats.last, today) : 'None yet'}</dd>
        </div>
    </dl>
  );
}
