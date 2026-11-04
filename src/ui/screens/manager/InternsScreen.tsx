import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Notice, Pill, Spinner } from '../../components';
import { activeInterns, lastPostBy, samePerson, teamWeek, waitedFor, waitingPosts, type TeamMember, type TeamWeekRow } from '@/core/summary';
import { isWeekOver, weekDays } from '@/core/week';
import { initials, type Assignment, type PostLogEntry } from '@/core/types';
import { cleanProfiles, profilesOf as memberProfiles } from './FbAccountsField';
import { DAY_LETTERS, isBehind, lastPostWords, PacePill, WeekBar, WeekDays } from './InternsParts';
import { InternPanel } from './InternsPanel';
import { WhoPosted } from './InternsWhoPosted';
import { Stat } from './Stat';
import { WeekPicker } from './WeekPicker';
import './InternsScreen.css';

export { lastPostWords, monitorWeek } from './InternsParts';

export interface InternsScreenProps {
  /** The week shown: its Monday, yyyy-MM-dd. */
  readonly week: string;
  /** Today on the tracker's calendar, yyyy-MM-dd. */
  readonly today: string;
  /** The Team tab without its keys; null until it has been read. */
  readonly team: readonly TeamMember[] | null;
  /** Every Posts row. */
  readonly posts: readonly PostLogEntry[];
  /** Every Assignments row. */
  readonly assignments: readonly Assignment[];
  /** Show another week (a Monday). */
  readonly onWeekChange: (week: string) => void;
  /** Read the team and the rows again: Refresh, and Try again after an error. */
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean | undefined;
  /** Why something couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
  /** When the rows were read, on the tracker's clock: "10:42". */
  readonly updatedAt?: string | null | undefined;
  /** Open Assign on this intern's queue for this week. Without it, no Open in Assign. */
  readonly onOpenQueue?: ((intern: string, week: string) => void) | undefined;
  /** Opens a link in the browser (platform.open). Without it, no Open buttons. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

/**
 * The weekly monitor: who has posted what this week and who is behind, worst
 * first, with "Who posted?" on top for inquiries. A row opens that intern's
 * week beside the list. Revoked people are kept apart, folded away.
 */
export function InternsScreen({
  week,
  today,
  team,
  posts,
  assignments,
  onWeekChange,
  onRefresh,
  refreshing = false,
  error,
  updatedAt,
  onOpenQueue,
  onOpenLink,
}: InternsScreenProps) {
  const [open, setOpen] = useState<string | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  const rows = useMemo<readonly TeamWeekRow[]>(
    () => (team ? teamWeek(activeInterns(team), week, assignments, posts, today) : []),
    [team, week, assignments, posts, today],
  );

  const revoked = useMemo<readonly TeamMember[]>(() => {
    if (!team) return [];
    const out: TeamMember[] = [];
    for (const member of team) {
      if (member.role !== 'Intern' || member.active !== false || !member.name.trim()) continue;
      if (rows.some((r) => samePerson(r.name, member.name)) || out.some((m) => samePerson(m.name, member.name))) continue;
      out.push(member);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [team, rows]);

  const openRow = rows.find((r) => open !== null && samePerson(r.name, open));
  const profilesOf = (name: string) => cleanProfiles(memberProfiles(team?.find((m) => samePerson(m.name, name)) ?? null)).filter((p) => p.link);

  // A newly opened panel takes focus at its heading; closing it goes back to the row.
  useEffect(() => {
    if (openRow) panelHeading.current?.focus({ preventScroll: true });
  }, [openRow?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setOpen(null);
    opener.current?.focus();
  };

  const waiting = team === null && !error;
  const nobody = team !== null && rows.length === 0 && revoked.length === 0;
  const over = isWeekOver(week, today);

  const sum = (pick: (r: TeamWeekRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const target = sum((r) => r.target);
  const behind = rows.filter(isBehind).length;

  return (
    <div className="page interns">
      <header className="page-header interns__header">
        <h1 className="page-header__title" tabIndex={-1}>
          Interns
        </h1>
        <div className="interns__controls">
          <WeekPicker week={week} today={today} onChange={onWeekChange} />
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

      <WhoPosted posts={posts} today={today} onOpenLink={onOpenLink} />

      {waiting ? (
        <div className="interns__waiting">
          <Spinner label="Reading the team" />
          <span>Reading the team…</span>
        </div>
      ) : team === null ? null : nobody ? (
        <Card>
          <EmptyState title="No interns yet">Add them in Settings → Team.</EmptyState>
        </Card>
      ) : (
        <>
          <dl className="tracker-stats interns__stats">
            <Stat label="Posted" value={sum((r) => r.posted)} of={target} />
            <Stat label="Pending" value={sum((r) => r.pending)} />
            <Stat label={over ? 'Missed' : 'Left'} value={sum((r) => (over ? r.missed : r.notShared))} />
            <Stat label="Behind" value={behind} of={rows.length} />
          </dl>

          <div className={`interns__body${openRow ? ' interns__body--panel' : ''}`}>
            <Card className="interns__list" padding="tight">
              {rows.length === 0 ? (
                <p className="interns__quiet">No active interns.</p>
              ) : (
                <WeekTable
                  rows={rows}
                  week={week}
                  today={today}
                  posts={posts}
                  open={openRow?.name ?? null}
                  onOpen={(name, button) => {
                    opener.current = button;
                    setOpen((now) => (now !== null && samePerson(now, name) ? null : name));
                  }}
                />
              )}
            </Card>

            {openRow ? (
              <InternPanel
                ref={panelHeading}
                key={openRow.name}
                row={openRow}
                week={week}
                today={today}
                posts={posts}
                assignments={assignments}
                profiles={profilesOf(openRow.name)}
                onClose={close}
                onOpenQueue={onOpenQueue ? () => onOpenQueue(openRow.name, week) : undefined}
                onOpenLink={onOpenLink}
              />
            ) : null}
          </div>

          {revoked.length > 0 ? <Revoked people={revoked} /> : null}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the week's table

interface WeekTableProps {
  readonly rows: readonly TeamWeekRow[];
  readonly week: string;
  readonly today: string;
  readonly posts: readonly PostLogEntry[];
  /** Whose week is open beside the table. */
  readonly open: string | null;
  readonly onOpen: (name: string, button: HTMLButtonElement) => void;
}

function WeekTable({ rows, week, today, posts, open, onOpen }: WeekTableProps) {
  const days = weekDays(week);
  return (
    <div className="week-table__wrap">
      <table className="week-table">
        <thead>
          <tr>
            <th scope="col">Intern</th>
            <th scope="col">Progress</th>
            <th scope="col">
              <span className="visually-hidden">Mon to Fri</span>
              <span className="week-table__days" aria-hidden="true">
                {DAY_LETTERS.map((letter, i) => (
                  <span key={days[i]} className={days[i] === today ? 'week-table__today' : undefined}>
                    {letter}
                  </span>
                ))}
              </span>
            </th>
            <th scope="col">Pace</th>
            <th scope="col">Waiting</th>
            <th scope="col" className="week-table__last">
              Last post
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const last = lastPostBy(posts, row.name);
            // Their posts waiting for the group admin's approval, oldest first (Pending reminders).
            const waiting = waitingPosts(posts, row.name, today);
            const oldest = waiting[0];
            const selected = open !== null && samePerson(open, row.name);
            return (
              <tr key={row.name} className={selected ? 'week-table__row week-table__row--open' : 'week-table__row'}>
                <th scope="row">
                  <button
                    type="button"
                    className="week-table__open"
                    aria-expanded={selected}
                    onClick={(event) => onOpen(row.name, event.currentTarget)}
                  >
                    <span className="avatar" aria-hidden="true">
                      {initials(row.name)}
                    </span>
                    <span className="week-table__name">{row.name}</span>
                  </button>
                </th>
                <td>
                  <WeekBar progress={row} />
                </td>
                <td>
                  <WeekDays byDay={row.byDay} week={week} today={today} target={row.target} />
                </td>
                <td>
                  <PacePill progress={row} />
                </td>
                <td className="tabular">
                  {oldest ? (
                    <span className={oldest.days >= 2 ? 'interns__waiting interns__waiting--old' : 'interns__waiting'}>
                      {waiting.length} · oldest {waitedFor(oldest.days)}
                    </span>
                  ) : (
                    <span className="interns__quiet">None</span>
                  )}
                </td>
                <td className="week-table__last tabular">{last ? lastPostWords(last, today) : <span className="interns__quiet">Never</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ revoked

function Revoked({ people }: { readonly people: readonly TeamMember[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <Card
      className="interns__revoked"
      padding="tight"
      title="Revoked"
      headingLevel={2}
      actions={
        <Button size="small" variant="quiet" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : `Show (${people.length})`}
        </Button>
      }
    >
      {open ? (
        <ul className="interns-revoked" id={listId}>
          {people.map((member) => {
            const accounts = member.fbAccounts ?? [];
            return (
              <li key={member.name} className="interns-revoked__row">
                <span className="avatar" aria-hidden="true">
                  {initials(member.name)}
                </span>
                <span className="interns-revoked__name">{member.name}</span>
                <Pill tone="neutral">Revoked</Pill>
                <span className="interns-revoked__accounts">{accounts.length === 0 ? 'Any FB account' : accounts.join(', ')}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
