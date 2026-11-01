import { useId } from 'react';
import { Button, CategoryDot, categoryKind, Chip, Icon, Pill, SearchBox } from '../../components';
import { clockTime, type PostSortKey } from '@/core/records';
import { plural, shortDate } from '@/core/summary';
import type { PostLogEntry, PostStatus } from '@/core/types';
import { ManagerIcon } from './ManagerIcon';
import './RecordsPosts.css';

/** Rows on a page of the list. */
export const PAGE_ROWS = 50;

export interface PostSort {
  readonly key: PostSortKey;
  readonly direction: 'asc' | 'desc';
}

/** A filter in force, said as a removable chip. */
export interface ActiveFilter {
  readonly key: string;
  /** "Tue 3 Nov", "Jan Dela Cruz". */
  readonly label: string;
  /** What it filters, for screen readers: "Day", "Intern". */
  readonly kind: string;
  readonly onRemove: () => void;
}

export interface RecordsPostsProps {
  /** The list, filtered and sorted: every page of it. */
  readonly posts: readonly PostLogEntry[];
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly status: PostStatus | null;
  readonly onStatusChange: (status: PostStatus | null) => void;
  /** How many of each status the other filters leave. */
  readonly statusCounts: Readonly<Record<PostStatus, number>>;
  readonly filters: readonly ActiveFilter[];
  readonly onClearFilters: () => void;
  readonly sort: PostSort;
  readonly onSortChange: (sort: PostSort) => void;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
  /** Whether a row's listing has its history open. */
  readonly isOpen: (post: PostLogEntry) => boolean;
  readonly onOpenProperty: (post: PostLogEntry, button: HTMLButtonElement) => void;
  readonly onOpenLink?: ((url: string) => void) | undefined;
  /** "No posts in 2–6 Nov": when the period itself has none. */
  readonly emptyPeriod: string | null;
}

/** The interns' sheet's columns, in its order, then Posted by. Link isn't sortable. */
const COLUMNS: readonly { readonly label: string; readonly key: PostSortKey | null; readonly className?: string }[] = [
  { label: 'Date', key: 'date', className: 'posts-table__date' },
  { label: 'Property type', key: 'type', className: 'posts-table__type' },
  { label: 'Property title', key: 'title', className: 'posts-table__title' },
  { label: 'FB account name', key: 'fbAccount', className: 'posts-table__account' },
  { label: 'Link', key: null, className: 'posts-table__link' },
  { label: 'Time posted', key: 'time', className: 'posts-table__time' },
  { label: 'Share posting', key: 'status', className: 'posts-table__status' },
  { label: 'Posted by', key: 'postedBy', className: 'posts-table__by' },
];

const NEWEST_FIRST: ReadonlySet<PostSortKey> = new Set(['date', 'time']);

/**
 * The period's posts: a search, Posted and Pending, the filters in force as
 * chips, then the sheet's columns, sortable, a page at a time. A title opens
 * the listing's whole history.
 */
