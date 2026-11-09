import { useId, useState } from 'react';
import { Button, Pill } from '../../components';
import { SPOT_RESULTS, spotTally, spotWords, type SpotItem, type SpotResult } from '@/core/spotchecks';
import { shortDate } from '@/core/summary';
import type { PostLogEntry } from '@/core/types';

/** The Checks cell of the week's table: a failure stands out. */
export function SpotCell({ items }: { readonly items: readonly SpotItem[] }) {
  const tally = spotTally(items);
  const words = spotWords(tally);
  if (tally.failed > 0) return <Pill tone="danger">{words}</Pill>;
  if (tally.total > 0 && tally.checked === tally.total) return <Pill tone="ok">{words}</Pill>;
  return <span className="interns__quiet">{tally.total === 0 ? '–' : words}</span>;
}

export interface SpotCheckSectionProps {
  /** The agent's posts picked for this week, with their checks. */
  readonly items: readonly SpotItem[];
  /** Saves what was found. Rejects when it couldn't be saved: the caller says why. */
  readonly onCheck: (post: PostLogEntry, result: SpotResult) => Promise<void>;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

/**
 * The agent's week's spot check in their panel: a few of their posts, each
 * to open on Facebook and mark Verified, Not found or Wrong listing.
 */
export function SpotCheckSection({ items, onCheck, onOpenLink }: SpotCheckSectionProps) {
  const titleId = useId();
  const [saving, setSaving] = useState<{ key: string; result: SpotResult } | null>(null);
  const tally = spotTally(items);

  const check = async (item: SpotItem, result: SpotResult) => {
    setSaving({ key: item.key, result });
    try {
      await onCheck(item.post, result);
    } catch {
      // Said by the caller; the buttons are free again.
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="spot-check" aria-labelledby={titleId}>
      <h3 id={titleId} className="intern-panel__label">
        Spot check{items.length > 0 ? <span className="spot-check__count tabular"> · {spotWords(tally)}</span> : null}
      </h3>
      {items.length === 0 ? (
        <p className="intern-panel__quiet">No posts with a link this week.</p>
      ) : (
        <>
          <p className="spot-check__hint">Open each post on Facebook, then say what you found.</p>
          <ul className="spot-check__list">
            {items.map((item) => {
              const current = item.check?.result;
              const failed = current !== undefined && current !== 'Verified';
              const link = item.post.postLink.trim();
              return (
                <li key={item.key} className={`spot-item${failed ? ' spot-item--failed' : ''}`}>
                  <div className="spot-item__head">
                    <span className="spot-item__name">{item.post.title}</span>
                    <span className="spot-item__date tabular">{shortDate(item.post.date)}</span>
                    {onOpenLink && link ? (
                      <Button variant="link" className="spot-item__open" onClick={() => onOpenLink(link)} aria-label={`Open the post of ${item.post.title}`}>
                        Open
                      </Button>
                    ) : null}
                  </div>
                  <div className="spot-item__results" role="group" aria-label={`What you found: ${item.post.title}`}>
                    {SPOT_RESULTS.map((result) => (
                      <Button
                        key={result}
                        size="small"
                        variant={current === result ? 'primary' : 'ghost'}
                        aria-pressed={current === result}
                        busy={saving?.key === item.key && saving.result === result}
                        disabled={saving !== null}
                        onClick={() => void check(item, result)}
                      >
                        {result}
                      </Button>
                    ))}
                  </div>
                  {item.check ? (
                    <p className="spot-item__by">
                      {item.check.result}, checked by {item.check.checkedBy}
                      {item.check.checkedAt ? ` on ${shortDate(item.check.checkedAt.slice(0, 10))}` : ''}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
