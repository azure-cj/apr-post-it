import { useId } from 'react';
import { Button, CategoryTag, SearchBox } from '../../components';
import { plural, type AssignCheck, type AssignRules } from '@/core/summary';
import type { Property } from '@/core/types';
import { AddedButton, PostingWarning, StatusWord } from './AssignParts';

/** More than this and the list stops being something anyone reads: type to narrow it. */
export const RESULT_LIMIT = 50;

// ------------------------------------------------------------------ search

export interface SearchPanelProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly results: readonly Property[];
  readonly total: number;
  readonly rules: AssignRules | null;
  readonly inQueue: ReadonlySet<string>;
  readonly today: string;
  readonly intern: string | null;
  readonly onAdd: (property: Property) => void;
}

export function SearchPanel({ query, onQuery, results, total, rules, inQueue, today, intern, onAdd }: SearchPanelProps) {
  const q = query.trim();
  const shown = results.slice(0, RESULT_LIMIT);
  const count =
    results.length === 0
      ? ''
      : q === ''
        ? results.length > RESULT_LIMIT
          ? `Showing the first ${RESULT_LIMIT} of ${plural(total, 'listing', 'listings')}. Type to narrow the list.`
          : `Showing all ${plural(results.length, 'listing', 'listings')}.`
        : results.length > RESULT_LIMIT
          ? `Showing the first ${RESULT_LIMIT} of ${results.length.toLocaleString('en-PH')} listings that match “${q}”. Keep typing to narrow the list.`
          : `${plural(results.length, 'listing matches', 'listings match')} “${q}”.`;

  return (
    <div className="assign-search">
      <SearchBox
        label="Search the library"
        placeholder="Search by name, city or building"
        value={query}
        onValueChange={onQuery}
      />
      <p className="assign__count" role="status">
        {count}
      </p>
      {results.length === 0 ? (
        <p className="assign__quiet">
          {q === '' ? 'The library is empty. It fills once the directory has been read.' : `No listing matches “${q}”. Check the spelling, or try part of the name.`}
        </p>
      ) : (
        <ul className="assign-results">
          {shown.map((property) => (
            <ResultRow
              key={property.id}
              property={property}
              check={rules?.check(property) ?? null}
              added={rules !== null && inQueue.has(rules.entryFor(property).key)}
              today={today}
              intern={intern}
              onAdd={() => onAdd(property)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ResultRowProps {
  readonly property: Property;
  /** Null before an intern is chosen. */
  readonly check: AssignCheck | null;
  readonly added: boolean;
  readonly today: string;
  readonly intern: string | null;
  readonly onAdd: () => void;
}

function ResultRow({ property, check, added, today, intern, onAdd }: ResultRowProps) {
  const reasonId = useId();
  const blockedByCooldown = check?.block === 'cooldown';
  return (
    <li className={['assign-result', check && !check.canAdd && !added ? 'assign-result--blocked' : null].filter(Boolean).join(' ')}>
      <div className="assign-result__body">
        <p className="assign-result__name">{property.name}</p>
        <div className="assign-result__meta">
          <CategoryTag category={property.category} />
          {check ? <StatusWord check={check} today={today} intern={intern} /> : null}
        </div>
        {blockedByCooldown && !added ? (
          <p className="assign-result__reason" id={reasonId}>
            {check.reason}
          </p>
        ) : null}
        {check?.canAdd !== false || added ? <PostingWarning property={property} className="assign-warning" /> : null}
      </div>
      {added ? (
        <AddedButton>Added</AddedButton>
      ) : (
        <Button
          size="small"
          disabled={!check?.canAdd}
          aria-label={`Add ${property.name}`}
          aria-describedby={blockedByCooldown ? reasonId : undefined}
          onClick={onAdd}
        >
          Add
        </Button>
      )}
    </li>
  );
}
