import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Card, Notice, Pill, Spinner } from '../../components';
import {
  fridayWarning,
  fridayWarningWords,
  lastPostBy,
  monitorNames,
  samePerson,
  teamWeek,
  waitedFor,
  waitingPosts,
  type FridayWarning,
  type TeamMember,
  type TeamWeekRow,
} from '@/core/summary';
import type { ReportedPost } from '@/core/refused';
import { spotSample, spotTally, spotWords, type SpotCheck, type SpotItem, type SpotResult } from '@/core/spotchecks';
import { isWeekOver, weekDays } from '@/core/week';
import { initials, type Assignment, type PostLogEntry } from '@/core/types';
import { NoInterns } from './AssignPicker';
import { cleanProfiles, profilesOf as memberProfiles } from './FbAccountsField';
import { activityOf, ActivityCell, isBehind, lastPostWords, PacePill, WeekBar } from './InternsParts';
import { InternPanel } from './InternsPanel';
import { RefusedPosts } from './InternsRefused';
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
  /** The Spot checks tab; null until read, or when it can't be (a server before v16). Without it, no spot checks. */
  readonly spotChecks?: readonly SpotCheck[] | null | undefined;
  /** Saves a spot check. Rejects when it couldn't be saved, having said why. Without it, no spot checks. */
  readonly onSpotCheck?: ((post: PostLogEntry, result: SpotResult) => Promise<void>) | undefined;
  /** The Refused posts tab (v18); null until read, or when it can't be (an older server). Without it, none shown. */
  readonly refused?: readonly ReportedPost[] | null | undefined;
  /** Marks a refused post handled. Rejects when it couldn't be saved, having said why. */
  readonly onHandleRefused?: ((post: ReportedPost) => Promise<void>) | undefined;
  /** The team is Alpha Listing Hub's people (v13): with no agents, it says to add them there. */
  readonly managedInHub?: boolean | undefined;
}

/**
 * The weekly monitor, pared to what an admin looks for: is each agent posting,
 * how far through their queue they are, and whether that is on pace, worst
 * first. Everything else about an agent (the days, what waits for approval,
 * the spot checks, their queue) is in the panel a row opens. "Who posted?"
 * follows, for inquiries. Revoked people are kept apart, folded away.
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
  spotChecks,
  onSpotCheck,
  refused,
  onHandleRefused,
  managedInHub = false,
}: InternsScreenProps) {
  const [open, setOpen] = useState<string | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  // The agents, and each admin with a queue that week (D31), who is marked Admin.
  const shown = useMemo(() => (team ? monitorNames(team, week, assignments, today) : null), [team, week, assignments, today]);
  const rows = useMemo<readonly TeamWeekRow[]>(() => {
    if (!shown) return [];
    // Worst first, as teamWeek orders them; then those with no queue that week, who have nothing to be behind on.
    const all = teamWeek(shown.names, week, assignments, posts, today);
    return [...all.filter((r) => r.target > 0), ...all.filter((r) => r.target === 0)];
  }, [shown, week, assignments, posts, today]);
  // Warnings before each queue's deadline: from its third working day, who is behind and by how much, most left first.
  const behindForFriday = useMemo(
    () =>
      rows
        .map((row) => ({ name: row.name, warning: fridayWarning(row, week, today) }))
        .filter((r): r is { name: string; warning: FridayWarning } => r.warning !== null)
        .sort((a, b) => b.warning.left - a.warning.left),
    [rows, week, today],
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

  // Each agent's posts to spot check this week, by name: only once the checks are read.
  const spots = useMemo<ReadonlyMap<string, readonly SpotItem[]> | null>(() => {
    if (!spotChecks || !onSpotCheck) return null;
    return new Map(rows.map((r) => [r.name, spotSample(posts, r.name, week, spotChecks)]));
  }, [spotChecks, onSpotCheck, rows, posts, week]);

  const openRow = rows.find((r) => open !== null && samePerson(r.name, open));
  const profilesOf = (name: string) => cleanProfiles(memberProfiles(team?.find((m) => samePerson(m.name, name)) ?? null)).filter((p) => p.link);

  // A newly opened panel takes focus at its heading; closing it goes back to the row.
  useEffect(() => {
    if (openRow) panelHeading.current?.focus({ preventScroll: true });
  }, [openRow?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // A row gone from the week shown (an admin with no queue in it, D31) closes its
  // panel, so it doesn't come back by itself, taking focus, on the way back.
  useEffect(() => {
    if (open !== null && shown !== null && !openRow) setOpen(null);
  }, [open, shown, openRow]);

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
  // Today is in the week shown: the table can say who is posting. Another week says when each last posted.
  const live = weekDays(week).includes(today);
  const dayIndex = weekDays(week).indexOf(today);
  const lastOf = useMemo(() => new Map(rows.map((r) => [r.name, lastPostBy(posts, r.name)])), [rows, posts]);
  const activeToday = live ? rows.filter((r) => lastOf.get(r.name)?.date === today).length : 0;

  // The exceptions, by name: a failed spot check, or a post waiting two days or more for approval.
  // Nobody has one: the table has no column for them.
  const flags = useMemo(() => {
    const map = new Map<string, Flags>();
    for (const r of rows) {
      const failed = spots ? spotTally(spots.get(r.name) ?? []) : null;
      const waitingNow = waitingPosts(posts, r.name, today);
      const oldest = waitingNow[0];
      const flag: Flags = {
        checks: failed && failed.failed > 0 ? spotWords(failed) : null,
        waiting: oldest && oldest.days >= WAITING_OLD_DAYS ? `${waitingNow.length} waiting · oldest ${waitedFor(oldest.days)}` : null,
      };
      if (flag.checks || flag.waiting) map.set(r.name, flag);
    }
    return map;
  }, [rows, spots, posts, today]);

  return (
    <div className="page interns">
      <header className="page-header interns__header">
        <h1 className="page-header__title" tabIndex={-1}>
          Agents
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

      {refused && onHandleRefused ? <RefusedPosts refused={refused} onHandle={onHandleRefused} onOpenLink={onOpenLink} /> : null}

      {waiting ? (
        <div className="interns__waiting">
          <Spinner label="Reading the team" />
          <span>Reading the team…</span>
        </div>
      ) : team === null ? null : nobody ? (
        <NoInterns managedInHub={managedInHub} />
      ) : (
        <>
          <dl className="tracker-stats interns__stats">
            {live ? (
              <Stat label="Active today" value={activeToday} of={rows.length} />
            ) : (
              <Stat label={over ? 'Missed' : 'Left'} value={sum((r) => (over ? r.missed : r.notShared))} />
            )}
            <Stat label="Posted" value={sum((r) => r.posted + r.pending)} of={target} />
            <Stat label="Behind" value={behind} of={rows.length} />
          </dl>

          {behindForFriday.length > 0 ? (
            <Notice
              tone="warn"
              className="interns__friday"
              title={behindForFriday.length === 1 ? '1 agent behind schedule' : `${behindForFriday.length} agents behind schedule`}
            >
              <ul className="interns__friday-list">
                {behindForFriday.map(({ name, warning }) => (
                  <li key={name}>
                    <strong>{name}</strong>: {fridayWarningWords(warning)}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <div className={`interns__body${openRow ? ' interns__body--panel' : ''}`}>
            <Card className="interns__list" padding="tight">
              {rows.length === 0 ? (
                <p className="interns__quiet">No active agents.</p>
              ) : (
                <WeekTable
                  rows={rows}
                  admins={shown?.admins ?? NO_ADMINS}
                  today={today}
                  live={live}
                  dayIndex={dayIndex}
                  now={updatedAt}
                  lastOf={lastOf}
                  flags={flags}
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
                spot={spots && onSpotCheck ? { items: spots.get(openRow.name) ?? [], onCheck: onSpotCheck } : undefined}
              />
            ) : null}
          </div>

          {revoked.length > 0 ? <Revoked people={revoked} /> : null}
        </>
      )}

      <WhoPosted posts={posts} today={today} onOpenLink={onOpenLink} />
    </div>
  );
}

// ------------------------------------------------------------------ the week's table

const NO_ADMINS: ReadonlySet<string> = new Set();

/** A post waiting this many days for a group admin's approval is worth a look. */
const WAITING_OLD_DAYS = 2;

