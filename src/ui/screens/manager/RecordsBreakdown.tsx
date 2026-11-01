import { useId, useRef, type KeyboardEvent } from 'react';
import { CategoryDot, categoryKind } from '../../components';
import type { CountRow, InternRow } from '@/core/records';
import { plural } from '@/core/summary';
import { RouteLink } from './TrackerLink';
import './RecordsBreakdown.css';

export type BreakdownTab = 'intern' | 'category';

const TABS: readonly { readonly key: BreakdownTab; readonly label: string }[] = [
  { key: 'intern', label: 'By intern' },
  { key: 'category', label: 'By category' },
];

export interface RecordsBreakdownProps {
  readonly tab: BreakdownTab;
  readonly onTabChange: (tab: BreakdownTab) => void;
  readonly interns: readonly InternRow[];
  readonly categories: readonly CountRow[];
  /** Where an intern's row links: Interns on the period's week. Without it, names are plain. */
  readonly internHref?: ((name: string) => string) | undefined;
  /** Follows that link through the app's router. */
  readonly onIntern?: ((name: string) => void) | undefined;
}

/**
 * The period two ways, as tabs: interns ranked (posts, pending, missed, how
 * much of their weekly queues got done, and a sparkline), and posts per
 * category as bars. An intern's name opens their week on Interns.
 */
export function RecordsBreakdown(props: RecordsBreakdownProps) {
  const { tab, onTabChange } = props;
  const base = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (event: KeyboardEvent, i: number) => {
    let to: number | undefined;
    if (event.key === 'ArrowRight') to = (i + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') to = (i - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = TABS.length - 1;
    else return;
    event.preventDefault();
    onTabChange(TABS[to]!.key);
    tabRefs.current[to]?.focus();
  };

  return (
    <section className="card card--tight breakdown" aria-label="Breakdown">
      <div className="breakdown__tabs" role="tablist" aria-label="Breakdown">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`${base}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            className={`breakdown__tab${tab === t.key ? ' breakdown__tab--on' : ''}`}
            onClick={() => onTabChange(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="breakdown__panel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`}>
        {tab === 'intern' ? (
          <InternTable rows={props.interns} href={props.internHref} onOpen={props.onIntern} />
        ) : (
          <CountBars rows={props.categories} label="Category" />
        )}
      </div>
    </section>
  );
}

function percent(share: number | null): string {
  return share === null ? '–' : `${Math.round(share * 100)}%`;
}

function InternTable({
  rows,
  href,
  onOpen,
}: {
  readonly rows: readonly InternRow[];
  readonly href?: ((name: string) => string) | undefined;
  readonly onOpen?: ((name: string) => void) | undefined;
}) {
  if (rows.length === 0) return <p className="breakdown__quiet">No posts</p>;
  const peak = Math.max(1, ...rows.flatMap((r) => r.trend));
  return (
    <table className="breakdown-table">
      <thead>
        <tr>
          <th scope="col">Intern</th>
          <th scope="col" className="breakdown-table__num">
            Posts
          </th>
          <th scope="col" className="breakdown-table__num breakdown-table__pending">
            Pending
          </th>
          <th scope="col" className="breakdown-table__num breakdown-table__missed-col">
            Missed
          </th>
          <th scope="col" className="breakdown-table__num" title="Share of their weekly queues posted">
            <span aria-hidden="true">Done</span>
            <span className="visually-hidden">Weekly queues done</span>
          </th>
          <th scope="col" className="breakdown-table__trend">
            <span className="visually-hidden">Trend</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          return (
            <tr key={r.name} className={`breakdown-row${href ? ' breakdown-row--link' : ''}`}>
              <th scope="row">
                {href ? (
                  <RouteLink href={href(r.name)} onNavigate={onOpen ? () => onOpen(r.name) : undefined} className="breakdown-row__pick">
                    <span className="breakdown-row__name">{r.name}</span>
                  </RouteLink>
                ) : (
                  <span className="breakdown-row__name">{r.name}</span>
                )}
              </th>
              <td className={`breakdown-table__num tabular${r.posts === 0 ? ' breakdown-table__zero' : ''}`}>{r.posts}</td>
              <td className={`breakdown-table__num tabular${r.pending === 0 ? ' breakdown-table__zero' : ''}`}>{r.pending}</td>
              <td className={`breakdown-table__num tabular${r.missed === 0 ? ' breakdown-table__zero' : ' breakdown-table__missed'}`}>
                {r.missed}
              </td>
              <td className="breakdown-table__num tabular" title={r.target ? `${r.done} of ${r.target}` : 'No queue'}>
                {percent(r.completion)}
              </td>
              <td className="breakdown-table__trend">
                <Sparkline values={r.trend} peak={peak} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A tiny line of posts per bar of the chart, on the table's shared scale. */
function Sparkline({ values, peak }: { readonly values: readonly number[]; readonly peak: number }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 22;
  const pad = 3;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (values.length - 1);
  const y = (v: number) => h - pad - (v / peak) * (h - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" />
      <circle cx={x(last)} cy={y(values[last]!)} r="2.5" />
    </svg>
  );
}

function CountBars({ rows, label }: { readonly rows: readonly CountRow[]; readonly label: string }) {
  if (rows.length === 0) return <p className="breakdown__quiet">No posts</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="count-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="count-bar">
          <span className="count-bar__name">
            <CategoryDot kind={categoryKind(r.label)} />
            <span className="count-bar__label">{r.label}</span>
          </span>
          <span className="count-bar__track" aria-hidden="true">
            <span className="count-bar__fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="count-bar__value tabular">
            {r.count.toLocaleString('en-PH')}
            <span className="visually-hidden">
              {` ${r.count === 1 ? 'post' : 'posts'}, ${plural(r.pending, 'pending', 'pending')}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
