import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, CategoryDot, Chip, Icon, SearchBox, categoryLabel, type CategoryKind } from '../../components';
import { plural } from '@/core/summary';
import type { Property } from '@/core/types';
import { byPriority, lastPostedWords, placeWords, type ListingState } from './assignListing';

/** Rows shown at a time; "Show more" adds as many again. */
export const RESULT_LIMIT = 40;

export type CategoryTab = 'all' | CategoryKind;

export interface LibraryPanelProps {
  /** Every listing's state for this queue. */
  readonly states: readonly ListingState[];
  /** Keys of what's in the queue now. */
  readonly inQueue: ReadonlySet<string>;
  readonly keyOf: (property: Property) => string;
  readonly today: string;
  /** Which listings match a search, by the directory's own rule. */
  readonly search: (query: string) => ReadonlySet<string> | null;
  readonly onAdd: (property: Property) => void;
  readonly tab: CategoryTab;
  readonly onTab: (tab: CategoryTab) => void;
}

const KIND_ORDER: readonly CategoryKind[] = ['warehouse', 'commercial', 'office', 'condo', 'unsorted'];

/** The tab's name: "Warehouse", "Commercial space", "Other". */
export function tabLabel(tab: CategoryTab, states: readonly ListingState[]): string {
  if (tab === 'all') return 'All';
  if (tab === 'unsorted') return 'Other';
  const row = states.find((s) => s.kind === tab);
  return row ? categoryLabel(row.property.category) : tab;
}

/**
 * The library for one queue: category tabs with what's free in each, a search,
 * Fresh / Due for repost, and what can't be added hidden unless asked for.
 */
