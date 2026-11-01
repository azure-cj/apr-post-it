import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { canManage, type Property } from '@/core/types';
import {
  Button,
  CategoryDot,
  Chip,
  Icon,
  MenuButton,
  Notice,
  PAGE_SIZE,
  Pagination,
  Pill,
  SearchBox,
  Spinner,
  categoryLabel,
  usePaged,
  type CategoryKind,
} from '../../components';
import {
  NO_FIND_FILTERS,
  manilaDate,
  manilaTime,
  paths,
  useApp,
  useAssignments,
  useDirectoryList,
  useDirectoryStatus,
  useFindState,
  usePosts,
  useUser,
  type FindFilters,
  type FindSort,
  type FromList,
} from '../../state';
import { placeWords } from '../manager/assignListing';
import {
  SORT_LABEL,
  dealWords,
  effectiveSort,
  filterCount,
  listingFacts,
  passes,
  sortFacts,
  sortNote,
  type ListingFacts,
} from './findListing';
import { count, shortDate } from './format';
import './FindScreen.css';

const FROM_FIND: FromList = { section: 'find' };

/** The categories in the order Assign shows them, most listings first; anything unsorted last, as "Other". */
const KIND_ORDER: readonly CategoryKind[] = ['warehouse', 'commercial', 'office', 'condo', 'unsorted'];

const FILTERS: readonly { readonly key: keyof FindFilters; readonly label: string }[] = [
  { key: 'sale', label: 'For sale' },
  { key: 'lease', label: 'For lease' },
  { key: 'ready', label: 'Ready to post' },
  { key: 'fresh', label: 'Never posted' },
  { key: 'photos', label: 'Has photos' },
];

/**
 * Find a listing among all of them, for interns and admins alike. The search
 * runs on every keystroke over the list in memory; the category chips and
 * the Filter menu narrow it, the Sort menu orders it, and it shows ten a
 * page. Each row says the one thing that matters before posting (Ready, In
 * cooldown until …, Sold, No separator, No document) and who has it. What
 * was shown is kept while a listing is open, and coming back lands on it.
 */
