import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { normalizeForSearch } from '@/core/directory';
import type { Property } from '@/core/types';
import {
  Button,
  CategoryDot,
  Chip,
  EmptyState,
  Icon,
  Notice,
  Pill,
  SearchBox,
  categoryKind,
  categoryLabel,
} from '../../components';
import {
  manilaDate,
  manilaTime,
  paths,
  useApp,
  useDirectoryList,
  useDirectoryStatus,
  useFindState,
  type FromList,
} from '../../state';
import { count, folderLine, folderName, shortDate } from './format';
import { Key, Waiting } from './shared';
import './FindScreen.css';

/** Rows drawn at first, and added by Show more: plenty to scan, few enough that typing stays instant. */
const PAGE = 50;
const FROM_FIND: FromList = { section: 'find' };

/**
 * Find a listing among all of them. The search runs on every keystroke over
 * the list in memory; the chips narrow it by category and listing type, and
 * count what each would show. Enter opens the first result; the arrow keys
 * move through them.
 */
export function FindScreen() {
  const { directory, refreshDirectory, today } = useApp();
  const list = useDirectoryList();
  const status = useDirectoryStatus();
  const [find, setFind] = useFindState();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [limit, setLimit] = useState(PAGE);
  const hintId = useId();
  const resultsId = useId();

  // The box shows every keystroke at once; the list follows at a lower priority.
  const query = useDeferredValue(find.query);

  // Each listing's facet keys, worked out once per list rather than per keystroke.
  const keys = useMemo(
    () =>
      new Map(
        (list ?? []).map((p) => [
          p.id,
          { category: normalizeForSearch(p.category), listingType: normalizeForSearch(p.listingType) },
        ]),
      ),
    [list],
  );
  const facets = useMemo(() => (list ? directory.facets() : { categories: [], listingTypes: [] }), [directory, list]);
  const byWords = useMemo(() => (list ? directory.search(query) : []), [directory, list, query]);
  const results = useMemo(
    () => (list ? directory.search(query, { category: find.category, listingType: find.listingType }) : []),
    [directory, list, query, find.category, find.listingType],
  );

  // What each chip would show: the words, and the other group's choice.
  const counts = useMemo(() => {
    const categories = new Map<string, number>();
    const listingTypes = new Map<string, number>();
    for (const p of byWords) {
      const k = keys.get(p.id);
      if (!k) continue;
      if (!find.listingType || k.listingType === find.listingType) {
        categories.set(k.category, (categories.get(k.category) ?? 0) + 1);
      }
      if (!find.category || k.category === find.category) {
        listingTypes.set(k.listingType, (listingTypes.get(k.listingType) ?? 0) + 1);
      }
    }
    return { categories, listingTypes };
  }, [byWords, keys, find.category, find.listingType]);

  useEffect(() => setLimit(PAGE), [query, find.category, find.listingType]);

  // Arrive ready to type: the last search is kept, selected, so typing replaces it.
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
    searchRef.current?.select();
  }, []);

  // "/" goes back to the search from anywhere on the screen.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const narrowed = find.query.trim() !== '' || find.category !== '' || find.listingType !== '';
  const announcement = useSettled(
    list === null ? '' : narrowed ? count(results.length, 'match', 'matches') : count(results.length, 'listing', 'listings'),
  );

  const links = () => Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>('a.result') ?? []);

  const open = (p: Property) => navigate(paths.property(p.id), { state: FROM_FIND });

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      links()[0]?.focus();
    } else if (event.key === 'Enter') {
      // The words as typed, not the list a frame behind them.
      const first = list ? directory.search(find.query, { category: find.category, listingType: find.listingType })[0] : undefined;
      if (first) {
        event.preventDefault();
        open(first);
      }
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (at === -1) return;
    const go = (i: number) => {
      event.preventDefault();
      all[i]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return go(Math.min(at + 1, all.length - 1));
      case 'ArrowUp':
        if (at === 0) {
          event.preventDefault();
          searchRef.current?.focus();
          return undefined;
        }
        return go(at - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(all.length - 1);
      case 'Escape':
        event.preventDefault();
        searchRef.current?.focus();
        return undefined;
      default:
        // Typing in the list types in the search.
        if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const next = find.query + event.key;
          setFind({ query: next });
          const input = searchRef.current;
          input?.focus();
          setTimeout(() => input?.setSelectionRange(next.length, next.length), 0);
        }
        return undefined;
    }
  };

  const clearAll = () => {
    setFind({ query: '', category: '', listingType: '' });
    searchRef.current?.focus();
  };

  const fetchedAt = directory.fetchedAt();
  const listAge =
    fetchedAt === null
      ? ''
      : manilaDate(fetchedAt) === today()
        ? manilaTime(fetchedAt)
        : `${shortDate(manilaDate(fetchedAt))}, ${manilaTime(fetchedAt)}`;

  return (
    <div className="page find">
      <header className="page-header">
        <div className="page-header__row find__title-row">
          <h1 className="page-header__title" tabIndex={-1}>
            Find a property
          </h1>
          <div className="find__freshness">
            {status.refreshing ? (
              <Waiting>{list ? 'Updating the list…' : 'Loading the list…'}</Waiting>
            ) : list && listAge ? (
              <>
                <span className="meta">List updated {listAge}</span>
                <Button variant="quiet" size="small" onClick={() => void refreshDirectory()}>
                  Refresh
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="find__controls">
        <SearchBox
          ref={searchRef}
          label="Search listings"
          placeholder="Name, building, street or city"
          value={find.query}
          onValueChange={(value) => setFind({ query: value })}
          onKeyDown={onSearchKeyDown}
          aria-describedby={hintId}
          aria-controls={resultsId}
        />
        <p id={hintId} className="find__hint">
          <Key>Enter</Key> opens the first result. <Key>↓</Key> moves through them. <Key>Esc</Key> clears.
        </p>

        {facets.categories.length > 0 ? (
          <div className="find__chips" role="group" aria-label="Category">
            {facets.categories.map((facet) => (
              <Chip
                key={facet.key}
                selected={find.category === facet.key}
                onSelectedChange={(on) => setFind({ category: on ? facet.key : '' })}
                leading={<CategoryDot kind={categoryKind(facet.label)} />}
                count={counts.categories.get(facet.key) ?? 0}
              >
                {categoryLabel(facet.label)}
              </Chip>
            ))}
          </div>
        ) : null}

        {facets.listingTypes.length > 1 ? (
          <div className="find__chips" role="group" aria-label="Listing type">
            {facets.listingTypes.map((facet) => (
              <Chip
                key={facet.key}
                selected={find.listingType === facet.key}
                onSelectedChange={(on) => setFind({ listingType: on ? facet.key : '' })}
                count={counts.listingTypes.get(facet.key) ?? 0}
              >
                {folderName(facet.label)}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      <section className="find__results" id={resultsId} aria-label="Results">
        {list === null ? (
          status.error && !status.refreshing ? (
            <Notice
              tone="danger"
              title="The property list didn't load"
              action={
                <Button size="small" onClick={() => void refreshDirectory()}>
                  Try again
                </Button>
              }
            >
              {status.error}
            </Notice>
          ) : (
            <Waiting className="find__loading">Loading the property list…</Waiting>
          )
        ) : (
          <>
            {status.error && !status.refreshing ? (
              <Notice
                tone="warn"
                title="This list may be out of date"
                action={
                  <Button size="small" onClick={() => void refreshDirectory()}>
                    Try again
                  </Button>
                }
              >
                {status.error} Showing the list from {listAge}.
              </Notice>
            ) : null}

            {results.length === 0 ? (
              <EmptyState
                icon={<Icon name="search" size={24} />}
                title={find.query.trim() ? `No listing matches “${find.query.trim()}”` : 'No listing matches these filters'}
                action={<Button onClick={clearAll}>Clear the search</Button>}
              >
                Try part of the name, the building or the city, or fewer filters.
              </EmptyState>
            ) : (
              <>
                <p className="find__count meta" aria-hidden="true">
                  {narrowed
                    ? `${count(results.length, 'match', 'matches')} of ${count(list.length, 'listing', 'listings')}`
                    : count(list.length, 'listing', 'listings')}
                </p>
                <ul className="results" ref={listRef} onKeyDown={onListKeyDown}>
                  {results.slice(0, limit).map((p) => (
                    <ResultRow key={p.id} property={p} />
                  ))}
                </ul>
                {results.length > limit ? (
                  <div className="find__more">
                    <span className="meta">
                      Showing {limit.toLocaleString('en-PH')} of {results.length.toLocaleString('en-PH')}
                    </span>
                    <Button onClick={() => setLimit((n) => n + PAGE)}>
                      Show {Math.min(PAGE, results.length - limit).toLocaleString('en-PH')} more
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** One listing: its name, where it sits, its photos, and whether the directory flagged it. */
function ResultRow({ property: p }: { readonly property: Property }) {
  return (
    <li className="results__item">
      <Link className="result" to={paths.property(p.id)} state={FROM_FIND}>
        <span className="result__main">
          <span className="result__name">{p.name}</span>
          <span className="result__folder">
            <CategoryDot kind={categoryKind(p.category)} />
            {folderLine(p)}
          </span>
        </span>
        <span className="result__side">
          {p.hasIssues ? (
            <Pill tone="warn" dot>
              Has issues
            </Pill>
          ) : null}
          <span className={p.photoCount === 0 ? 'result__photos result__photos--none' : 'result__photos'}>
            {p.photoCount === 0 ? 'No photos' : count(p.photoCount, 'photo', 'photos')}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The value once it has stopped changing for a moment: for a live region, so a screen reader hears the result, not every keystroke. */
function useSettled(value: string, ms = 600): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