export function LibraryPanel({
  states,
  inQueue,
  keyOf,
  today,
  search,
  onAdd,
  tab,
  onTab,
}: LibraryPanelProps) {
  const [query, setQuery] = useState('');
  const [fresh, setFresh] = useState(false);
  const [due, setDue] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const [limit, setLimit] = useState(RESULT_LIMIT);
  const listRef = useRef<HTMLUListElement>(null);

  const counts = useMemo(() => {
    const map = new Map<CategoryKind, number>();
    let all = 0;
    for (const s of states) {
      if (s.unavailable) continue;
      all++;
      map.set(s.kind, (map.get(s.kind) ?? 0) + 1);
    }
    const present = new Set(states.map((s) => s.kind));
    const kinds = KIND_ORDER.filter((k) => present.has(k)).sort((a, b) => {
      if (a === 'unsorted') return 1;
      if (b === 'unsorted') return -1;
      return (map.get(b) ?? 0) - (map.get(a) ?? 0);
    });
    return { all, map, kinds };
  }, [states]);

  const matched = useMemo(() => search(query), [search, query]);

  const rows = useMemo(() => {
    const off = (s: ListingState) => Boolean(s.unavailable) && !inQueue.has(keyOf(s.property));
    const out = states.filter((s) => {
      if (tab !== 'all' && s.kind !== tab) return false;
      if (off(s) && !showOff) return false;
      if ((fresh || due) && !((fresh && s.fresh) || (due && s.due))) return false;
      if (matched && !matched.has(s.property.id || s.property.name)) return false;
      return true;
    });
    // In posting priority, the order quick fill takes them in; what can't go in sits where it would be.
    return out.sort(byPriority);
  }, [states, tab, showOff, fresh, due, matched, inQueue, keyOf]);

  const resetPage = () => setLimit(RESULT_LIMIT);
  const shown = rows.slice(0, limit);
  const scope = tabLabel(tab, states);

  // Up and Down move between the rows' buttons.
  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.lib-row__button') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next = buttons[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div className="lib">
      <div className="lib__tabs" role="group" aria-label="Category">
        <Chip selected={tab === 'all'} count={counts.all} onSelectedChange={() => { onTab('all'); resetPage(); }}>
          All
        </Chip>
        {counts.kinds.map((kind) => (
          <Chip
            key={kind}
            selected={tab === kind}
            leading={<CategoryDot kind={kind} />}
            count={counts.map.get(kind) ?? 0}
            onSelectedChange={() => {
              onTab(kind);
              resetPage();
            }}
          >
            {tabLabel(kind, states)}
          </Chip>
        ))}
      </div>

      <div className="lib__find">
        <SearchBox
          label="Search listings"
          placeholder="Search by name, city or building"
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            resetPage();
          }}
        />
        <div className="lib__filters" role="group" aria-label="Filters">
          <Chip selected={fresh} onSelectedChange={(on) => { setFresh(on); resetPage(); }}>
            Fresh
          </Chip>
          <Chip selected={due} onSelectedChange={(on) => { setDue(on); resetPage(); }}>
            Due for repost
          </Chip>
          <Chip selected={showOff} onSelectedChange={(on) => { setShowOff(on); resetPage(); }}>
            Show unavailable
          </Chip>
        </div>
      </div>

      <p className="visually-hidden" role="status">
        {plural(rows.length, 'listing', 'listings')}
      </p>

      {rows.length === 0 ? (
        <p className="assign__quiet lib__none">
          {query.trim() !== ''
            ? `No listing matches “${query.trim()}”${tab === 'all' ? '' : ` in ${scope}`}.`
            : fresh || due
              ? 'Nothing here matches those filters.'
              : `Nothing in ${scope} can go in this queue.`}
        </p>
      ) : (
        <ul className="lib__list" ref={listRef} onKeyDown={onListKey} aria-label={`${scope} listings`}>
          {shown.map((state) => (
            <LibraryRow
              key={state.property.id || state.property.name}
              state={state}
              added={inQueue.has(keyOf(state.property))}
              today={today}
              showCategory={tab === 'all'}
              onAdd={() => onAdd(state.property)}
            />
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <div className="lib__more">
          <span className="assign__quiet tabular">
            {rows.length > shown.length
              ? `${shown.length} of ${plural(rows.length, 'listing', 'listings')}`
              : plural(rows.length, 'listing', 'listings')}{' '}
            · never posted first
          </span>
          {rows.length > shown.length ? (
            <Button size="small" variant="quiet" onClick={() => setLimit((l) => l + RESULT_LIMIT)}>
              Show {Math.min(RESULT_LIMIT, rows.length - shown.length)} more
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface LibraryRowProps {
  readonly state: ListingState;
  readonly added: boolean;
  readonly today: string;
  readonly showCategory: boolean;
  readonly onAdd: () => void;
}

function LibraryRow({ state, added, today, showCategory, onAdd }: LibraryRowProps) {
  const metaId = useId();
  const { property } = state;
  // Already in the queue (an earlier day's own item, moved here): it reads as added.
  const unavailable = added ? undefined : state.unavailable;
  const place = placeWords(property);
  const meta = (
    <span className="lib-row__meta" id={metaId}>
      {showCategory ? (
        <span className="lib-row__cat">
          <CategoryDot kind={state.kind} />
          {categoryLabel(property.category)}
        </span>
      ) : null}
      {place ? <span>{place}</span> : null}
      {unavailable ? (
        <span className="lib-row__reason">{unavailable.reason}</span>
      ) : (
        <span className={state.fresh ? 'lib-row__fresh' : state.due ? 'lib-row__due' : undefined}>
          {lastPostedWords(state, today)}
          {state.due ? ' · due' : ''}
        </span>
      )}
    </span>
  );

  if (unavailable) {
    return (
      <li className="lib-row lib-row--off">
        <span className="lib-row__body">
          <span className="lib-row__name">
            <span className="visually-hidden">Can't add: </span>
            {property.name}
          </span>
          {meta}
        </span>
        <Icon name="fail" size={18} className="lib-row__off-icon" />
      </li>
    );
  }

  return (
    <li className={`lib-row${added ? ' lib-row--added' : ''}`}>
      <button
        type="button"
        className="lib-row__button"
        aria-label={added ? `${property.name}, in the queue` : `Add ${property.name}`}
        aria-describedby={metaId}
        aria-disabled={added || undefined}
        onClick={() => {
          if (!added) onAdd();
        }}
      >
        <span className="lib-row__body">
          <span className="lib-row__name">{property.name}</span>
          {meta}
        </span>
        <span className="lib-row__act" aria-hidden="true">
          {added ? (
            <>
              <Icon name="check" size={16} /> Added
            </>
          ) : (
            'Add'
          )}
        </span>
      </button>
    </li>
  );
}

export interface QuickFillProps {
  readonly count: string;
  readonly onCount: (text: string) => void;
  /** The tab's name, for the field's label: "Warehouse", "All". */
  readonly scope: string;
  readonly onFill: (count: number) => void;
  readonly disabled: boolean;
}

/** "Add 20 for posting": how many, from the tab shown. */
export function QuickFill({ count, onCount, scope, onFill, disabled }: QuickFillProps) {
  const id = useId();
  const n = Number.parseInt(count, 10);
  const valid = Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 0;
  return (
    <div className="lib__fill">
      <label className="visually-hidden" htmlFor={id}>
        How many to add from {scope}
      </label>
      <input
        id={id}
        className="field__input lib__fill-count tabular"
        type="number"
        inputMode="numeric"
        min={1}
        max={100}
        value={count}
        onChange={(event) => onCount(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && valid > 0 && !disabled) onFill(valid);
        }}
      />
      <Button icon={<Icon name="assign" size={18} />} disabled={valid === 0 || disabled} onClick={() => onFill(valid)}>
        {valid > 0 ? `Add ${valid} for posting` : 'Add for posting'}
      </Button>
    </div>
  );
}