/** What about an agent needs a look, in words; null: nothing. */
interface Flags {
  readonly checks: string | null;
  readonly waiting: string | null;
}

interface WeekTableProps {
  readonly rows: readonly TeamWeekRow[];
  /** The rows that are an admin's queue (D31), by name as the rows have it: marked Admin. */
  readonly admins: ReadonlySet<string>;
  readonly today: string;
  /** Today is in the week shown: the second column says who is posting. Else it says when each last posted. */
  readonly live: boolean;
  /** Today's place in the week, 0 to 4; -1 when it isn't in it. */
  readonly dayIndex: number;
  /** When the rows were read, "10:42": what "posting now" is measured against. */
  readonly now: string | null | undefined;
  /** Each agent's last post, by name. */
  readonly lastOf: ReadonlyMap<string, PostLogEntry | undefined>;
  /** The agents with something that needs a look. Empty: no column. */
  readonly flags: ReadonlyMap<string, Flags>;
  /** Whose week is open beside the table. */
  readonly open: string | null;
  readonly onOpen: (name: string, button: HTMLButtonElement) => void;
}

/** Four things a row: who, are they posting, how far through the queue, and the pace. A row opens the rest. */
function WeekTable({ rows, admins, today, live, dayIndex, now, lastOf, flags, open, onOpen }: WeekTableProps) {
  return (
    <div className="week-table__wrap">
      <table className="week-table">
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">{live ? 'Activity' : 'Last post'}</th>
            <th scope="col">Queue</th>
            <th scope="col">Pace</th>
            {flags.size > 0 ? <th scope="col">Needs a look</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const last = lastOf.get(row.name);
            const selected = open !== null && samePerson(open, row.name);
            const flag = flags.get(row.name);
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
                    {admins.has(row.name) ? <span className="week-table__role">Admin</span> : null}
                  </button>
                </th>
                <td>
                  {live ? (
                    <ActivityCell activity={activityOf(row, last, today, now)} last={last} postedToday={row.byDay[dayIndex] ?? 0} today={today} />
                  ) : last ? (
                    <span className="tabular">{lastPostWords(last, today)}</span>
                  ) : (
                    <span className="interns__quiet">Never</span>
                  )}
                </td>
                <td className="week-table__queue">
                  <WeekBar progress={row} />
                </td>
                <td>
                  <PacePill progress={row} />
                </td>
                {flags.size > 0 ? (
                  <td>
                    {flag ? (
                      <span className="week-table__flags">
                        {flag.checks ? <Pill tone="danger">{flag.checks}</Pill> : null}
                        {flag.waiting ? <span className="week-table__flag tabular">{flag.waiting}</span> : null}
                      </span>
                    ) : null}
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