export function RecordsPosts(props: RecordsPostsProps) {
  const { posts, sort, page, filters } = props;
  const pages = Math.max(1, Math.ceil(posts.length / PAGE_ROWS));
  const at = Math.min(page, pages - 1);
  const shown = posts.slice(at * PAGE_ROWS, (at + 1) * PAGE_ROWS);
  const titleId = useId();
  const filtered = filters.length > 0 || props.status !== null || props.query.trim() !== '';

  const sortBy = (key: PostSortKey) => {
    if (sort.key === key) props.onSortChange({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    else props.onSortChange({ key, direction: NEWEST_FIRST.has(key) ? 'desc' : 'asc' });
  };

  return (
    <section className="card card--tight records-posts" aria-labelledby={titleId}>
      <div className="records-posts__head">
        <h2 id={titleId} className="records-posts__title">
          Posts
        </h2>
        <span className="records-posts__count tabular" role="status">
          {plural(posts.length, 'post', 'posts')}
        </span>
      </div>

      <div className="records-posts__tools">
        <SearchBox
          className="records-posts__search"
          label="Search posts"
          placeholder="Listing, intern, FB account or link"
          value={props.query}
          onValueChange={props.onQueryChange}
        />
        <div className="records-posts__status" role="group" aria-label="Share posting">
          {(['Posted', 'Pending'] as const).map((s) => (
            <Chip
              key={s}
              selected={props.status === s}
              count={props.statusCounts[s]}
              onSelectedChange={(on) => props.onStatusChange(on ? s : null)}
            >
              {s}
            </Chip>
          ))}
        </div>
        {filters.length > 0 ? (
          <ul className="records-posts__filters" aria-label="Filters">
            {filters.map((f) => (
              <li key={f.key}>
                <button type="button" className="filter-chip" onClick={f.onRemove} aria-label={`Remove filter ${f.kind}: ${f.label}`}>
                  <span className="filter-chip__kind" aria-hidden="true">
                    {f.kind}
                  </span>
                  <span className="filter-chip__label">{f.label}</span>
                  <Icon name="close" size={16} className="filter-chip__x" />
                </button>
              </li>
            ))}
            {filters.length > 1 ? (
              <li>
                <Button variant="link" onClick={props.onClearFilters}>
                  Clear all
                </Button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {posts.length === 0 ? (
        <div className="records-posts__empty">
          <p>{filtered ? 'No posts match.' : (props.emptyPeriod ?? 'No posts.')}</p>
          {filtered ? (
            <Button size="small" onClick={props.onClearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="posts-table__wrap">
            <table className="posts-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const on = c.key !== null && sort.key === c.key;
                    return (
                      <th
                        key={c.label}
                        scope="col"
                        className={c.className}
                        aria-sort={on ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        {c.key ? (
                          <button type="button" className={`posts-table__sort${on ? ' posts-table__sort--on' : ''}`} onClick={() => sortBy(c.key!)}>
                            {c.label}
                            <span className="posts-table__arrow" aria-hidden="true">
                              {on ? <ManagerIcon name={sort.direction === 'asc' ? 'chevronUp' : 'chevronDown'} size={16} /> : null}
                            </span>
                          </button>
                        ) : (
                          <span className="posts-table__plain">{c.label}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((post, i) => {
                  const open = props.isOpen(post);
                  return (
                    <tr key={`${at}-${i}-${post.date}-${post.time}-${post.title}`} className={open ? 'posts-table__row--open' : undefined}>
                      <td className="posts-table__date tabular">{shortDate(post.date)}</td>
                      <td className="posts-table__type">
                        <span className="posts-table__type-in">
                          <CategoryDot kind={categoryKind(post.type)} />
                          {post.type || 'Unsorted'}
                        </span>
                      </td>
                      <th scope="row" className="posts-table__title">
                        <button
                          type="button"
                          className="posts-table__listing"
                          aria-expanded={open}
                          onClick={(e) => props.onOpenProperty(post, e.currentTarget)}
                        >
                          {post.title}
                        </button>
                      </th>
                      <td className="posts-table__account">{post.fbAccount}</td>
                      <td className="posts-table__link">
                        {post.postLink && props.onOpenLink ? (
                          <Button variant="link" onClick={() => props.onOpenLink!(post.postLink)} aria-label={`Open the post of ${post.title}`}>
                            Open
                          </Button>
                        ) : (
                          <span className="posts-table__none">No link</span>
                        )}
                      </td>
                      <td className="posts-table__time tabular">{clockTime(post.time)}</td>
                      <td className="posts-table__status">
                        <Pill tone={post.status === 'Posted' ? 'ok' : 'warn'}>{post.status}</Pill>
                      </td>
                      <td className="posts-table__by">{post.postedBy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <nav className="records-posts__pages" aria-label="Pages">
              <span className="tabular">
                {(at * PAGE_ROWS + 1).toLocaleString('en-PH')}–{Math.min(posts.length, (at + 1) * PAGE_ROWS).toLocaleString('en-PH')} of{' '}
                {posts.length.toLocaleString('en-PH')}
              </span>
              <Button
                size="small"
                className="day-picker__step"
                disabled={at === 0}
                icon={<ManagerIcon name="chevronLeft" size={20} />}
                onClick={() => props.onPageChange(at - 1)}
              >
                <span className="visually-hidden">Previous page</span>
              </Button>
              <Button
                size="small"
                className="day-picker__step"
                disabled={at >= pages - 1}
                icon={<ManagerIcon name="chevronRight" size={20} />}
                onClick={() => props.onPageChange(at + 1)}
              >
                <span className="visually-hidden">Next page</span>
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
