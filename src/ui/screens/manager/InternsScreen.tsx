import { useId, useMemo, useState } from 'react';
import { Button, Card, EmptyState, Notice, Pill, SearchBox, Spinner } from '../../components';
import {
  addDays,
  internDays,
  lastPostBy,
  samePerson,
  shortDate,
  type TeamMember,
} from '@/core/summary';
import { initials, type Assignment, type PostLogEntry } from '@/core/types';
import { DayPicker } from './DayPicker';
import { Stat } from './Stat';
import './InternsScreen.css';

export interface InternsScreenProps {
  /** The day whose queues are shown, yyyy-MM-dd. */
  readonly date: string;
  /** Today on the tracker's calendar, yyyy-MM-dd. */
  readonly today: string;
  /** The Team tab without its keys; null until it has been read. */
  readonly team: readonly TeamMember[] | null;
  /** Every Posts row. */
  readonly posts: readonly PostLogEntry[];
  /** Every Assignments row. */
  readonly assignments: readonly Assignment[];
  /** Show another day. */
  readonly onDateChange: (date: string) => void;
  /** Read the team and the rows again: Refresh, and Try again after an error. */
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean | undefined;
  /** Why something couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
  /** When the rows were read, on the tracker's clock: "10:42". */
  readonly updatedAt?: string | null | undefined;
  /** Open Assign for this intern on this day. Without it, no queue actions. */
  readonly onOpenQueue?: ((intern: string, date: string) => void) | undefined;
}

interface InternLine {
  readonly name: string;
  readonly total: number;
  readonly posted: number;
  readonly pendingPosts: number;
  readonly last: PostLogEntry | undefined;
  readonly accounts: readonly string[];
}

/**
 * Everyone on the team who posts, in one place: the day's queue and how far
 * along it is, posts still waiting for approval, when each last posted, and the
 * FB accounts they may use. Revoked people are kept apart, folded away.
 */
