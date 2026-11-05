import { useMemo, useState } from 'react';
import { Card, EmptyState, Pill, SearchBox, type Tone } from '../../components';
import { plural, teamWeek, type TeamWeekRow } from '@/core/summary';
import type { Assignment, PostLogEntry } from '@/core/types';

export interface AssignPickerProps {
  /** Whose queues can be built, in the order to show them. */
  readonly interns: readonly string[];
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

/** Step one: whose queue. A card per intern: their name, the week's progress, one word. */
export function AssignPicker({ interns, week, assignments, posts, today, onPick }: AssignPickerProps) {
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () => cardOrder(teamWeek(interns, week, assignments, posts, today)),
    [interns, week, assignments, posts, today],
  );
  const q = query.trim().toLowerCase();
  const shown = q === '' ? rows : rows.filter((r) => r.name.toLowerCase().includes(q));

  return (
    <section className="assign-pick" aria-label="Agents this week">
      {interns.length >= SEARCH_FROM ? (
        <SearchBox label="Search agents" placeholder="Search" value={query} onValueChange={setQuery} className="assign-pick__search" />
      ) : null}
      {shown.length === 0 ? (
        <p className="assign__quiet assign-pick__none" role="status">
          No agent matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="assign-pick__grid" aria-label="Agents">
          {shown.map((row) => (
            <li key={row.name}>
              <InternCard row={row} onPick={() => onPick(row.name)} />
            </li>
          ))}
        </ul>
      )}
      <p className="visually-hidden" role="status">
        {q === '' ? '' : plural(shown.length, 'agent', 'agents')}
      </p>
    </section>
  );
}

function InternCard({ row, onPick }: { readonly row: TeamWeekRow; readonly onPick: () => void }) {
  const status = STATUS[cardStatus(row)];
  const done = row.posted + row.pending;
  const of = Math.max(row.target, 1);
  return (
    <button type="button" className="assign-pick__card" onClick={onPick}>
      <span className="assign-pick__top">
        <span className="assign-pick__name">{row.name}</span>
        <Pill tone={status.tone} dot className="assign-pick__pill">
          {status.label}
        </Pill>
      </span>
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

/** Nobody to pick yet. */
export function NoInterns() {
  return (
    <Card>
      <EmptyState title="No agents yet">Add them in Settings → Team.</EmptyState>
    </Card>
  );
}