export function FindScreen() {
  const { directory, refreshDirectory, settings, today: todayOf } = useApp();
  const user = useUser();
  const manager = canManage(user);
  const list = useDirectoryList();
  const status = useDirectoryStatus();
  const posts = usePosts({ maxAgeMs: 60_000 });
  const assignments = useAssignments({ maxAgeMs: 60_000 });
  const [find, setFind] = useFindState();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const resultsId = useId();
  const today = todayOf();

  // The box shows every keystroke at once; the list follows at a lower priority.
  const query = useDeferredValue(find.query);

  const facts = useMemo(
    () =>
      listingFacts(list ?? [], {
        posts: posts.data,
        assignments: assignments.data,
        rules: settings,
        today,
        viewer: { name: user.name, manager },
      }),
    [list, posts.data, assignments.data, settings, today, user.name, manager],
  );
  const hasCreated = useMemo(() => (list ?? []).some((p) => Boolean(p.created)), [list]);

  // The chips keep their places while you type: ordered by the whole list, counted by what is shown.
  const kinds = useMemo(() => {
    const all = new Map<CategoryKind, number>();
    const labels = new Map<CategoryKind, string>();
    for (const f of facts.values()) {
      all.set(f.kind, (all.get(f.kind) ?? 0) + 1);
      if (!labels.has(f.kind)) labels.set(f.kind, f.kind === 'unsorted' ? 'Other' : categoryLabel(f.property.category));
    }
    const order = KIND_ORDER.filter((k) => all.has(k)).sort((a, b) => {
      if (a === 'unsorted') return 1;
      if (b === 'unsorted') return -1;
      return (all.get(b) ?? 0) - (all.get(a) ?? 0);
    });
    return order.map((kind) => ({ kind, label: labels.get(kind) ?? kind }));
  }, [facts]);

  /** The whole pipeline for some words: matched, filtered, counted by category, then in one category and sorted. */
  const resultsFor = (words: string) => {
    const matched = list ? directory.search(words) : [];
    const filtered: ListingFacts[] = [];
    const counts = new Map<string, number>();
    for (const p of matched) {
      const f = facts.get(p.id);
      if (!f || !passes(f, find.filters)) continue;
      filtered.push(f);
      counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    }
    const inCategory = find.category ? filtered.filter((f) => f.kind === find.category) : filtered;
    const sort = effectiveSort(find.sort, words, hasCreated);
    return { all: filtered.length, counts, rows: sortFacts(inCategory, sort, words), sort };
  };
  // resultsFor reads exactly these.
  const results = useMemo(() => resultsFor(query), [list, directory, facts, query, find.filters, find.category, find.sort, hasCreated]);

  const resetKey = [query.trim(), find.category, filterKey(find.filters), find.sort].join('|');
  const paged = usePaged(results.rows, PAGE_SIZE, resetKey, {
    page: find.page,
    onPageChange: (page) => setFind({ page }),
  });
  const { topRef } = paged;
  const attachList = (el: HTMLUListElement | null) => {
    listRef.current = el;
    topRef(el);
  };

  // Arrive ready to type, the last search selected so typing replaces it; or,
  // back from a listing opened here, on that listing's row.
  useEffect(() => {
    const row = find.opened ? listRef.current?.querySelector<HTMLAnchorElement>(`a[data-id="${CSS.escape(find.opened)}"]`) : null;
    if (row) {
      row.focus({ preventScroll: true });
      // After the shell's own scroll to the top on arrival.
      const timer = setTimeout(() => row.scrollIntoView?.({ block: 'center' }), 0);
      return () => clearTimeout(timer);
    }
    searchRef.current?.focus({ preventScroll: true });
    searchRef.current?.select();
    return undefined;
    // Once, on arrival.
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

  const narrowed = find.query.trim() !== '' || find.category !== '' || filterCount(find.filters) > 0;
  const announcement = useSettled(
    list === null ? '' : narrowed ? count(results.rows.length, 'match', 'matches') : count(results.rows.length, 'listing', 'listings'),
  );

  const links = () => Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>('a.find-row__link') ?? []);
  const open = (p: Property) => {
    setFind({ opened: p.id });
    navigate(paths.property(p.id), { state: FROM_FIND });
  };
  const change = (changes: Partial<typeof find>) => setFind({ ...changes, opened: '' });

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      links()[0]?.focus();
    } else if (event.key === 'Enter') {
      // The words as typed, not the list a frame behind them.
      const first = resultsFor(find.query).rows[0];
      if (first) {
        event.preventDefault();
        open(first.property);
      }
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const all = links();
    const onList = document.activeElement === listRef.current;
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (at === -1 && !onList) return;
    const go = (i: number) => {
      event.preventDefault();
      all[i]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return go(onList ? 0 : Math.min(at + 1, all.length - 1));
      case 'ArrowUp':
        if (at <= 0) {
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
          change({ query: next });
          const input = searchRef.current;
          input?.focus();
          setTimeout(() => input?.setSelectionRange(next.length, next.length), 0);
        }
        return undefined;
    }
  };

  const clearAll = () => {
    change({ query: '', category: '', filters: NO_FIND_FILTERS });
    searchRef.current?.focus();
  };

  const fetchedAt = directory.fetchedAt();
  const listAge =
    fetchedAt === null ? '' : manilaDate(fetchedAt) === today ? manilaTime(fetchedAt) : `${shortDate(manilaDate(fetchedAt))}, ${manilaTime(fetchedAt)}`;

  const sort = results.sort;
  const sortChoices: readonly FindSort[] = [...(query.trim() ? (['best'] as const) : []), 'name', ...(hasCreated ? (['newest'] as const) : []), 'posted'];
  const filtersOn = filterCount(find.filters);
  const showCategory = find.category === '';

  return (
    <div className="page find">
      <header className="page-header find__header">
        <div className="page-header__row find__title-row">
          <h1 className="page-header__title" tabIndex={-1}>
            Find
          </h1>
          <Freshness
            refreshing={status.refreshing}
            loaded={list !== null}
            error={list !== null && !status.refreshing ? status.error : null}
            age={listAge}
            onRefresh={() => void refreshDirectory()}
          />
        </div>
        <div className="find__find">
          <div className="find__search">
            <SearchBox
              ref={searchRef}
              label="Search listings"
              placeholder="Search name, city or building"
              value={find.query}
              onValueChange={(value) => change({ query: value })}
              onKeyDown={onSearchKeyDown}
              aria-controls={resultsId}
              aria-keyshortcuts="/"
            />
            <kbd className="find__slash" aria-hidden="true">
              /
            </kbd>
          </div>
          <div className="find__tools">
            <MenuButton label="Filter" count={filtersOn} className="find__filter">
              {() => (
                <fieldset className="menu__group">
                  <legend className="visually-hidden">Filter</legend>
                  {FILTERS.map(({ key, label }, i) => (
                    <div key={key} className="find__filter-item">
                      {i === 2 ? <hr className="menu__sep" /> : null}
                      <label className="menu__check">
                        <input
                          type="checkbox"
                          checked={find.filters[key]}
                          onChange={(event) => change({ filters: { ...find.filters, [key]: event.target.checked } })}
                        />
                        <span>{label}</span>
                      </label>
                    </div>
                  ))}
                </fieldset>
              )}
            </MenuButton>
            <MenuButton label="Sort" text={SORT_LABEL[sort]} leading={<SortIcon />} className="find__sort">
              {(close) => (
                <fieldset className="menu__group">
                  <legend className="visually-hidden">Sort</legend>
                  {sortChoices.map((choice) => (
                    <label key={choice} className="menu__check">
                      <input
                        type="radio"
                        name="find-sort"
                        checked={sort === choice}
                        onChange={() => change({ sort: choice })}
                        // A pointer's pick closes the menu; the arrow keys only move the choice, so it stays open.
                        onClick={(event) => {
                          if (event.detail > 0) close();
                        }}
                      />
                      <span>{SORT_LABEL[choice]}</span>
                    </label>
                  ))}
                </fieldset>
              )}
            </MenuButton>
          </div>
        </div>
      </header>

      <div className="find__bar">
        <div className="find__chips" role="group" aria-label="Category">
          <Chip selected={find.category === ''} count={list ? results.all : undefined} onSelectedChange={() => change({ category: '' })}>
            All
          </Chip>
          {kinds.map(({ kind, label }) => (
            <Chip
              key={kind}
              selected={find.category === kind}
              leading={<CategoryDot kind={kind} />}
              count={results.counts.get(kind) ?? 0}
              onSelectedChange={(on) => change({ category: on ? kind : '' })}
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      <section className="find__results" id={resultsId} aria-label="Results">
        {list === null ? (
          status.error && !status.refreshing ? (
            <Notice
              tone="danger"
              live
              title="Listings didn't load"
              action={
                <Button size="small" onClick={() => void refreshDirectory()}>
                  Try again
                </Button>
              }
            >
              {status.error}
            </Notice>
          ) : (
            <Skeleton />
          )
        ) : results.rows.length === 0 ? (
          <div className="find__none">
            <p>
              {list.length === 0
                ? 'No listings yet.'
                : find.query.trim()
                  ? `Nothing matches “${find.query.trim()}”.`
                  : 'Nothing matches these filters.'}
            </p>
            {narrowed ? (
              <Button size="small" onClick={clearAll}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <ul
              className="find-list"
              ref={attachList}
              onKeyDown={onListKeyDown}
              aria-label={paged.pageCount > 1 ? `Listings, page ${paged.page} of ${paged.pageCount}` : 'Listings'}
            >
              {paged.items.map((f) => (
                <ResultRow
                  key={f.property.id}
                  facts={f}
                  showCategory={showCategory}
                  note={sortNote(f, sort, today)}
                  onOpen={() => setFind({ opened: f.property.id })}
                />
              ))}
            </ul>
            <Pagination {...paged.pagination} className="find__pages" />
          </>
        )}
      </section>
    </div>
  );
}

function filterKey(filters: FindFilters): string {
  return (Object.keys(NO_FIND_FILTERS) as (keyof FindFilters)[]).map((k) => (filters[k] ? '1' : '0')).join('');
}

/** One listing: name; category, place, deal; its status and who has it; its photos. The whole row opens it. */
function ResultRow({
  facts,
  showCategory,
  note,
  onOpen,
}: {
  readonly facts: ListingFacts;
  readonly showCategory: boolean;
  readonly note: string;
  readonly onOpen: () => void;
}) {
  const { property: p, status, known, holder } = facts;
  const place = placeWords(p);
  const deal = dealWords(facts.deal);
  // "Ready" waits for the posts: until then the cooldown is unknown.
  const pill = known || status.kind !== 'ready';
  return (
    <li className="find-row">
      <Link className="find-row__link" to={paths.property(p.id)} state={FROM_FIND} data-id={p.id} onClick={onOpen}>
        <span className="find-row__main">
          <span className="find-row__name">{p.name}</span>
          <span className="find-row__meta">
            <span className={showCategory ? 'find-row__cat' : 'find-row__cat find-row__cat--dot'}>
              <CategoryDot kind={facts.kind} />
              {showCategory ? categoryLabel(p.category) : <span className="visually-hidden">{categoryLabel(p.category)}</span>}
            </span>
            {place ? <span className="find-row__part">{place}</span> : null}
            {deal ? <span className="find-row__part">{deal}</span> : null}
            {note ? <span className="find-row__part find-row__note">{note}</span> : null}
          </span>
        </span>
        <span className="find-row__state">
          {pill ? (
            <Pill tone={status.tone} dot>
              {status.text}
            </Pill>
          ) : null}
          {holder ? <span className="find-row__holder">{holder}</span> : null}
        </span>
        <span className={p.photoCount === 0 ? 'find-row__photos find-row__photos--none' : 'find-row__photos'}>
          {p.photoCount === 0 ? 'No photos' : count(p.photoCount, 'photo', 'photos')}
        </span>
      </Link>
    </li>
  );
}

/** "Updated 10:42 · Refresh", small, in the header: the list's age is a footnote, not news. */
function Freshness({
  refreshing,
  loaded,
  error,
  age,
  onRefresh,
}: {
  readonly refreshing: boolean;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly age: string;
  readonly onRefresh: () => void;
}) {
  if (refreshing) {
    return (
      <p className="find__fresh" role="status">
        <Spinner size="small" />
        <span>{loaded ? 'Updating…' : 'Loading…'}</span>
      </p>
    );
  }
  if (!loaded) return null;
  if (error) {
    return (
      <p className="find__fresh find__fresh--failed">
        <Icon name="warn" size={16} className="find__fresh-icon" />
        <span>Couldn&rsquo;t update{age ? `, showing ${age}` : ''}</span>
        <span className="visually-hidden" role="status">
          {error}
        </span>
        <span aria-hidden="true">·</span>
        <Button variant="link" onClick={onRefresh}>
          Try again
        </Button>
      </p>
    );
  }
  if (!age) return null;
  return (
    <p className="find__fresh">
      <span>Updated {age}</span>
      <span aria-hidden="true">·</span>
      <Button variant="link" onClick={onRefresh} aria-label="Refresh the listings">
        Refresh
      </Button>
    </p>
  );
}

/** Ten rows' worth of placeholder while the list loads, so nothing jumps when it arrives. */
function Skeleton() {
  return (
    <>
      <p className="visually-hidden" role="status">
        Loading the listings…
      </p>
      <ul className="find-list find-list--loading" aria-hidden="true">
        {Array.from({ length: PAGE_SIZE }, (_, i) => (
          <li key={i} className="find-row find-row--skeleton">
            <span className="find-row__main">
              <span className="skeleton skeleton--name" style={{ inlineSize: `${46 + ((i * 17) % 30)}%` }} />
              <span className="skeleton skeleton--meta" style={{ inlineSize: `${30 + ((i * 11) % 22)}%` }} />
            </span>
            <span className="find-row__state">
              <span className="skeleton skeleton--pill" />
            </span>
            <span className="find-row__photos">
              <span className="skeleton skeleton--photos" />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Two arrows, up and down: "sort". Decorative; the button's words name it. */
function SortIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M8 5v14M4.5 8.5 8 5l3.5 3.5M16 19V5M12.5 15.5 16 19l3.5-3.5" />
    </svg>
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