export function InternsScreen({
  date,
  today,
  team,
  posts,
  assignments,
  onDateChange,
  onRefresh,
  refreshing = false,
  error,
  updatedAt,
  onOpenQueue,
}: InternsScreenProps) {
  const [query, setQuery] = useState('');

  const lines = useMemo<readonly InternLine[]>(() => {
    if (!team) return [];
    return internDays(team, assignments, posts, date).map((day) => ({
      ...day,
      last: lastPostBy(posts, day.name),
      accounts: team.find((m) => samePerson(m.name, day.name))?.fbAccounts ?? [],
    }));
  }, [team, assignments, posts, date]);

  const revoked = useMemo<readonly TeamMember[]>(() => {
    if (!team) return [];
    const out: TeamMember[] = [];
    for (const member of team) {
      if (member.role !== 'Intern' || member.active !== false || !member.name.trim()) continue;
      if (lines.some((l) => samePerson(l.name, member.name)) || out.some((m) => samePerson(m.name, member.name))) continue;
      out.push(member);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [team, lines]);

  const q = query.trim().toLowerCase();
  const matches = (name: string) => q === '' || name.toLowerCase().includes(q);
  const shownLines = lines.filter((l) => matches(l.name));
  const shownRevoked = revoked.filter((m) => matches(m.name));

  const isToday = date === today;
  const day = shortDate(date);
  const tomorrow = addDays(today, 1);
  const waiting = team === null && !error;
  const nobody = team !== null && lines.length === 0 && revoked.length === 0;

  const withQueue = lines.filter((l) => l.total > 0);
  const done = withQueue.filter((l) => l.posted === l.total).length;
  const withPending = lines.filter((l) => l.pendingPosts > 0).length;

  return (
    <div className="page interns">
      <header className="page-header interns__header">
        <div className="interns__heading">
          <h1 className="page-header__title" tabIndex={-1}>
            Interns
          </h1>
        </div>
        <div className="interns__day">
          <DayPicker date={date} today={today} onChange={onDateChange} label="Day shown" quick={['today', 'tomorrow']} />
          {onRefresh ? (
            <Button size="small" busy={refreshing} onClick={onRefresh}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          ) : null}
          {updatedAt ? <span className="interns__updated">Updated {updatedAt}</span> : null}
        </div>
      </header>

      {error ? (
        <Notice
          tone="danger"
          live
          className="interns__notice"
          action={
            onRefresh ? (
              <Button size="small" onClick={onRefresh}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {error}
        </Notice>
      ) : null}

      {waiting ? (
        <div className="interns__waiting">
          <Spinner label="Reading the team" />
          <span>Reading the team…</span>
        </div>
      ) : team === null ? null : nobody ? (
        <Card>
          <EmptyState title="No interns yet">
            Add them in Settings → Team.
          </EmptyState>
        </Card>
      ) : (
        <>
          <dl className="tracker-stats">
            <Stat label="Active interns" value={lines.length} note={revoked.length > 0 ? `${revoked.length} revoked` : undefined} />
            <Stat
              label={isToday ? 'Done today' : `Done ${day}`}
              value={done}
              of={withQueue.length}
              note={withQueue.length === 0 ? `No queues for ${day}` : undefined}
            />
            <Stat label="With pending posts" value={withPending} note="Waiting for group approval" />
            <Stat label={isToday ? 'No queue today' : `No queue ${day}`} value={lines.length - withQueue.length} />
          </dl>

          <Card
            title="Active interns"
            description={`Queues for ${isToday ? 'today' : day}`}
            actions={
              <SearchBox
                className="interns__search"
                label="Search interns by name"
                placeholder="Search by name"
                value={query}
                onValueChange={setQuery}
              />
            }
          >
            {lines.length === 0 ? (
              <p className="interns__quiet">No active interns.</p>
            ) : shownLines.length === 0 ? (
              <p className="interns__quiet">No active intern&rsquo;s name matches &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <InternTable
                lines={shownLines}
                today={today}
                queueHeading={isToday ? 'Today’s queue' : `Queue ${day}`}
                onOpenQueue={onOpenQueue ? (name) => onOpenQueue(name, date) : undefined}
                onPlanTomorrow={onOpenQueue ? (name) => onOpenQueue(name, tomorrow) : undefined}
              />
            )}
          </Card>

          {revoked.length > 0 ? <Revoked people={shownRevoked} total={revoked.length} query={query.trim()} /> : null}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the table

interface InternTableProps {
  readonly lines: readonly InternLine[];
  readonly today: string;
  readonly queueHeading: string;
  readonly onOpenQueue?: ((name: string) => void) | undefined;
  readonly onPlanTomorrow?: ((name: string) => void) | undefined;
}

function InternTable({ lines, today, queueHeading, onOpenQueue, onPlanTomorrow }: InternTableProps) {
  const actions = Boolean(onOpenQueue || onPlanTomorrow);
  return (
    <div className="interns-table__wrap">
      <table className="interns-table">
        <thead>
          <tr>
            <th scope="col">Intern</th>
            <th scope="col">{queueHeading}</th>
            <th scope="col">Pending</th>
            <th scope="col">Last post</th>
            <th scope="col">FB accounts</th>
            {actions ? (
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.name}>
              <th scope="row">
                <span className="interns-table__who">
                  <span className="interns-table__avatar" aria-hidden="true">
                    {initials(line.name)}
                  </span>
                  <span className="interns-table__name">{line.name}</span>
                </span>
              </th>
              <td>
                <Progress line={line} />
              </td>
              <td>
                {line.pendingPosts > 0 ? (
                  <Pill tone="warn" dot>
                    {line.pendingPosts} pending
                  </Pill>
                ) : (
                  <span className="interns__muted tabular">None</span>
                )}
              </td>
              <td className="interns-table__last tabular">
                {line.last ? lastPostWords(line.last, today) : <span className="interns__muted">Never</span>}
              </td>
              <td className="interns-table__accounts">
                {line.accounts.length === 0 ? <span className="interns__muted">Any</span> : line.accounts.join(', ')}
              </td>
              {actions ? (
                <td className="interns-table__actions">
                  {onOpenQueue ? (
                    <Button variant="link" aria-label={`Open queue of ${line.name}`} onClick={() => onOpenQueue(line.name)}>
                      Open queue
                    </Button>
                  ) : null}
                  {onPlanTomorrow ? (
                    <Button
                      variant="link"
                      aria-label={`Plan tomorrow for ${line.name}`}
                      onClick={() => onPlanTomorrow(line.name)}
                    >
                      Plan tomorrow
                    </Button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "2 of 5 posted" over a bar; the words carry it, the bar shows the share. */
function Progress({ line }: { readonly line: InternLine }) {
  const { total, posted } = line;
  if (total === 0) return <span className="interns__muted">No queue</span>;
  // "5 of 5 posted" already says done; a pill beside it would wrap and make
  // that row taller than the rest.
  return (
    <div className="interns-progress">
      <span className="interns-progress__count tabular">
        {posted} of {total} posted
      </span>
      <div className="interns-progress__bar" aria-hidden="true">
        <span className="interns-progress__posted" style={{ width: `${(posted / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** "Today, 09:41", "Yesterday, 16:02", "Thu 29 Oct, 10:00". */
export function lastPostWords(post: PostLogEntry, today: string): string {
  const when = post.date === today ? 'Today' : post.date === addDays(today, -1) ? 'Yesterday' : shortDate(post.date);
  return post.time ? `${when}, ${post.time}` : when;
}

// ------------------------------------------------------------------ revoked

function Revoked({ people, total, query }: { readonly people: readonly TeamMember[]; readonly total: number; readonly query: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <Card
      className="interns__revoked"
      title="Revoked"
      description="Turn them on in Settings → Team."
      actions={
        <Button size="small" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide revoked' : `Show revoked (${total})`}
        </Button>
      }
    >
      {open ? (
        people.length === 0 ? (
          <p className="interns__quiet" id={listId}>
            No revoked name matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="interns-revoked" id={listId}>
            {people.map((member) => {
              const accounts = member.fbAccounts ?? [];
              return (
                <li key={member.name} className="interns-revoked__row">
                  <span className="interns-table__avatar" aria-hidden="true">
                    {initials(member.name)}
                  </span>
                  <span className="interns-revoked__name">{member.name}</span>
                  <Pill tone="neutral">Revoked</Pill>
                  <span className="interns-revoked__accounts">
                    FB accounts: {accounts.length === 0 ? 'Any' : accounts.join(', ')}
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </Card>
  );
}
