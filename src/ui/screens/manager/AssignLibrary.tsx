import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, CategoryDot, Chip, Icon, SearchBox, categoryLabel, type CategoryKind } from '../../components';
import { MenuButton } from './AssignMenu';
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
 * The library for one queue: category chips with what's free in each, a
 * search, and a Filter menu (Fresh, Due for repost, Show unavailable). What
 * can't be added is hidden unless asked for.
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
          placeholder="Search name, city or building"
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            resetPage();
          }}
        />
        <MenuButton label="Filter" count={[fresh, due, showOff].filter(Boolean).length} className="lib__filter">
          {() => (
            <fieldset className="menu__group">
              <legend className="visually-hidden">Filter</legend>
              <FilterCheck label="Fresh" checked={fresh} onChange={(on) => { setFresh(on); resetPage(); }} />
              <FilterCheck label="Due for repost" checked={due} onChange={(on) => { setDue(on); resetPage(); }} />
              <FilterCheck label="Show unavailable" checked={showOff} onChange={(on) => { setShowOff(on); resetPage(); }} />
            </fieldset>
          )}
        </MenuButton>
      </div>

      <p className="visually-hidden" role="status">
        {plural(rows.length, 'listing', 'listings')}
      </p>

      {rows.length === 0 ? (
        <p className="assign__quiet lib__none">
          {query.trim() !== ''
            ? `No match for “${query.trim()}”${tab === 'all' ? '' : ` in ${scope}`}.`
            : fresh || due
              ? 'Nothing matches the filter.'
              : `Nothing free in ${scope}.`}
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
              ? `${shown.length} of ${rows.length.toLocaleString('en-PH')}`
              : plural(rows.length, 'listing', 'listings')}
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

function FilterCheck({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (on: boolean) => void }) {
  return (
    <label className="menu__check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export const FILL_MAX = 200;

/** One step of the quick fill's stepper: by 5, by 1 below 5. */
export function stepCount(n: number, by: 1 | -1): number {
  const step = (by > 0 ? n : n - 1) < 5 ? 1 : 5;
  const next = by > 0 ? Math.floor(n / step) * step + step : Math.ceil(n / step) * step - step;
  return Math.max(1, Math.min(FILL_MAX, next));
}

export interface QuickFillProps {
  readonly count: number;
  readonly onCount: (n: number) => void;
  /** The tab's name, for the button's accessible name: "Warehouse", "All". */
  readonly scope: string;
  readonly onFill: (count: number) => void;
  readonly disabled: boolean;
}

/** "Add 40" from the tab shown, with − and + either side to change how many. */
export function QuickFill({ count, onCount, scope, onFill, disabled }: QuickFillProps) {
  return (
    <div className="quick-fill" role="group" aria-label="Quick fill">
      <button
        type="button"
        className="quick-fill__step"
        aria-label="Fewer"
        disabled={disabled || count <= 1}
        onClick={() => onCount(stepCount(count, -1))}
      >
        <span aria-hidden="true">−</span>
      </button>
      <Button
        size="small"
        className="quick-fill__add tabular"
        disabled={disabled}
        aria-label={scope === 'All' ? `Add ${count}` : `Add ${count} from ${scope}`}
        onClick={() => onFill(count)}
      >
        Add {count}
      </Button>
      <button
        type="button"
        className="quick-fill__step"
        aria-label="More"
        disabled={disabled || count >= FILL_MAX}
        onClick={() => onCount(stepCount(count, 1))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
