import { useMemo, useState } from 'react';
import { Card, EmptyState, SearchBox } from '../../components';
import { plural, samePerson } from '@/core/summary';
import { initials, queueStatus, type Assignment, type TeamMember } from '@/core/types';
import { dayMonth } from './assignListing';

export interface AssignPickerProps {
  /** Whose queues can be built, in the order to show them. */
  readonly interns: readonly string[];
  /** The Team tab, for each intern's FB broker name. Missing: names only. */
  readonly team?: readonly TeamMember[] | undefined;
  readonly assignments: readonly Assignment[];
  /** yyyy-MM-dd */
  readonly today: string;
  readonly onPick: (intern: string) => void;
}

interface Line {
  readonly name: string;
  readonly fb: string;
  /** Their Not Shared items, on any date. */
  readonly open: number;
  /** The days those are on, oldest first. */
  readonly openDays: readonly string[];
  readonly todayTotal: number;
  readonly todayPosted: number;
}

const MAX_DAYS = 3;

function linesOf(interns: readonly string[], team: readonly TeamMember[] | undefined, assignments: readonly Assignment[], today: string): Line[] {
  return interns.map((name) => {
    const member = team?.find((m) => samePerson(m.name, name));
    const accounts = (member?.fbAccounts ?? []).map((a) => a.trim()).filter(Boolean);
    const days = new Set<string>();
    let open = 0;
    let todayTotal = 0;
    let todayPosted = 0;
    for (const row of assignments) {
      if (!samePerson(row.assignedTo, name)) continue;
      const status = queueStatus(row.status);
      if (status === 'Not Shared') {
        open++;
        days.add(row.date);
      }
      if (row.date === today) {
        todayTotal++;
        if (status === 'Posted') todayPosted++;
      }
    }
    return {
      name,
      fb: accounts.length === 0 ? 'Any FB account' : accounts.join(', '),
      open,
      openDays: [...days].sort(),
      todayTotal,
      todayPosted,
    };
  });
}

function openWords(line: Line): string {
  if (line.open === 0) return 'Nothing open';
  const shown = line.openDays.slice(0, MAX_DAYS).map(dayMonth).join(', ');
  const more = line.openDays.length > MAX_DAYS ? ` +${line.openDays.length - MAX_DAYS}` : '';
  return `${line.open} not shared · ${shown}${more}`;
}

/** Step one: whose queue. A card per active intern with what they have open now. */
export function AssignPicker({ interns, team, assignments, today, onPick }: AssignPickerProps) {
  const [query, setQuery] = useState('');
  const lines = useMemo(() => linesOf(interns, team, assignments, today), [interns, team, assignments, today]);
  const q = query.trim().toLowerCase();
  const shown = q === '' ? lines : lines.filter((l) => l.name.toLowerCase().includes(q) || l.fb.toLowerCase().includes(q));

  return (
    <Card className="assign-pick" title="Choose an intern" actions={
      <SearchBox label="Search interns" placeholder="Search by name" value={query} onValueChange={setQuery} className="assign-pick__search" />
    }>
      {shown.length === 0 ? (
        <p className="assign__quiet assign-pick__none" role="status">No intern matches “{query.trim()}”.</p>
      ) : (
        <ul className="assign-pick__grid" aria-label="Interns">
          {shown.map((line) => (
            <li key={line.name}>
              <button type="button" className="assign-pick__card" onClick={() => onPick(line.name)}>
                <span className="assign-pick__avatar" aria-hidden="true">
                  {initials(line.name)}
                </span>
                <span className="assign-pick__who">
                  <span className="assign-pick__name">{line.name}</span>
                  <span className="assign-pick__fb">{line.fb}</span>
                </span>
                <span className={`assign-pick__open${line.open > 0 ? ' assign-pick__open--some' : ''}`}>
                  {openWords(line)}
                </span>
                <span className="assign-pick__today">
                  <span className="assign-pick__today-words tabular">
                    {line.todayTotal === 0 ? 'No queue today' : `${line.todayPosted} of ${line.todayTotal} posted today`}
                  </span>
                  <span className="assign-pick__bar" aria-hidden="true">
                    {line.todayTotal > 0 ? (
                      <span className="assign-pick__bar-fill" style={{ transform: `scaleX(${line.todayPosted / line.todayTotal})` }} />
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="visually-hidden" role="status">
        {q === '' ? '' : plural(shown.length, 'intern', 'interns')}
      </p>
    </Card>
  );
}

/** Nobody to pick yet. */
export function NoInterns() {
  return (
    <Card>
      <EmptyState title="No interns yet">Add them in Settings → Team.</EmptyState>
    </Card>
  );
}
