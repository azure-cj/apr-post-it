import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { spanLabel, type ChartBucket, type Span } from '@/core/records';
import { plural, shortDate } from '@/core/summary';
import { MONTHS, WEEKDAYS } from '@/core/dates';
import './RecordsChart.css';

export interface RecordsChartProps {
  readonly buckets: readonly ChartBucket[];
  /** The bar picked as a filter, by its first day. */
  readonly selected: string | null;
  /** A bar was clicked: filter the list to it, or (the same bar again) stop. */
  readonly onSelect: (bucket: Span | null) => void;
  /** Read out before the bars: the period's numbers in a sentence. */
  readonly summary: string;
}

/**
 * The y-axis: up to five gridlines on round numbers, 0 included, the top
 * one at or above the tallest bar.
 */
export function axisTicks(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const steps = [1, 2, 5];
  let step = 1;
  for (let scale = 1; ; scale *= 10) {
    const found = steps.map((s) => s * scale).find((s) => Math.ceil(max / s) <= 4);
    if (found) {
      step = found;
      break;
    }
  }
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

function parts(date: string): { readonly weekday: string; readonly day: number; readonly month: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return { weekday: WEEKDAYS[d.getUTCDay()] ?? '', day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] ?? '' };
}

/** The bar's name in full: "Tue 3 Nov", or "Week of 2 Nov" for a week's bar. */
export function bucketName(bucket: Span & { readonly unit: 'day' | 'week' }): string {
  return bucket.unit === 'day' ? shortDate(bucket.from) : spanLabel(bucket.from, bucket.to);
}

/**
 * Under each bar: "Mon 2" for a week; Mondays as "2 Nov" for a month (the
 * first day too, when there's room); every few weeks for a long period.
 */
function tickLabels(buckets: readonly ChartBucket[]): (string | null)[] {
  if (buckets.length <= 7) return buckets.map((b) => (b.unit === 'day' ? `${parts(b.from).weekday} ${parts(b.from).day}` : `${parts(b.from).day} ${parts(b.from).month}`));
  if (buckets[0]?.unit === 'week') {
    const every = Math.ceil(buckets.length / 8);
    return buckets.map((b, i) => (i % every === 0 ? `${parts(b.from).day} ${parts(b.from).month}` : null));
  }
  const firstMonday = buckets.findIndex((b) => parts(b.from).weekday === 'Mon');
  return buckets.map((b, i) => {
    const p = parts(b.from);
    if (p.weekday === 'Mon') return `${p.day} ${p.month}`;
    if (i === 0 && (firstMonday === -1 || firstMonday >= 3)) return `${p.day} ${p.month}`;
    return null;
  });
}

/**
 * Posts per day as stacked columns: posted (green) at the baseline, pending
 * (amber) above it, a 2px gap between. Each column is a button: hover or
 * focus shows its numbers; a click filters the list to it. Arrow keys move
 * along the bars. Days still to come are drawn empty and can't be picked.
 */
