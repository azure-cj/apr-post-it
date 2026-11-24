import { useId, useMemo, useState, type ReactNode } from 'react';
import { Card, Chip, EmptyState, Icon, Pill, SearchBox, type Tone } from '../../components';
import { plural, samePerson, shortDate, teamWeek, type TeamWeekRow } from '@/core/summary';
import type { Assignment, PostLogEntry } from '@/core/types';

export interface AssignPickerProps {
  /** Whose queues can be built, in the order to show them. */
  readonly interns: readonly string[];
  /**
   * D31: the active admins, who may be given a queue too. They get a group of
   * their own after the agents; one who is also listed as an agent is shown once,
   * as an agent. None: the agents alone, as before.
   */
  readonly admins?: readonly string[] | undefined;
  /** Who is signed in: their own card says You. */
  readonly me?: string | undefined;
  /** The team is Alpha Listing Hub's people (v13): with no agents, it says to add them there. */
  readonly managedInHub?: boolean | undefined;
  /** The week shown, as its Monday. */
  readonly week: string;
  readonly assignments: readonly Assignment[];
  readonly posts: readonly PostLogEntry[];
  /** yyyy-MM-dd */
  readonly today: string;
  readonly onPick: (intern: string) => void;
}

/** The one word a card says about an intern's week. */
export type CardStatus = 'behind' | 'not-started' | 'missed' | 'no-queue' | 'on-track' | 'done';

export const STATUS: Record<CardStatus, { readonly label: string; readonly tone: Tone }> = {
  behind: { label: 'Behind', tone: 'warn' },
  'not-started': { label: 'Not started', tone: 'danger' },
  missed: { label: 'Missed', tone: 'danger' },
  'no-queue': { label: 'No queue', tone: 'neutral' },
  'on-track': { label: 'On track', tone: 'info' },
  done: { label: 'Done', tone: 'ok' },
};

/** Who needs a look first: behind, then not started, missed, no queue, on track, done. */
const ORDER: readonly CardStatus[] = ['behind', 'not-started', 'missed', 'no-queue', 'on-track', 'done'];

/** A team the size of a screen needs no search. */
const SEARCH_FROM = 9;

const NONE: readonly string[] = [];

/** Which cards show: everyone, those with a queue that week, or those without. */
type Show = 'all' | 'assigned' | 'none';

export function cardStatus(row: TeamWeekRow): CardStatus {
  return row.target === 0 ? 'no-queue' : row.pace;
}

/** The interns' weeks in the order to show them: who needs a look first. teamWeek's order breaks ties. */
export function cardOrder(rows: readonly TeamWeekRow[]): TeamWeekRow[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => ORDER.indexOf(cardStatus(a.row)) - ORDER.indexOf(cardStatus(b.row)) || a.i - b.i)
    .map(({ row }) => row);
}

/**
 * Step one: whose queue. A card per agent: their name, the week's progress, one
 * word. With admins (D31), a second group of the same cards after the agents'.
 */
export function AssignPicker({ interns, admins = NONE, me, managedInHub = false, week, assignments, posts, today, onPick }: AssignPickerProps) {
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const agentRows = useMemo(
    () => cardOrder(teamWeek(interns, week, assignments, posts, today)),
    [interns, week, assignments, posts, today],
  );
  const adminRows = useMemo(() => {
    const own = admins.filter((name) => !interns.some((n) => samePerson(n, name)));
    return cardOrder(teamWeek(own, week, assignments, posts, today));
  }, [admins, interns, week, assignments, posts, today]);

  const grouped = adminRows.length > 0;
  const q = query.trim().toLowerCase();
  const everyone = [...agentRows, ...adminRows];
  const assigned = everyone.filter((r) => r.target > 0).length;
  const without = everyone.length - assigned;
  // Nothing left to tell apart: the chips go, and so does a choice that would show no one.
  const shown: Show = assigned === 0 || without === 0 ? 'all' : show;
  const matches = (r: TeamWeekRow) =>
    (q === '' || r.name.toLowerCase().includes(q)) && (shown === 'all' || (shown === 'assigned') === r.target > 0);
  const agentsShown = agentRows.filter(matches);
  const adminsShown = adminRows.filter(matches);
  const found = agentsShown.length + adminsShown.length;
  const card = (row: TeamWeekRow) => (
    <li key={row.name}>
      <InternCard row={row} you={me !== undefined && samePerson(row.name, me)} onPick={() => onPick(row.name)} />
    </li>
  );

  return (
    <section className="assign-pick" aria-label={grouped ? 'Agents and admins this week' : 'Agents this week'}>
      {agentRows.length + adminRows.length >= SEARCH_FROM ? (
        <SearchBox
          label={grouped ? 'Search people' : 'Search agents'}
          placeholder="Search"
          value={query}
          onValueChange={setQuery}
          className="assign-pick__search"
        />
      ) : null}
      {assigned > 0 && without > 0 ? (
        <div className="assign-pick__show" role="group" aria-label="Show">
          <Chip selected={shown === 'all'} count={everyone.length} onSelectedChange={() => setShow('all')}>
            Everyone
          </Chip>
          <Chip selected={shown === 'assigned'} count={assigned} onSelectedChange={() => setShow('assigned')}>
            Has a queue
          </Chip>
          <Chip selected={shown === 'none'} count={without} onSelectedChange={() => setShow('none')}>
            No queue yet
          </Chip>
        </div>
      ) : null}
      {found === 0 && q !== '' ? (
        <p className="assign__quiet assign-pick__none" role="status">
          {grouped ? 'No one matches' : 'No agent matches'} “{query.trim()}”.
        </p>
      ) : grouped ? (
        <>
          {agentRows.length === 0 ? (
            <Group title="Agents" empty={`No agents yet. ${addThem(managedInHub)}`} />
          ) : agentsShown.length > 0 ? (
            <Group title="Agents">{agentsShown.map(card)}</Group>
          ) : null}
          {adminsShown.length > 0 ? <Group title="Admins">{adminsShown.map(card)}</Group> : null}
        </>
      ) : (
        <ul className="assign-pick__grid" aria-label="Agents">
          {agentsShown.map(card)}
        </ul>
      )}
      <p className="visually-hidden" role="status">
        {q === '' ? '' : grouped ? plural(found, 'person', 'people') : plural(found, 'agent', 'agents')}
      </p>
    </section>
  );
}

