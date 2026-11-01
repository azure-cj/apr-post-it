import { forwardRef, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Button, Icon } from '../../components';
import { isDate, lastPostOf, samePerson, shortDate, weekProgress, type TeamWeekRow } from '@/core/summary';
import { addWeeks, assignmentWeek, isWeekOver, weekLabel, weekOf } from '@/core/week';
import { initials, queueStatus, type Assignment, type PostLogEntry } from '@/core/types';
import { PacePill, WeekBar } from './InternsParts';

/** How many weeks before the one shown the history covers. */
export const HISTORY_WEEKS = 4;

export interface InternPanelProps {
  readonly row: TeamWeekRow;
  readonly week: string;
  readonly today: string;
  readonly posts: readonly PostLogEntry[];
  readonly assignments: readonly Assignment[];
  /** Their Facebook profile, '' when the Team tab has none. */
  readonly profile: string;
  readonly onClose: () => void;
  /** Open Assign on their queue for this week. */
  readonly onOpenQueue?: (() => void) | undefined;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

type Group = 'Not shared' | 'Pending' | 'Posted' | 'Missed';
const GROUPS: readonly Group[] = ['Not shared', 'Pending', 'Posted', 'Missed'];

/** How many of a group show before "Show all". */
export const GROUP_LIMIT = 5;

interface Item {
  readonly name: string;
  readonly group: Group;
  /** Their post of it this week, for its link. */
  readonly post: PostLogEntry | undefined;
}

/**
 * One intern's week beside the list: their queue grouped by where each item
 * is, the last four weeks as bars, and the way to their queue in Assign.
 */
export const InternPanel = forwardRef<HTMLHeadingElement, InternPanelProps>(function InternPanel(
  { row, week, today, posts, assignments, profile, onClose, onOpenQueue, onOpenLink },
  headingRef,
) {
  const titleId = useId();
  const items = useMemo(() => weekItems(row.name, week, today, assignments, posts), [row.name, week, today, assignments, posts]);
  const history = useMemo(
    () =>
      Array.from({ length: HISTORY_WEEKS }, (_, i) => {
        const w = addWeeks(week, i - HISTORY_WEEKS);
        return { week: w, progress: weekProgress(row.name, w, assignments, posts, today) };
      }),
    [row.name, week, assignments, posts, today],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  return (
    <aside className="intern-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="intern-panel__head">
        <span className="avatar" aria-hidden="true">
          {initials(row.name)}
        </span>
        <h2 id={titleId} ref={headingRef} className="intern-panel__name" tabIndex={-1}>
          {row.name}
        </h2>
        <Button variant="quiet" size="small" className="intern-panel__close" icon={<Icon name="close" size={18} />} onClick={onClose}>
          <span className="visually-hidden">Close</span>
        </Button>
      </div>

      <div className="intern-panel__week">
        <WeekBar progress={row} />
        <PacePill progress={row} />
      </div>

      {onOpenQueue || (profile && onOpenLink) ? (
        <div className="intern-panel__actions">
          {onOpenQueue ? (
            <Button size="small" onClick={onOpenQueue}>
              Open in Assign
            </Button>
          ) : null}
          {profile && onOpenLink ? (
            <Button size="small" variant="quiet" onClick={() => onOpenLink(profile)}>
              FB profile
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="intern-panel__history" aria-label="Last 4 weeks">
        <h3 className="intern-panel__label">Last 4 weeks</h3>
        <ol className="history">
          {history.map(({ week: w, progress }) => {
            const share = progress.target === 0 ? null : Math.round(((progress.posted + progress.pending) / progress.target) * 100);
            return (
              <li key={w} className="history__week">
                <span className="history__value tabular">{share === null ? '–' : `${Math.min(share, 100)}%`}</span>
                <span className="history__track" aria-hidden="true">
                  {share === null ? null : (
                    <span
                      className={`history__fill${share >= 100 ? ' history__fill--done' : ''}`}
                      style={{ height: `${Math.min(share, 100)}%` }}
                    />
                  )}
                </span>
                <span className="history__label tabular">
                  {shortDate(w).slice(4)}
                  <span className="visually-hidden">
                    {` (${weekLabel(w)})`}
                    {share === null ? ', no queue' : `, ${progress.posted + progress.pending} of ${progress.target}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {items.length === 0 ? (
        <p className="intern-panel__quiet">Nothing assigned for {weekLabel(week)}.</p>
      ) : (
        GROUPS.map((group) => {
          const list = items.filter((i) => i.group === group);
          if (list.length === 0) return null;
          return <ItemGroup key={group} group={group} items={list} onOpenLink={onOpenLink} />;
        })
      )}
    </aside>
  );
});

const GROUP_CLASS: Record<Group, string> = {
  'Not shared': 'not-shared',
  Pending: 'pending',
  Posted: 'posted',
  Missed: 'missed',
};

function ItemGroup({
  group,
  items,
  onOpenLink,
}: {
  readonly group: Group;
  readonly items: readonly Item[];
  readonly onOpenLink?: ((url: string) => void) | undefined;
}) {
  const titleId = useId();
  const listId = useId();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, GROUP_LIMIT);
  return (
    <section className={`panel-group panel-group--${GROUP_CLASS[group]}`} aria-labelledby={titleId}>
      <h3 id={titleId} className="panel-group__title">
        <span className="panel-group__dot" aria-hidden="true" />
        {group}{' '}
        <span className="panel-group__count tabular">{items.length}</span>
      </h3>
      <ul className="panel-group__list" id={listId}>
        {shown.map((item, index) => {
          const link = item.post?.postLink.trim() ?? '';
          return (
            <li key={`${index}-${item.name}`} className="panel-item">
              <span className="panel-item__name">{item.name}</span>
              {link && onOpenLink && (group === 'Posted' || group === 'Pending') ? (
                <Button variant="link" className="panel-item__open" onClick={() => onOpenLink(link)} aria-label={`Open the post of ${item.name}`}>
                  Open
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {items.length > GROUP_LIMIT ? (
        <Button variant="link" className="panel-group__more" aria-controls={listId} aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The intern's queue for `week`, each item with where it is: its own status,
 * or their post of it dated that week when the queue's row lags (as
 * weekProgress counts it). Not shared turns Missed once the week is over.
 */
export function weekItems(
  intern: string,
  week: string,
  today: string,
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
): Item[] {
  const monday = weekOf(week);
  const over = isWeekOver(monday, today);
  const theirs = posts.filter(
    (p) => (p.status === 'Posted' || p.status === 'Pending') && samePerson(p.postedBy, intern) && isDate(p.date) && weekOf(p.date) === monday,
  );
  return assignments
    .filter((a) => samePerson(a.assignedTo, intern) && assignmentWeek(a) === monday)
    .map((a): Item => {
      const post = lastPostOf(theirs, { id: a.propertyId.trim(), name: a.propertyName });
      let status = queueStatus(a.status);
      if (status === 'Not Shared' && post) status = post.status;
      const group: Group = status === 'Posted' ? 'Posted' : status === 'Pending' ? 'Pending' : over ? 'Missed' : 'Not shared';
      return { name: a.propertyName, group, post };
    });
}