export function RecordsChart({ buckets, selected, onSelect, summary }: RecordsChartProps) {
  const summaryId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const max = Math.max(0, ...buckets.map((b) => b.posted + b.pending));
  const ticks = axisTicks(max);
  const top = ticks.at(-1)!;
  const labels = tickLabels(buckets);
  const pickable = buckets.map((b, i) => (b.later ? -1 : i)).filter((i) => i !== -1);
  const selectedIndex = buckets.findIndex((b) => b.from === selected);
  // One tab stop: the picked bar, else the latest one that has happened.
  const tabStop = selectedIndex !== -1 ? selectedIndex : (pickable.at(-1) ?? -1);
  const dense = buckets.length > 14;

  const move = (event: KeyboardEvent, from: number) => {
    const at = pickable.indexOf(from);
    let to: number | undefined;
    if (event.key === 'ArrowRight') to = pickable[at + 1];
    else if (event.key === 'ArrowLeft') to = pickable[at - 1];
    else if (event.key === 'Home') to = pickable[0];
    else if (event.key === 'End') to = pickable.at(-1);
    else return;
    event.preventDefault();
    if (to !== undefined) refs.current[to]?.focus();
  };

  const tip = hover !== null ? buckets[hover] : undefined;
  const tipEdge = hover === null ? '' : hover < 2 ? ' rchart__tip--start' : hover > buckets.length - 3 ? ' rchart__tip--end' : '';

  return (
    <div className={`rchart${selected ? ' rchart--picked' : ''}${dense ? ' rchart--dense' : ''}`}>
      <p id={summaryId} className="visually-hidden">
        {summary}
      </p>
      <div className="rchart__axis" aria-hidden="true">
        {[...ticks].reverse().map((t) => (
          <span key={t} className="rchart__tick tabular">
            {t.toLocaleString('en-PH')}
          </span>
        ))}
      </div>
      <div className="rchart__plot">
        <div className="rchart__grid" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="rchart__gridline" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
        </div>
        <div className="rchart__bars" role="group" aria-label={`Posts by ${buckets[0]?.unit === 'week' ? 'week' : 'day'}. Pick a bar to filter the list.`} aria-describedby={summaryId}>
          {buckets.map((b, i) => {
            const total = b.posted + b.pending;
            const name = bucketName(b);
            const picked = b.from === selected;
            const stack =
              total === 0 ? null : (
                <span className="rchart__stack" style={{ height: `${(total / top) * 100}%` }}>
                  {b.pending > 0 ? <span className="rchart__pending" style={{ flexGrow: b.pending }} /> : null}
                  {b.posted > 0 ? <span className="rchart__posted" style={{ flexGrow: b.posted }} /> : null}
                </span>
              );
            if (b.later) {
              return (
                <span key={b.from} className="rchart__slot rchart__slot--later" aria-hidden="true">
                  <span className="rchart__future" />
                </span>
              );
            }
            return (
              <button
                key={b.from}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                className={`rchart__slot${picked ? ' rchart__slot--picked' : ''}`}
                tabIndex={i === tabStop ? 0 : -1}
                aria-pressed={picked}
                aria-label={`${name}: ${plural(b.posted, 'posted', 'posted')}, ${plural(b.pending, 'pending', 'pending')}`}
                onClick={() => onSelect(picked ? null : { from: b.from, to: b.to })}
                onKeyDown={(e) => move(e, i)}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
              >
                {stack}
              </button>
            );
          })}
        </div>
        {tip ? (
          <div
            className={`rchart__tip${tipEdge}`}
            style={{
              left: `${((hover! + 0.5) / buckets.length) * 100}%`,
              bottom: `calc(${((tip.posted + tip.pending) / top) * 100}% + 10px)`,
            }}
            aria-hidden="true"
          >
            <span className="rchart__tip-day">{bucketName(tip)}</span>
            <span className="rchart__tip-row">
              <span className="rchart__key rchart__key--posted" />
              <strong className="tabular">{tip.posted.toLocaleString('en-PH')}</strong> Posted
            </span>
            <span className="rchart__tip-row">
              <span className="rchart__key rchart__key--pending" />
              <strong className="tabular">{tip.pending.toLocaleString('en-PH')}</strong> Pending
            </span>
          </div>
        ) : null}
      </div>
      <div className="rchart__labels" aria-hidden="true">
        {buckets.map((b, i) => (
          <span key={b.from} className={`rchart__label${b.from === selected ? ' rchart__label--picked' : ''}`}>
            {labels[i] ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Posted and pending, as the bars draw them. */
export function ChartLegend() {
  return (
    <span className="rchart-legend" aria-hidden="true">
      <span className="rchart-legend__item">
        <span className="rchart__swatch rchart__swatch--posted" />
        Posted
      </span>
      <span className="rchart-legend__item">
        <span className="rchart__swatch rchart__swatch--pending" />
        Pending
      </span>
    </span>
  );
}