/** One group of cards under its own small heading, which names the list. `empty`: a line instead, when it has nobody. */
function Group({ title, empty, children }: { readonly title: string; readonly empty?: string; readonly children?: ReactNode }) {
  const id = useId();
  return (
    <div className="assign-pick__group">
      <h2 className="assign-pick__heading" id={id}>
        {title}
      </h2>
      {empty ? (
        <p className="assign__quiet">{empty}</p>
      ) : (
        <ul className="assign-pick__grid" aria-labelledby={id}>
          {children}
        </ul>
      )}
    </div>
  );
}

function InternCard({ row, you, onPick }: { readonly row: TeamWeekRow; readonly you: boolean; readonly onPick: () => void }) {
  const status = STATUS[cardStatus(row)];
  const done = row.posted + row.pending;
  const of = Math.max(row.target, 1);
  const has = row.target > 0;
  return (
    <button type="button" className={`assign-pick__card assign-pick__card--${has ? 'assigned' : 'none'}`} onClick={onPick}>
      <span className="assign-pick__top">
        <span className="assign-pick__who">
          <span className="assign-pick__name">{row.name}</span>
          {you ? <span className="assign-pick__you">You</span> : null}
        </span>
        <Pill tone={status.tone} dot className="assign-pick__pill">
          {status.label}
        </Pill>
      </span>
      {has ? (
        <span className="assign-pick__queue assign-pick__queue--assigned">
          <Icon name="pass" size={18} className="assign-pick__queue-icon" />
          <span>
            Queue assigned · {plural(row.target, 'listing', 'listings')}
            {row.period ? ` · due ${shortDate(row.period.due)}` : ''}
          </span>
        </span>
      ) : (
        <span className="assign-pick__queue">
          <span className="assign-pick__queue-plus" aria-hidden="true">
            +
          </span>
          <span>Nothing assigned yet</span>
        </span>
      )}
      <span className="assign-pick__progress">
        <span className="assign-pick__bar" aria-hidden="true">
          <span className="assign-pick__bar-posted" style={{ width: `${(Math.min(row.posted, of) / of) * 100}%` }} />
          <span
            className="assign-pick__bar-pending"
            style={{ width: `${(Math.min(row.pending, Math.max(of - row.posted, 0)) / of) * 100}%` }}
          />
        </span>
        <span className="assign-pick__count tabular">
          {row.target === 0 ? (
            '–'
          ) : (
            <>
              {done} / {row.target}
              <span className="visually-hidden">
                {' '}
                posted{row.pending > 0 ? `, ${row.pending} pending` : ''}
              </span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/** Where agents are added: Settings → Team, or, signed in by account, the hub's People screen (v13). */
function addThem(managedInHub: boolean): string {
  return managedInHub ? "Add them on Alpha Listing Hub's People screen." : 'Add them in Settings → Team.';
}

/** No agents yet: Assign's first step, and the Agents screen. */
export function NoInterns({ managedInHub = false }: { readonly managedInHub?: boolean | undefined }) {
  return (
    <Card>
      <EmptyState title="No agents yet">{addThem(managedInHub)}</EmptyState>
    </Card>
  );
}
